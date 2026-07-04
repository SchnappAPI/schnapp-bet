import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { todayCT } from "@/lib/mlbLive";

// Research-dashboard slate: one day's games with display labels, probable
// SPs + hands, and confirmed-lineup status per side. Feeds the game slicer
// row on /mlb/research (docs/features/mlb-research-dashboard.md Phase 2).
// Doubleheader games carry a "Gm 1"/"Gm 2" suffix in gameDisplay.

export interface SlateGame {
  gamePk: number;
  gameDate: string;
  gameDateTime: string | null;
  gameStatus: string | null;
  gameDisplay: string;
  awayTeamId: number;
  awayTeamAbbr: string;
  homeTeamId: number;
  homeTeamAbbr: string;
  awayPitcherId: number | null;
  awayPitcherName: string | null;
  awayPitcherHand: string | null;
  homePitcherId: number | null;
  homePitcherName: string | null;
  homePitcherHand: string | null;
  awayLineupConfirmed: boolean;
  homeLineupConfirmed: boolean;
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayCT();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  try {
    const pool = await getPool();
    const res = await pool.request().input("date", mssql.VarChar, date).query(`
        SELECT
          g.game_pk           AS gamePk,
          CONVERT(VARCHAR(10), g.game_date, 120) AS gameDate,
          g.game_datetime     AS gameDateTime,
          g.game_status       AS gameStatus,
          g.double_header     AS doubleHeader,
          g.game_number       AS gameNumber,
          at.team_id           AS awayTeamId,
          at.team_abbreviation AS awayTeamAbbr,
          ht.team_id           AS homeTeamId,
          ht.team_abbreviation AS homeTeamAbbr,
          g.away_pitcher_id    AS awayPitcherId,
          g.away_pitcher_name  AS awayPitcherName,
          g.away_pitcher_hand  AS awayPitcherHand,
          g.home_pitcher_id    AS homePitcherId,
          g.home_pitcher_name  AS homePitcherName,
          g.home_pitcher_hand  AS homePitcherHand,
          CASE WHEN EXISTS (
            SELECT 1 FROM mlb.daily_lineups dl
            WHERE dl.game_pk = g.game_pk AND dl.team_id = g.away_team_id
          ) THEN 1 ELSE 0 END AS awayLineupConfirmed,
          CASE WHEN EXISTS (
            SELECT 1 FROM mlb.daily_lineups dl
            WHERE dl.game_pk = g.game_pk AND dl.team_id = g.home_team_id
          ) THEN 1 ELSE 0 END AS homeLineupConfirmed
        FROM mlb.games g
        JOIN mlb.teams at ON at.team_id = g.away_team_id
        JOIN mlb.teams ht ON ht.team_id = g.home_team_id
        WHERE CONVERT(VARCHAR(10), g.game_date, 120) = @date
        ORDER BY g.game_datetime, g.game_pk
      `);

    const games: SlateGame[] = res.recordset.map((r: any) => {
      const dh =
        r.doubleHeader && r.doubleHeader !== "N" && r.gameNumber
          ? ` Gm ${r.gameNumber}`
          : "";
      const { doubleHeader, gameNumber, ...rest } = r;
      return {
        ...rest,
        gameDisplay: `${r.awayTeamAbbr} @ ${r.homeTeamAbbr}${dh}`,
        awayLineupConfirmed: r.awayLineupConfirmed === 1,
        homeLineupConfirmed: r.homeLineupConfirmed === 1,
      };
    });

    return jsonWithEtag(req, { date, games });
  } catch (err) {
    return apiError(err, "api/mlb/research/slate");
  }
}
