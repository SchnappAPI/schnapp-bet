import { NextRequest, NextResponse } from "next/server";
import mssql from "mssql";
import { getPool } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ gamePk: string }> },
) {
  const { gamePk: gamePkStr } = await params;
  const gamePk = parseInt(gamePkStr, 10);
  if (isNaN(gamePk)) {
    return NextResponse.json({ error: "invalid gamePk" }, { status: 400 });
  }

  try {
    const pool = await getPool();
    const result = await pool.request().input("gamePk", mssql.Int, gamePk)
      .query(`
        SELECT
          g.game_pk             AS gamePk,
          CONVERT(VARCHAR(10), g.game_date, 120) AS gameDate,
          g.game_datetime       AS gameDateTime,
          g.game_status         AS gameStatus,
          g.game_display        AS gameDisplay,
          at.team_id            AS awayTeamId,
          at.team_abbreviation  AS awayTeamAbbr,
          at.full_name          AS awayTeamName,
          ht.team_id            AS homeTeamId,
          ht.team_abbreviation  AS homeTeamAbbr,
          ht.full_name          AS homeTeamName,
          g.away_team_score     AS awayScore,
          g.home_team_score     AS homeScore,
          g.away_pitcher_id     AS awayPitcherId,
          g.away_pitcher_name   AS awayPitcher,
          g.away_pitcher_hand   AS awayPitcherHand,
          g.home_pitcher_id     AS homePitcherId,
          g.home_pitcher_name   AS homePitcher,
          g.home_pitcher_hand   AS homePitcherHand
        FROM mlb.games g
        JOIN mlb.teams at ON at.team_id = g.away_team_id
        JOIN mlb.teams ht ON ht.team_id = g.home_team_id
        WHERE g.game_pk = @gamePk
      `);

    if (!result.recordset[0]) {
      return NextResponse.json({ error: "game not found" }, { status: 404 });
    }

    return NextResponse.json({ game: result.recordset[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
