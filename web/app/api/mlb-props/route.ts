import { NextRequest } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import { getPool } from "@/lib/db";
import { fetchMlbLiveOverlay, todayCT } from "@/lib/mlbLive";
import mssql from "mssql";

// Odds-free batter-prop projections board (/mlb/props). Reads one as-of slice
// of mlb.batter_prop_projections (written nightly by
// etl/mlb_prop_projections.py, model prop-v1) and returns each batter on that
// date's SLATE (the engine projects a pool of active hitters with no slate
// context; this restricts to teams actually playing that day) with their
// probability for each market, joined to name + current team. For a PAST slice
// (games finished + box scores loaded) each row is also graded against the
// realized outcome on that date — did the batter clear the market — so the
// board doubles as a backtest. Accepts an optional ?date=YYYY-MM-DD to page
// through history; defaults to the latest slice. availableDates bounds the
// board's prev/next nav. The board ranks and tiers client-side. NO odds
// anywhere — pure model output vs realized results.

export type PropMarket = "HR" | "HRR" | "HITS";

export interface PropRow {
  batterId: number;
  batterName: string | null;
  teamAbbr: string | null;
  market: PropMarket;
  prob: number; // 0..1
  baseRate: number; // league mean for the market
  lift: number; // prob / baseRate (x vs average)
  tier: string; // Elite | Strong | AboveAvg | Average | Fade
  priorGames: number;
  recentBarrelsPg: number | null; // trailing-20g barrels/game (HR form input)
  played: boolean; // did the batter appear in a game on the as-of date
  hit: boolean | null; // did they clear THIS row's market (null when DNP)
}

export interface PropsResponse {
  asOfDate: string | null; // the resolved slice being shown
  availableDates: string[]; // ascending list of as-of dates that have rows
  settled: boolean; // as-of date is past AND its outcomes are loaded — rows graded
  rows: PropRow[];
}

// One slice, joined to player name + most-recent team, and LEFT JOINed to the
// realized outcome on the as-of date itself (the slate this slice projected).
// Outcomes use the SAME market definitions the engine trains on: HR from
// at-bats, HRR (h+r+rbi >= 2) / HITS (hits >= 1) from the deduped batting line
// (a game can carry a stray second row via batter_game_id — take the max-PA
// row). Date grain: a doubleheader counts as a clear if it happened in either
// game. Numeric columns cast to FLOAT so they land as JSON numbers.
const SQL = `
WITH team AS (
  SELECT player_id, team_id FROM (
    SELECT player_id, team_id,
      ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY game_date DESC) AS rn
    FROM mlb.batting_stats
  ) z WHERE rn = 1
),
pab_d AS (
  SELECT batter_id,
    MAX(CASE WHEN result_event_type = 'home_run' THEN 1 ELSE 0 END) AS hr
  FROM mlb.player_at_bats WHERE game_date = @d GROUP BY batter_id
),
bs_d AS (
  SELECT batter_id, MAX(hrr) AS hrr, MAX(hit) AS hit FROM (
    SELECT player_id AS batter_id,
      CASE WHEN (hits + runs + rbi) >= 2 THEN 1 ELSE 0 END AS hrr,
      CASE WHEN hits >= 1 THEN 1 ELSE 0 END AS hit,
      ROW_NUMBER() OVER (PARTITION BY game_pk, player_id
                         ORDER BY plate_appearances DESC) AS rn
    FROM mlb.batting_stats
    WHERE game_date = @d AND (at_bats > 0 OR plate_appearances > 0)
  ) z WHERE rn = 1 GROUP BY batter_id
),
outcome AS (
  SELECT COALESCE(p.batter_id, b.batter_id) AS batter_id,
    ISNULL(p.hr, 0) AS o_hr, ISNULL(b.hrr, 0) AS o_hrr, ISNULL(b.hit, 0) AS o_hit
  FROM pab_d p FULL OUTER JOIN bs_d b ON p.batter_id = b.batter_id
)
SELECT
  pr.batter_id                    AS batterId,
  p.player_name                   AS batterName,
  t.team_abbreviation             AS teamAbbr,
  pr.market                       AS market,
  CAST(pr.prob AS FLOAT)          AS prob,
  CAST(pr.base_rate AS FLOAT)     AS baseRate,
  CAST(pr.lift AS FLOAT)          AS lift,
  pr.tier                         AS tier,
  pr.prior_games                  AS priorGames,
  CAST(pr.recent_barrels_pg AS FLOAT) AS recentBarrelsPg,
  tm.team_id                      AS teamId,
  CASE WHEN o.batter_id IS NULL THEN 0 ELSE 1 END AS played,
  CASE pr.market
       WHEN 'HR'   THEN o.o_hr
       WHEN 'HRR'  THEN o.o_hrr
       WHEN 'HITS' THEN o.o_hit
  END                             AS hit
FROM mlb.batter_prop_projections pr
LEFT JOIN mlb.players p ON p.player_id = pr.batter_id
LEFT JOIN team tm ON tm.player_id = pr.batter_id
LEFT JOIN mlb.teams t ON t.team_id = tm.team_id
LEFT JOIN outcome o ON o.batter_id = pr.batter_id
WHERE pr.as_of_date = @d
ORDER BY pr.market, pr.prob DESC
`;

interface RawRow {
  batterId: number;
  batterName: string | null;
  teamAbbr: string | null;
  market: PropMarket;
  prob: number;
  baseRate: number;
  lift: number;
  tier: string;
  priorGames: number;
  recentBarrelsPg: number | null;
  teamId: number | null; // batter's most-recent team (for the slate filter)
  played: number; // 0 | 1
  hit: number | null; // 0 | 1 | null (null = did not play)
}

// Team ids with a game on the given date. mlb.games first (fast); for a date
// the DB has not cached yet (a future projection slice), the schedule is
// knowable from statsapi. Returns an empty set only when both are empty or
// unreachable — the caller then leaves the board unfiltered rather than blank.
async function slateTeamIds(
  pool: mssql.ConnectionPool,
  date: string,
): Promise<Set<number>> {
  const res = await pool
    .request()
    .input("d", mssql.VarChar, date)
    .query<{ id: number | null }>(
      `SELECT away_team_id AS id FROM mlb.games WHERE game_date = @d
       UNION SELECT home_team_id FROM mlb.games WHERE game_date = @d`,
    );
  const ids = new Set<number>();
  for (const r of res.recordset) if (r.id != null) ids.add(r.id);
  if (ids.size > 0) return ids;

  const overlay = await fetchMlbLiveOverlay(date);
  for (const o of overlay.values()) {
    if (o.awayTeamId != null) ids.add(o.awayTeamId);
    if (o.homeTeamId != null) ids.add(o.homeTeamId);
  }
  return ids;
}

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get("date");
  try {
    const pool = await getPool();

    const datesRes = await pool
      .request()
      .query(
        "SELECT DISTINCT CONVERT(VARCHAR(10), as_of_date, 120) AS d FROM mlb.batter_prop_projections ORDER BY d",
      );
    const availableDates: string[] = datesRes.recordset.map(
      (r: { d: string }) => r.d,
    );
    if (availableDates.length === 0) {
      return jsonWithEtag(req, {
        asOfDate: null,
        availableDates: [],
        settled: false,
        rows: [],
      } satisfies PropsResponse);
    }

    // Resolve the requested date if valid and present, else the latest slice.
    const asOfDate =
      dateParam &&
      /^\d{4}-\d{2}-\d{2}$/.test(dateParam) &&
      availableDates.includes(dateParam)
        ? dateParam
        : availableDates[availableDates.length - 1];

    const res = await pool
      .request()
      .input("d", mssql.VarChar, asOfDate)
      .query(SQL);

    // Restrict to the day's slate: only hitters whose team actually plays on
    // the as-of date. The engine projects a POOL of active hitters with no
    // slate context, so without this the board lists players whose team is off
    // (e.g. Ohtani on a Dodgers off-day). Empty slate (both DB + statsapi came
    // back empty) -> leave the board unfiltered rather than blank.
    const slate = await slateTeamIds(pool, asOfDate);
    const raw = (res.recordset as RawRow[]).filter((r) =>
      slate.size === 0 ? true : r.teamId != null && slate.has(r.teamId),
    );

    const rows: PropRow[] = raw.map((r) => ({
      batterId: r.batterId,
      batterName: r.batterName,
      teamAbbr: r.teamAbbr,
      market: r.market,
      prob: r.prob,
      baseRate: r.baseRate,
      lift: r.lift,
      tier: r.tier,
      priorGames: r.priorGames,
      recentBarrelsPg: r.recentBarrelsPg,
      played: r.played === 1,
      hit: r.hit === null ? null : r.hit === 1,
    }));

    // A past date whose games have finished and whose box scores have loaded is
    // "settled" — its projections can be graded. Today/future (or a past date
    // not yet loaded) shows no result tags: no batter has a completed line, so
    // requiring at least one played row also guards the not-yet-loaded case.
    const settled = asOfDate < todayCT() && rows.some((r) => r.played);

    return jsonWithEtag(req, {
      asOfDate,
      availableDates,
      settled,
      rows,
    } satisfies PropsResponse);
  } catch (err) {
    return apiError(err, "api/mlb-props");
  }
}
