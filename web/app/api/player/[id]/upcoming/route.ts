import { NextRequest, NextResponse } from "next/server";
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { jsonWithEtag } from "@/lib/etag";

interface DbRow {
  gameId: string;
  gameDate: string;
  oppTeamId: number | null;
  oppAbbr: string | null;
  homeOrAway: "home" | "away";
  gameStatusText: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const playerId = parseInt(id, 10);
  if (isNaN(playerId)) {
    return NextResponse.json({ error: "invalid player id" }, { status: 400 });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("playerId", mssql.Int, playerId)
      .query<DbRow>(
        `WITH player_team AS (
           SELECT team_id FROM nba.players WHERE player_id = @playerId
         )
         SELECT TOP 1
           s.game_id                              AS gameId,
           CONVERT(VARCHAR(10), s.game_date, 120) AS gameDate,
           CASE WHEN s.home_team_id = (SELECT team_id FROM player_team)
                THEN s.away_team_id ELSE s.home_team_id END AS oppTeamId,
           CASE WHEN s.home_team_id = (SELECT team_id FROM player_team)
                THEN s.away_team_tricode ELSE s.home_team_tricode END AS oppAbbr,
           CASE WHEN s.home_team_id = (SELECT team_id FROM player_team)
                THEN 'home' ELSE 'away' END AS homeOrAway,
           s.game_status_text                     AS gameStatusText
         FROM nba.schedule s
         WHERE (s.home_team_id = (SELECT team_id FROM player_team)
             OR s.away_team_id = (SELECT team_id FROM player_team))
           AND s.game_date >= CAST(GETUTCDATE() AS DATE)
         ORDER BY s.game_date ASC, s.game_id ASC`,
      );

    const row = result.recordset[0] ?? null;

    return jsonWithEtag(req, {
      player_id: playerId,
      upcoming: row
        ? {
            game_id: row.gameId,
            game_date: row.gameDate,
            opp_team_id: row.oppTeamId,
            opp_abbr: row.oppAbbr,
            home_or_away: row.homeOrAway,
            game_status_text: row.gameStatusText,
          }
        : null,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
