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
// probability for each market, joined to name + current team. Each row also
// carries SLATE CONTEXT for the reader to weigh — the opposing probable pitcher
// (name + hand) and the batter's career line vs that pitcher (BvP). This is
// context only: a matchup backtest showed pitcher/BvP signals are game-level
// noise and DEGRADE the projection, so they are shown, not folded into the
// model. For a PAST slice (games finished + box scores loaded) each row is also
// graded against the realized outcome on that date — did the batter clear the
// market — so the board doubles as a backtest. Accepts an optional
// ?date=YYYY-MM-DD to page through history; defaults to the latest slice.
// availableDates bounds the board's prev/next nav. NO odds anywhere.

export type PropMarket = "HR" | "HRR" | "HITS";

// Conviction bar (A+C, odds-free). A pick is a "Lock" only when the model has
// enough of the hitter (A: prior-games floor) AND its probability bucket has
// empirically hit, over the trailing window, at or above an ABSOLUTE
// per-market floor (C: track record). Absolute floors — not a lift multiple —
// because low-base markets (HR) clear any reasonable lift, so lift surfaced 140+
// "conviction" HR. The floors ARE the "how certain": HR tops out ~26% (nothing
// is a lock; these are the best validated HR leans), HRR/HITS allow real
// certainty. Tune these to taste — higher = fewer, surer.
const TRACK_TRAIL_DAYS = 30;
const BUCKET_W = 0.05;
const CONVICTION_MIN_PRIOR_GAMES = 30;
const CONVICTION_MIN_BUCKET_N = 20;
const CONVICTION_FLOOR: Record<PropMarket, number> = {
  HR: 0.22, // top HR bands only (base ~0.11)
  HRR: 0.55, // more-likely-than-not H+R+RBI (base ~0.43)
  HITS: 0.72, // genuinely likely hits (base ~0.58)
};

export interface BvpLine {
  ab: number; // career at-bats vs the probable pitcher
  h: number;
  hr: number;
}

// Conditional next-game frequency for the batter's CURRENT run-state in this
// market (mlb.player_streak_state). Display/context only — never folded into
// the projection. Denominators always carried so a small-n rate is honest.
export interface Situation {
  state: "streak" | "drought" | "none";
  len: number; // current streak/drought length
  ceiling: number | null; // longest event-streak this season
  ceilingCareer: number | null;
  atCeiling: boolean; // on a streak at/above the season ceiling (don't-chase)
  typicalGap: number | null; // drought cadence
  phase: "early" | "on" | "late" | null; // drought vs typical gap
  seasonN: number | null; // times reached this state (season)
  seasonHits: number | null; // of those, event happened next game
  seasonFreq: number | null; // 0..1
  careerN: number | null;
  careerHits: number | null;
  careerFreq: number | null;
}

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
  oppPitcher: string | null; // opposing probable starter (slate context)
  oppHand: string | null; // his throwing hand (L | R | S)
  bvp: BvpLine | null; // batter's career line vs that pitcher (null if never faced / unknown)
  played: boolean; // did the batter appear in a game on the as-of date
  hit: boolean | null; // did they clear THIS row's market (null when DNP)
  situation: Situation | null; // current run-state conditional frequency
  // Conviction (A+C): the trailing-30d REALIZED hit rate of this pick's
  // probability bucket for this market, and whether the pick clears the
  // conviction bar. Track-record-grounded, odds-free.
  bucketRate: number | null; // realized hit rate of the prob bucket, last 30d
  bucketN: number | null; // settled samples in that bucket (denominator)
  qualifies: boolean; // clears prior-games + bucket-N + realized-lift bar
}

export interface PropsResponse {
  asOfDate: string | null; // the resolved slice being shown
  availableDates: string[]; // ascending list of as-of dates that have rows
  settled: boolean; // as-of date is past AND its outcomes are loaded — rows graded
  rows: PropRow[];
}

// One slice, joined to player name + most-recent team, the day's opposing
// starter + the batter's career BvP line, and the realized outcome on the
// as-of date. Outcomes use the SAME market definitions the engine trains on:
// HR from at-bats, HRR (h+r+rbi >= 2) / HITS (hits >= 1) from the deduped
// batting line. `opp` maps each team to its opponent's probable starter (one
// row per team, so a doubleheader does not fan out the projection rows); `bvp`
// is scoped to those starters so it stays a small aggregate. Numeric columns
// cast to FLOAT so they land as JSON numbers.
const SQL = `
WITH team AS (
  SELECT player_id, team_id FROM (
    SELECT player_id, team_id,
      ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY game_date DESC) AS rn
    FROM mlb.batting_stats
  ) z WHERE rn = 1
),
opp AS (
  SELECT team_id, opp_id, opp_name, opp_hand FROM (
    SELECT team_id, game_pk, opp_id, opp_name, opp_hand,
      ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY game_pk) AS rn
    FROM (
      SELECT away_team_id AS team_id, game_pk, home_pitcher_id AS opp_id,
             home_pitcher_name AS opp_name, home_pitcher_hand AS opp_hand
      FROM mlb.games WHERE game_date = @d
      UNION ALL
      SELECT home_team_id, game_pk, away_pitcher_id, away_pitcher_name, away_pitcher_hand
      FROM mlb.games WHERE game_date = @d
    ) u
  ) z WHERE rn = 1
),
bvp AS (
  SELECT batter_id, pitcher_id,
    COUNT(*) AS ab,
    SUM(CASE WHEN result_event_type IN ('single','double','triple','home_run') THEN 1 ELSE 0 END) AS h,
    SUM(CASE WHEN result_event_type = 'home_run' THEN 1 ELSE 0 END) AS hr
  FROM mlb.player_at_bats
  WHERE pitcher_id IN (SELECT opp_id FROM opp WHERE opp_id IS NOT NULL)
  GROUP BY batter_id, pitcher_id
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
  op.opp_name                     AS oppPitcher,
  op.opp_hand                     AS oppHand,
  bvp.ab                          AS bvpAb,
  bvp.h                           AS bvpH,
  bvp.hr                          AS bvpHr,
  CASE WHEN o.batter_id IS NULL THEN 0 ELSE 1 END AS played,
  CASE pr.market
       WHEN 'HR'   THEN o.o_hr
       WHEN 'HRR'  THEN o.o_hrr
       WHEN 'HITS' THEN o.o_hit
  END                             AS hit,
  ss.cur_state                    AS ssState,
  ss.cur_len                      AS ssLen,
  ss.streak_ceiling               AS ssCeiling,
  ss.streak_ceiling_car           AS ssCeilingCar,
  ss.at_ceiling                   AS ssAtCeiling,
  ss.typical_gap                  AS ssTypicalGap,
  ss.phase                        AS ssPhase,
  ss.season_n                     AS ssSeasonN,
  ss.season_hits                  AS ssSeasonHits,
  CAST(ss.season_freq AS FLOAT)   AS ssSeasonFreq,
  ss.career_n                     AS ssCareerN,
  ss.career_hits                  AS ssCareerHits,
  CAST(ss.career_freq AS FLOAT)   AS ssCareerFreq
FROM mlb.batter_prop_projections pr
LEFT JOIN mlb.players p ON p.player_id = pr.batter_id
LEFT JOIN team tm ON tm.player_id = pr.batter_id
LEFT JOIN mlb.teams t ON t.team_id = tm.team_id
LEFT JOIN opp op ON op.team_id = tm.team_id
LEFT JOIN bvp ON bvp.batter_id = pr.batter_id AND bvp.pitcher_id = op.opp_id
LEFT JOIN outcome o ON o.batter_id = pr.batter_id
-- The batter's run-state AS OF the morning of the board date: the latest
-- streak_state row STRICTLY BEFORE @d (the player's prior game). A state row
-- for date X is through-X-inclusive, so projecting X's game uses rows < X —
-- same pre-game rule the player_patterns readers use. Market key mapped
-- (board 'HRR' -> engine 'HRR2').
OUTER APPLY (
  SELECT TOP 1 s.*
  FROM mlb.player_streak_state s
  WHERE s.batter_id = pr.batter_id
    AND s.market = CASE pr.market WHEN 'HR' THEN 'HR' WHEN 'HITS' THEN 'HIT' WHEN 'HRR' THEN 'HRR2' END
    AND s.as_of_date < @d
    -- Recently active only: skip a stale run-state from a prior stint/season.
    AND s.as_of_date >= DATEADD(day, -14, @d)
  ORDER BY s.as_of_date DESC
) ss
WHERE pr.as_of_date = @d
ORDER BY pr.market, pr.prob DESC
`;

// Trailing-window realized hit rate per (market, probability bucket): of the
// projections made in [@d-N, @d) that settled, what fraction cleared. Graded
// with the SAME outcome definitions the board uses (HR from at-bats; HRR>=2 /
// HITS>=1 from the deduped batting line). This is the "C" track record that
// validates the "A" probability bar.
const TRACK_SQL = `
WITH proj AS (
  SELECT batter_id, as_of_date, market,
         FLOOR(prob / ${BUCKET_W}) * ${BUCKET_W} AS bucket
  FROM mlb.batter_prop_projections
  WHERE as_of_date >= DATEADD(day, -${TRACK_TRAIL_DAYS}, @d) AND as_of_date < @d
),
pdates AS (SELECT DISTINCT as_of_date FROM proj),
pab_d AS (
  SELECT batter_id, CAST(game_date AS DATE) AS d,
    MAX(CASE WHEN result_event_type = 'home_run' THEN 1 ELSE 0 END) AS hr
  FROM mlb.player_at_bats
  WHERE CAST(game_date AS DATE) IN (SELECT as_of_date FROM pdates)
  GROUP BY batter_id, CAST(game_date AS DATE)
),
bs_d AS (
  SELECT batter_id, d, MAX(hrr) AS hrr, MAX(hit) AS hit FROM (
    SELECT player_id AS batter_id, CAST(game_date AS DATE) AS d,
      CASE WHEN (hits + runs + rbi) >= 2 THEN 1 ELSE 0 END AS hrr,
      CASE WHEN hits >= 1 THEN 1 ELSE 0 END AS hit,
      ROW_NUMBER() OVER (PARTITION BY game_pk, player_id ORDER BY plate_appearances DESC) AS rn
    FROM mlb.batting_stats
    WHERE CAST(game_date AS DATE) IN (SELECT as_of_date FROM pdates)
      AND (at_bats > 0 OR plate_appearances > 0)
  ) z WHERE rn = 1 GROUP BY batter_id, d
),
outcome AS (
  SELECT COALESCE(p.batter_id, b.batter_id) AS batter_id, COALESCE(p.d, b.d) AS d,
    ISNULL(p.hr, 0) AS hr, ISNULL(b.hrr, 0) AS hrr, ISNULL(b.hit, 0) AS hit
  FROM pab_d p FULL OUTER JOIN bs_d b ON p.batter_id = b.batter_id AND p.d = b.d
),
graded AS (
  SELECT pr.market, pr.bucket,
    CASE WHEN o.batter_id IS NULL THEN NULL
         ELSE CASE pr.market WHEN 'HR' THEN o.hr WHEN 'HRR' THEN o.hrr WHEN 'HITS' THEN o.hit END
    END AS won
  FROM proj pr
  LEFT JOIN outcome o ON o.batter_id = pr.batter_id AND o.d = pr.as_of_date
)
SELECT market, bucket, COUNT(won) AS n, AVG(CAST(won AS FLOAT)) AS rate
FROM graded WHERE won IS NOT NULL
GROUP BY market, bucket
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
  oppPitcher: string | null;
  oppHand: string | null;
  bvpAb: number | null;
  bvpH: number | null;
  bvpHr: number | null;
  played: number; // 0 | 1
  hit: number | null; // 0 | 1 | null (null = did not play)
  ssState: "streak" | "drought" | "none" | null;
  ssLen: number | null;
  ssCeiling: number | null;
  ssCeilingCar: number | null;
  ssAtCeiling: number | null; // 0 | 1
  ssTypicalGap: number | null;
  ssPhase: "early" | "on" | "late" | null;
  ssSeasonN: number | null;
  ssSeasonHits: number | null;
  ssSeasonFreq: number | null;
  ssCareerN: number | null;
  ssCareerHits: number | null;
  ssCareerFreq: number | null;
}

// The day's slate: team ids with a game, plus each team's opposing probable
// starter name. mlb.games first (fast, and the source of pitcher hand + BvP);
// for a date the DB has not cached yet (a future slice) fall back to the
// statsapi schedule for team ids + opponent names. Empty only when both are
// empty/unreachable — the caller then leaves the board unfiltered.
async function slateInfo(
  pool: mssql.ConnectionPool,
  date: string,
): Promise<{ teams: Set<number>; oppName: Map<number, string> }> {
  const res = await pool
    .request()
    .input("d", mssql.VarChar, date)
    .query<{ team: number | null; opp: string | null }>(
      `SELECT away_team_id AS team, home_pitcher_name AS opp FROM mlb.games WHERE game_date = @d
       UNION ALL SELECT home_team_id, away_pitcher_name FROM mlb.games WHERE game_date = @d`,
    );
  const teams = new Set<number>();
  const oppName = new Map<number, string>();
  for (const r of res.recordset) {
    if (r.team != null) {
      teams.add(r.team);
      if (r.opp) oppName.set(r.team, r.opp);
    }
  }
  if (teams.size > 0) return { teams, oppName };

  const overlay = await fetchMlbLiveOverlay(date);
  for (const o of overlay.values()) {
    if (o.awayTeamId != null) {
      teams.add(o.awayTeamId);
      if (o.homePitcher) oppName.set(o.awayTeamId, o.homePitcher);
    }
    if (o.homeTeamId != null) {
      teams.add(o.homeTeamId);
      if (o.awayPitcher) oppName.set(o.homeTeamId, o.awayPitcher);
    }
  }
  return { teams, oppName };
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
    // (e.g. Ohtani on a Dodgers off-day). The slate also carries opponent names
    // for a future date the SQL opp CTE (mlb.games) has not cached. Empty slate
    // -> leave the board unfiltered rather than blank.
    const { teams: slate, oppName } = await slateInfo(pool, asOfDate);
    const raw = (res.recordset as RawRow[]).filter((r) =>
      slate.size === 0 ? true : r.teamId != null && slate.has(r.teamId),
    );

    // Trailing track record per (market, prob bucket) for the conviction bar.
    const trackRes = await pool
      .request()
      .input("d", mssql.VarChar, asOfDate)
      .query(TRACK_SQL);
    const track = new Map<string, { n: number; rate: number }>();
    for (const t of trackRes.recordset as {
      market: string;
      bucket: number;
      n: number;
      rate: number;
    }[]) {
      track.set(`${t.market}|${t.bucket.toFixed(2)}`, { n: t.n, rate: t.rate });
    }
    const bucketKey = (market: string, prob: number) =>
      `${market}|${(Math.floor(prob / BUCKET_W) * BUCKET_W).toFixed(2)}`;

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
      oppPitcher:
        r.oppPitcher ??
        (r.teamId != null ? (oppName.get(r.teamId) ?? null) : null),
      oppHand: r.oppHand,
      bvp:
        r.bvpAb != null
          ? { ab: r.bvpAb, h: r.bvpH ?? 0, hr: r.bvpHr ?? 0 }
          : null,
      played: r.played === 1,
      hit: r.hit === null ? null : r.hit === 1,
      ...(() => {
        const tr = track.get(bucketKey(r.market, r.prob));
        const bucketRate = tr ? tr.rate : null;
        const bucketN = tr ? tr.n : null;
        const qualifies =
          r.priorGames >= CONVICTION_MIN_PRIOR_GAMES &&
          bucketN != null &&
          bucketN >= CONVICTION_MIN_BUCKET_N &&
          bucketRate != null &&
          bucketRate >= CONVICTION_FLOOR[r.market];
        return { bucketRate, bucketN, qualifies };
      })(),
      situation:
        r.ssState == null
          ? null
          : {
              state: r.ssState,
              len: r.ssLen ?? 0,
              ceiling: r.ssCeiling,
              ceilingCareer: r.ssCeilingCar,
              atCeiling: r.ssAtCeiling === 1,
              typicalGap: r.ssTypicalGap,
              phase: r.ssPhase,
              seasonN: r.ssSeasonN,
              seasonHits: r.ssSeasonHits,
              seasonFreq: r.ssSeasonFreq,
              careerN: r.ssCareerN,
              careerHits: r.ssCareerHits,
              careerFreq: r.ssCareerFreq,
            },
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
