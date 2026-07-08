import { NextRequest, NextResponse } from "next/server";
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { fetchLiveGame } from "@/lib/mlbLiveStatcast";

export async function GET(req: NextRequest) {
  const gamePk = req.nextUrl.searchParams.get("gamePk");
  if (!gamePk)
    return NextResponse.json({ error: "gamePk required" }, { status: 400 });

  const pool = await getPool();

  // One row per completed at-bat from the materialized table. Names are
  // joined from mlb.players at read time because mlb.players is truncate-
  // and-reload scoped to the current season, so denormalizing names onto
  // historical rows leaves ~30% NULL. mlb.players has under a thousand
  // rows with a PK on player_id, so these joins are effectively free.
  const result = await pool
    .request()
    .input("gamePk", mssql.Int, parseInt(gamePk))
    .query(
      `SELECT
         a.at_bat_number       AS atBatNumber,
         a.inning              AS inning,
         a.is_top_inning       AS isTop,
         a.batter_id           AS batterId,
         pb.player_name        AS batterName,
         a.pitcher_id          AS pitcherId,
         pp.player_name        AS pitcherName,
         a.result_event_type   AS resultType,
         a.result_description  AS resultDesc,
         a.result_rbi          AS rbi,
         a.hit_launch_speed    AS exitVelo,
         a.hit_launch_angle    AS launchAngle,
         a.hit_total_distance  AS distance,
         a.hit_trajectory      AS trajectory,
         a.hit_hardness        AS hardness,
         a.hit_probability     AS hitProb,
         a.hit_bat_speed       AS batSpeed,
         a.home_run_ballparks  AS hrBallparks,
         a.away_team_id        AS awayTeamId,
         a.home_team_id        AS homeTeamId
       FROM mlb.player_at_bats a
       LEFT JOIN mlb.players pb ON pb.player_id = a.batter_id
       LEFT JOIN mlb.players pp ON pp.player_id = a.pitcher_id
       WHERE a.game_pk = @gamePk
       ORDER BY a.at_bat_number`,
    );

  if (result.recordset.length > 0) {
    return NextResponse.json({
      gamePk: parseInt(gamePk),
      atBats: result.recordset,
      source: "db",
    });
  }

  // No settled rows yet — the nightly play-by-play load only ingests games
  // after they go Final, so an in-progress (or just-finished, pre-load) game
  // has nothing in mlb.player_at_bats. Fall back to the live GUMBO feed,
  // which carries batted-ball EV/LA/distance within seconds of each play.
  // Same DB-first / live-fallback shape as mlb-linescore. hitProb, batSpeed,
  // and hrBallparks are modeled (Savant) and stay null until the load runs.
  const live = await fetchLiveGame(parseInt(gamePk));
  if (live && live.atBats.length > 0) {
    return NextResponse.json({
      gamePk: parseInt(gamePk),
      atBats: live.atBats,
      source: "live",
    });
  }

  return NextResponse.json({
    gamePk: parseInt(gamePk),
    atBats: result.recordset,
    source: "db",
  });
}
