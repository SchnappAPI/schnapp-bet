import { NextRequest, NextResponse } from "next/server";
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

  const sp = req.nextUrl.searchParams;
  const rawLimit = parseInt(sp.get("limit") ?? "8", 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 50 ? rawLimit : 8;

  try {
    const pool = await getPool();

    const anchor = await pool
      .request()
      .input("gameId", mssql.VarChar, id)
      .query<{
        gameDate: string;
        homeTeamId: number;
        awayTeamId: number;
      }>(
        `SELECT
           CONVERT(VARCHAR(10), game_date, 120) AS gameDate,
           home_team_id                         AS homeTeamId,
           away_team_id                         AS awayTeamId
         FROM nba.schedule
         WHERE game_id = @gameId`,
      );

    const a = anchor.recordset[0];
    if (!a) {
      return NextResponse.json({ error: "game not found" }, { status: 404 });
    }

    const result = await pool
      .request()
      .input("teamA", mssql.Int, a.homeTeamId)
      .input("teamB", mssql.Int, a.awayTeamId)
      .input("anchorDate", mssql.VarChar, a.gameDate)
      .input("anchorId", mssql.VarChar, id)
      .input("lim", mssql.Int, limit)
      .query<DbRow>(
        `SELECT TOP (@lim)
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
         WHERE s.game_id <> @anchorId
           AND s.game_date < @anchorDate
           AND (
             (s.home_team_id = @teamA AND s.away_team_id = @teamB) OR
             (s.home_team_id = @teamB AND s.away_team_id = @teamA)
           )
         ORDER BY s.game_date DESC, s.game_id DESC`,
      );

    return jsonWithEtag(req, {
      games: result.recordset,
      anchor: {
        gameId: id,
        gameDate: a.gameDate,
        homeTeamId: a.homeTeamId,
        awayTeamId: a.awayTeamId,
      },
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
