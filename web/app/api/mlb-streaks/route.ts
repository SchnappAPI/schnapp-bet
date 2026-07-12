import { NextRequest } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import { getPool } from "@/lib/db";
import { todayCT } from "@/lib/mlbLive";
import mssql from "mssql";

// Streaks / Trends board (/mlb/streaks). Two modes:
//   default            -> the day's slate: each batter's CURRENT run-state per
//                         market (mlb.player_streak_state, their latest row)
//                         with the next-game conditional frequency, for the
//                         at-ceiling / overdue / strong-streak scan lists.
//   ?batter=ID         -> that batter's full streak/drought distribution
//                         curves (mlb.player_streak_dist), both scopes, for the
//                         player drill-down chart.
// Display/context only — these are empirical frequencies with denominators,
// never folded into the projection.

export type StreakMarket = "HR" | "HIT" | "HRR2" | "HRR3" | "RBI";

export interface StreakStateRow {
  batterId: number;
  batterName: string | null;
  teamAbbr: string | null;
  market: StreakMarket;
  asOfDate: string;
  state: "streak" | "drought" | "none";
  len: number;
  ceiling: number | null;
  ceilingCareer: number | null;
  atCeiling: boolean;
  typicalGap: number | null;
  phase: "early" | "on" | "late" | null;
  seasonN: number | null;
  seasonHits: number | null;
  seasonFreq: number | null;
  careerN: number | null;
  careerHits: number | null;
  careerFreq: number | null;
}

export interface StreakDistRow {
  market: StreakMarket;
  scope: "season" | "career";
  stateType: "streak" | "drought";
  stateLen: number;
  nReached: number;
  nEventNext: number;
  freq: number;
}

export interface StreaksResponse {
  date: string;
  rows: StreakStateRow[]; // slate mode
}
export interface StreakDistResponse {
  batterId: number;
  batterName: string | null;
  dist: StreakDistRow[];
}

// The day's slate: each batter on a team that plays @d, with their latest
// run-state per market (most recent state row going into the slate) and its
// conditional next-game frequency.
const SLATE_SQL = `
WITH team AS (
  SELECT player_id, team_id FROM (
    SELECT player_id, team_id,
      ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY game_date DESC) AS rn
    FROM mlb.batting_stats
  ) z WHERE rn = 1
),
slate AS (
  SELECT away_team_id AS team_id FROM mlb.games WHERE game_date = @d
  UNION SELECT home_team_id FROM mlb.games WHERE game_date = @d
),
slate_batters AS (
  SELECT DISTINCT t.player_id, t.team_id
  FROM team t JOIN slate s ON s.team_id = t.team_id
),
ranked AS (
  SELECT s.*,
    ROW_NUMBER() OVER (PARTITION BY s.batter_id, s.market ORDER BY s.as_of_date DESC) AS rn
  FROM mlb.player_streak_state s
  JOIN slate_batters sb ON sb.player_id = s.batter_id
  WHERE s.as_of_date < @cutoff
)
SELECT
  ss.batter_id                    AS batterId,
  p.player_name                   AS batterName,
  tm.team_abbreviation            AS teamAbbr,
  ss.market                       AS market,
  CONVERT(VARCHAR(10), ss.as_of_date, 120) AS asOfDate,
  ss.cur_state                    AS state,
  ss.cur_len                      AS len,
  ss.streak_ceiling               AS ceiling,
  ss.streak_ceiling_car           AS ceilingCareer,
  ss.at_ceiling                   AS atCeiling,
  ss.typical_gap                  AS typicalGap,
  ss.phase                        AS phase,
  ss.season_n                     AS seasonN,
  ss.season_hits                  AS seasonHits,
  CAST(ss.season_freq AS FLOAT)   AS seasonFreq,
  ss.career_n                     AS careerN,
  ss.career_hits                  AS careerHits,
  CAST(ss.career_freq AS FLOAT)   AS careerFreq
FROM ranked ss
JOIN mlb.players p ON p.player_id = ss.batter_id
LEFT JOIN slate_batters sb ON sb.player_id = ss.batter_id
LEFT JOIN mlb.teams tm ON tm.team_id = sb.team_id
WHERE ss.rn = 1
ORDER BY ss.market, ss.cur_state, ss.cur_len DESC
`;

const DIST_SQL = `
SELECT
  market       AS market,
  scope        AS scope,
  state_type   AS stateType,
  state_len    AS stateLen,
  n_reached    AS nReached,
  n_event_next AS nEventNext,
  CAST(freq AS FLOAT) AS freq
FROM mlb.player_streak_dist
WHERE batter_id = @b
ORDER BY market, scope, state_type, state_len
`;

export async function GET(req: NextRequest) {
  const batterParam = req.nextUrl.searchParams.get("batter");
  const dateParam = req.nextUrl.searchParams.get("date");
  try {
    const pool = await getPool();

    if (batterParam && /^\d+$/.test(batterParam)) {
      const b = parseInt(batterParam, 10);
      const [distRes, nameRes] = await Promise.all([
        pool.request().input("b", mssql.Int, b).query(DIST_SQL),
        pool
          .request()
          .input("b", mssql.Int, b)
          .query("SELECT player_name FROM mlb.players WHERE player_id = @b"),
      ]);
      return jsonWithEtag(req, {
        batterId: b,
        batterName: nameRes.recordset[0]?.player_name ?? null,
        dist: distRes.recordset as StreakDistRow[],
      } satisfies StreakDistResponse);
    }

    const date =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : todayCT();
    // cutoff = day AFTER the slate date, so "< cutoff" keeps every state row
    // through the slate date's morning (states are dated the player's last game).
    const cutoff = new Date(`${date}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + 1);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const res = await pool
      .request()
      .input("d", mssql.VarChar, date)
      .input("cutoff", mssql.VarChar, cutoffStr)
      .query(SLATE_SQL);

    const rows = (res.recordset as RawStateRow[]).map((r) => ({
      batterId: r.batterId,
      batterName: r.batterName,
      teamAbbr: r.teamAbbr,
      market: r.market,
      asOfDate: r.asOfDate,
      state: r.state,
      len: r.len,
      ceiling: r.ceiling,
      ceilingCareer: r.ceilingCareer,
      atCeiling: r.atCeiling === 1,
      typicalGap: r.typicalGap,
      phase: r.phase,
      seasonN: r.seasonN,
      seasonHits: r.seasonHits,
      seasonFreq: r.seasonFreq,
      careerN: r.careerN,
      careerHits: r.careerHits,
      careerFreq: r.careerFreq,
    }));

    return jsonWithEtag(req, { date, rows } satisfies StreaksResponse);
  } catch (err) {
    return apiError(err, "api/mlb-streaks");
  }
}

interface RawStateRow {
  batterId: number;
  batterName: string | null;
  teamAbbr: string | null;
  market: StreakMarket;
  asOfDate: string;
  state: "streak" | "drought" | "none";
  len: number;
  ceiling: number | null;
  ceilingCareer: number | null;
  atCeiling: number | null;
  typicalGap: number | null;
  phase: "early" | "on" | "late" | null;
  seasonN: number | null;
  seasonHits: number | null;
  seasonFreq: number | null;
  careerN: number | null;
  careerHits: number | null;
  careerFreq: number | null;
}
