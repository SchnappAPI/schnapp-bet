import { NextRequest, NextResponse } from "next/server";
import { apiError } from '@/lib/apiError';
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { jsonWithEtag } from "@/lib/etag";

interface DbRow {
  gameId: string;
  gameDate: string;
  gameStatus: number | null;
  gameStatusText: string | null;
  homeTeamId: number;
  homeTeamAbbr: string;
  homeTeamName: string;
  homeScore: number | null;
  awayTeamId: number;
  awayTeamAbbr: string;
  awayTeamName: string;
  awayScore: number | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "gameId required" }, { status: 400 });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("gameId", mssql.VarChar, id)
      .query<DbRow>(
        `SELECT
           s.game_id                              AS gameId,
           CONVERT(VARCHAR(10), s.game_date, 120) AS gameDate,
           s.game_status                          AS gameStatus,
           s.game_status_text                     AS gameStatusText,
           s.home_team_id                         AS homeTeamId,
           ht.team_tricode                        AS homeTeamAbbr,
           ht.team_name                           AS homeTeamName,
           s.home_score                           AS homeScore,
           s.away_team_id                         AS awayTeamId,
           at.team_tricode                        AS awayTeamAbbr,
           at.team_name                           AS awayTeamName,
           s.away_score                           AS awayScore
         FROM nba.schedule s
         JOIN nba.teams ht ON ht.team_id = s.home_team_id
         JOIN nba.teams at ON at.team_id = s.away_team_id
         WHERE s.game_id = @gameId`,
      );

    const row = result.recordset[0] ?? null;
    if (!row) {
      return NextResponse.json({ error: "game not found" }, { status: 404 });
    }

    return jsonWithEtag(req, {
      game: row,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return apiError(err, 'api/game/[id]');
  }
}
