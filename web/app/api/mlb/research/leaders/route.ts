import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { todayCT } from "@/lib/mlbLive";

// Day-level "Top ..." leaderboard rails (Savant Gamefeed format, Phase 4.5
// item 1 of docs/features/mlb-research-dashboard.md). Batter rails read
// mlb.player_at_bats; pitch velo + whiffs read pitch-grain
// mlb.play_by_play. Both land NIGHTLY — the requested date resolves down
// to the latest date with data, and the response carries that resolved
// date so the UI labels it and never implies live.

// StatsAPI details.call.code values for a swing-and-miss: S = swinging
// strike, W = swinging strike (blocked), M = missed bunt, Q = swinging
// pitchout. Foul tips (T) are contact and excluded.
const WHIFF_CALL_CODES = "'S','W','M','Q'";

export interface LeaderAtBat {
  batterId: number | null;
  batterName: string | null;
  teamAbbr: string | null;
  gamePk: number;
  result: string | null;
  ev: number | null;
  la: number | null;
  dist: number | null;
  batSpeed: number | null;
  hrParks: number | null;
}

export interface LeaderPitcher {
  pitcherId: number | null;
  pitcherName: string | null;
  teamAbbr: string | null;
  gamePk: number;
  maxVelo: number | null;
  whiffs: number;
  pitches: number;
}

export interface LeadersResponse {
  date: string;
  resolvedDate: string | null;
  topEv: LeaderAtBat[];
  topDist: LeaderAtBat[];
  topBatSpeed: LeaderAtBat[];
  hrParkNearMiss: LeaderAtBat[];
  topPitchVelo: LeaderPitcher[];
  topWhiffs: LeaderPitcher[];
}

const TOP_N = 5;

// One SELECT shape for all four at-bat rails; only the ORDER BY / WHERE
// tail differs. Batting team on a top-half AB is the away team.
const AT_BAT_RAIL = (tail: string) => `
  SELECT TOP ${TOP_N}
    ab.batter_id          AS batterId,
    p.player_name         AS batterName,
    t.team_abbreviation   AS teamAbbr,
    ab.game_pk            AS gamePk,
    ab.result_event_type  AS result,
    ab.hit_launch_speed   AS ev,
    ab.hit_launch_angle   AS la,
    ab.hit_total_distance AS dist,
    ab.hit_bat_speed      AS batSpeed,
    ab.home_run_ballparks AS hrParks
  FROM mlb.player_at_bats ab
  LEFT JOIN mlb.players p ON p.player_id = ab.batter_id
  LEFT JOIN mlb.teams t
    ON t.team_id = CASE WHEN ab.is_top_inning = 1
                        THEN ab.away_team_id
                        ELSE ab.home_team_id END
  WHERE ab.game_date = @d AND ${tail}
`;

// Pitcher rails aggregate per (pitcher, game). Pitching team on a
// top-half pitch is the home team.
const PITCHER_RAIL = (orderBy: string) => `
  SELECT TOP ${TOP_N}
    x.pitcher_id        AS pitcherId,
    p.player_name       AS pitcherName,
    t.team_abbreviation AS teamAbbr,
    x.game_pk           AS gamePk,
    x.maxVelo,
    x.whiffs,
    x.pitches
  FROM (
    SELECT
      pbp.pitcher_id,
      pbp.game_pk,
      MIN(CASE WHEN pbp.is_top_inning = 1
               THEN pbp.home_team_id ELSE pbp.away_team_id END) AS team_id,
      MAX(pbp.pitch_start_speed) AS maxVelo,
      SUM(CASE WHEN pbp.pitch_call_code IN (${WHIFF_CALL_CODES})
               THEN 1 ELSE 0 END) AS whiffs,
      COUNT(*) AS pitches
    FROM mlb.play_by_play pbp
    WHERE pbp.game_date = @d AND pbp.is_pitch = 1
      AND pbp.pitcher_id IS NOT NULL
    GROUP BY pbp.pitcher_id, pbp.game_pk
  ) x
  LEFT JOIN mlb.players p ON p.player_id = x.pitcher_id
  LEFT JOIN mlb.teams t ON t.team_id = x.team_id
  ORDER BY ${orderBy}
`;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayCT();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  try {
    const pool = await getPool();

    // Nightly grain: resolve down to the latest loaded day.
    const dateRes = await pool.request().input("date", mssql.VarChar, date)
      .query(`
        SELECT CONVERT(VARCHAR(10), MAX(game_date), 120) AS resolvedDate
        FROM mlb.player_at_bats
        WHERE game_date <= @date
      `);
    const resolvedDate: string | null =
      dateRes.recordset[0]?.resolvedDate ?? null;

    const empty: LeadersResponse = {
      date,
      resolvedDate,
      topEv: [],
      topDist: [],
      topBatSpeed: [],
      hrParkNearMiss: [],
      topPitchVelo: [],
      topWhiffs: [],
    };
    if (!resolvedDate) return jsonWithEtag(req, empty);

    const run = (sql: string) =>
      pool.request().input("d", mssql.VarChar, resolvedDate).query(sql);

    const [evRes, distRes, batSpeedRes, nearMissRes, veloRes, whiffRes] =
      await Promise.all([
        run(
          AT_BAT_RAIL("ab.hit_launch_speed IS NOT NULL") +
            "ORDER BY ab.hit_launch_speed DESC",
        ),
        run(
          AT_BAT_RAIL("ab.hit_total_distance IS NOT NULL") +
            "ORDER BY ab.hit_total_distance DESC",
        ),
        run(
          AT_BAT_RAIL("ab.hit_bat_speed IS NOT NULL") +
            "ORDER BY ab.hit_bat_speed DESC",
        ),
        // HR-prop near-miss: out in >= 1 park but not a homer here.
        run(
          AT_BAT_RAIL(
            "ab.home_run_ballparks >= 1 AND ab.result_event_type <> 'home_run'",
          ) + "ORDER BY ab.home_run_ballparks DESC, ab.hit_launch_speed DESC",
        ),
        run(PITCHER_RAIL("x.maxVelo DESC")),
        run(PITCHER_RAIL("x.whiffs DESC")),
      ]);

    return jsonWithEtag(req, {
      ...empty,
      topEv: evRes.recordset,
      topDist: distRes.recordset,
      topBatSpeed: batSpeedRes.recordset,
      hrParkNearMiss: nearMissRes.recordset,
      topPitchVelo: veloRes.recordset,
      topWhiffs: whiffRes.recordset,
    });
  } catch (err) {
    return apiError(err, "api/mlb/research/leaders");
  }
}
