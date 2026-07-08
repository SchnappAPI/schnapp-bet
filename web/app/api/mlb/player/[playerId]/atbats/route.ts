import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { todayCT } from "@/lib/mlbLive";
import { fetchLiveGame } from "@/lib/mlbLiveStatcast";

// Comprehensive per-at-bat Statcast log for one batter, current season.
// Raw rows only — the client computes summary tiles (avg/max EV, hard-hit%,
// barrel%, avg xBA) over the FILTERED set so tiles always match visible
// rows. Definitions must mirror the ETL (mlb_play_by_play.py):
//   hard-hit = EV >= 95;  barrel = EV >= 95 AND 8 <= LA <= 32.

export interface MlbAtBatRow {
  atBatId: string;
  gamePk: number;
  gameDate: string;
  inning: number | null;
  oppAbbr: string | null;
  pitcherId: number | null;
  pitcherName: string | null;
  pitcherHand: string | null;
  result: string | null;
  resultDesc: string | null;
  rbi: number | null;
  ev: number | null;
  la: number | null;
  dist: number | null;
  trajectory: string | null;
  hardness: string | null;
  xba: number | null;
  batSpeed: number | null;
  hrParks: number | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId: playerIdStr } = await params;
  const playerId = parseInt(playerIdStr, 10);
  if (isNaN(playerId)) {
    return NextResponse.json({ error: "invalid playerId" }, { status: 400 });
  }

  try {
    const pool = await getPool();
    const res = await pool.request().input("playerId", mssql.Int, playerId)
      .query<MlbAtBatRow>(`
        SELECT
          ab.at_bat_id          AS atBatId,
          ab.game_pk            AS gamePk,
          CONVERT(VARCHAR(10), ab.game_date, 120) AS gameDate,
          ab.inning,
          t.team_abbreviation   AS oppAbbr,
          ab.pitcher_id         AS pitcherId,
          p.player_name         AS pitcherName,
          p.pitch_hand          AS pitcherHand,
          ab.result_event_type  AS result,
          ab.result_description AS resultDesc,
          ab.result_rbi         AS rbi,
          ab.hit_launch_speed   AS ev,
          ab.hit_launch_angle   AS la,
          ab.hit_total_distance AS dist,
          ab.hit_trajectory     AS trajectory,
          ab.hit_hardness       AS hardness,
          ab.hit_probability    AS xba,
          ab.hit_bat_speed      AS batSpeed,
          ab.home_run_ballparks AS hrParks
        FROM mlb.player_at_bats ab
        LEFT JOIN mlb.teams t
          ON t.team_id = CASE WHEN ab.is_top_inning = 1
                              THEN ab.home_team_id
                              ELSE ab.away_team_id END
        LEFT JOIN mlb.players p ON p.player_id = ab.pitcher_id
        WHERE ab.batter_id = @playerId
          AND ab.game_date >= DATEFROMPARTS(YEAR(GETUTCDATE()), 1, 1)
        ORDER BY ab.game_date DESC, ab.game_pk DESC, ab.at_bat_number DESC
      `);

    const dbRows = res.recordset;

    // Live overlay: if this batter's team has an in-progress game today whose
    // pitch data has not loaded yet (the nightly play-by-play run only ingests
    // Final games), prepend the live at-bats from the MLB Gameday feed. EV/LA
    // arrive within seconds of contact; xba/batSpeed/hrParks are modeled
    // (Savant) and settle in the nightly load, so they stay null live.
    const today = todayCT();
    const gameRes = await pool
      .request()
      .input("playerId", mssql.Int, playerId)
      .input("today", mssql.VarChar, today).query<{
      gamePk: number;
      gameDate: string;
      oppAbbr: string | null;
    }>(`
        SELECT TOP 1
          g.game_pk AS gamePk,
          CONVERT(VARCHAR(10), g.game_date, 120) AS gameDate,
          CASE WHEN g.home_team_id = pl.team_id
               THEN ta.team_abbreviation
               ELSE th.team_abbreviation END AS oppAbbr
        FROM mlb.players pl
        JOIN mlb.games g
          ON (g.home_team_id = pl.team_id OR g.away_team_id = pl.team_id)
         AND CONVERT(VARCHAR(10), g.game_date, 120) = @today
        JOIN mlb.teams ta ON ta.team_id = g.away_team_id
        JOIN mlb.teams th ON th.team_id = g.home_team_id
        WHERE pl.player_id = @playerId AND g.game_status <> 'F'
        ORDER BY g.game_pk DESC
      `);

    const todayGame = gameRes.recordset[0];
    let live = false;
    let atBats: MlbAtBatRow[] = dbRows;

    if (todayGame) {
      const feed = await fetchLiveGame(todayGame.gamePk);
      if (feed && feed.abstractState === "Live") {
        const liveRows: MlbAtBatRow[] = feed.atBats
          .filter((ab) => ab.batterId === playerId)
          .sort((a, b) => b.atBatNumber - a.atBatNumber)
          .map((ab) => ({
            atBatId: `live-${todayGame.gamePk}-${ab.atBatNumber}`,
            gamePk: todayGame.gamePk,
            gameDate: todayGame.gameDate,
            inning: ab.inning,
            oppAbbr: todayGame.oppAbbr,
            pitcherId: ab.pitcherId || null,
            pitcherName: ab.pitcherName || null,
            pitcherHand: ab.pitcherHand,
            result: ab.resultType,
            resultDesc: ab.resultDesc,
            rbi: ab.rbi,
            ev: ab.exitVelo,
            la: ab.launchAngle,
            dist: ab.distance,
            trajectory: ab.trajectory,
            hardness: ab.hardness,
            xba: null,
            batSpeed: null,
            hrParks: null,
          }));
        if (liveRows.length > 0) {
          live = true;
          // Defensive de-dupe: drop any settled rows for today's game (the
          // nightly load has not run) before prepending the live ones.
          atBats = [
            ...liveRows,
            ...dbRows.filter((r) => r.gamePk !== todayGame.gamePk),
          ];
        }
      }
    }

    // A live merge must never be cached; the settled-only response can be.
    if (live) return NextResponse.json({ playerId, atBats, live });
    return jsonWithEtag(req, { playerId, atBats, live });
  } catch (err) {
    return apiError(err, "api/mlb/player/[playerId]/atbats");
  }
}
