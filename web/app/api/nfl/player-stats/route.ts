import { NextRequest, NextResponse } from 'next/server';
import mssql from 'mssql';
import { getPool } from '@/lib/db';
import { apiError } from '@/lib/apiError';

// Per-player stat lines for one NFL week, from nfl.player_game_stats
// (nflverse weekly player stats). season_type here is the table's own
// 'REG' | 'POST'. Offensive skill positions only — kickers and defensive
// rows exist in the table but are noise for the prop-research table.

type SeasonType = 'REG' | 'POST';

function parseSeasonType(raw: string | null): SeasonType {
  return raw?.toUpperCase() === 'POST' ? 'POST' : 'REG';
}

export interface NflPlayerStatRow {
  playerId: string;
  playerName: string | null;
  position: string | null;
  team: string | null;
  opponent: string | null;
  completions: number | null;
  attempts: number | null;
  passYds: number | null;
  passTd: number | null;
  passInt: number | null;
  carries: number | null;
  rushYds: number | null;
  rushTd: number | null;
  targets: number | null;
  receptions: number | null;
  recYds: number | null;
  recTd: number | null;
  fantasyPoints: number | null;
  fantasyPointsPpr: number | null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  try {
    const pool = await getPool();
    const seasonType = parseSeasonType(sp.get('season_type'));
    const team = sp.get('team')?.toUpperCase() ?? null;

    // Season default: latest season with stat rows.
    let season = parseInt(sp.get('season') ?? '', 10);
    if (isNaN(season)) {
      const res = await pool
        .request()
        .query<{ season: number | null }>(
          `SELECT MAX(season) AS season FROM nfl.player_game_stats`,
        );
      const maxSeason = res.recordset[0]?.season;
      if (maxSeason == null) {
        return NextResponse.json({ season: null, seasonType, week: null, rows: [] });
      }
      season = maxSeason;
    }

    // Week default: latest week with stat rows for the season + type.
    let week = parseInt(sp.get('week') ?? '', 10);
    if (isNaN(week)) {
      const res = await pool
        .request()
        .input('season', mssql.Int, season)
        .input('seasonType', mssql.VarChar, seasonType)
        .query<{ week: number | null }>(
          `SELECT MAX(week) AS week
           FROM nfl.player_game_stats
           WHERE season = @season AND season_type = @seasonType`,
        );
      const maxWeek = res.recordset[0]?.week;
      if (maxWeek == null) {
        return NextResponse.json({ season, seasonType, week: null, rows: [] });
      }
      week = maxWeek;
    }

    const result = await pool
      .request()
      .input('season', mssql.Int, season)
      .input('week', mssql.Int, week)
      .input('seasonType', mssql.VarChar, seasonType)
      .input('team', mssql.VarChar, team)
      .query<NflPlayerStatRow>(
        `SELECT
           player_gsis_id          AS playerId,
           player_display_name     AS playerName,
           position,
           team,
           opponent_team           AS opponent,
           completions,
           attempts,
           passing_yards           AS passYds,
           passing_tds             AS passTd,
           passing_interceptions   AS passInt,
           carries,
           rushing_yards           AS rushYds,
           rushing_tds             AS rushTd,
           targets,
           receptions,
           receiving_yards         AS recYds,
           receiving_tds           AS recTd,
           fantasy_points          AS fantasyPoints,
           fantasy_points_ppr      AS fantasyPointsPpr
         FROM nfl.player_game_stats
         WHERE season = @season
           AND week = @week
           AND season_type = @seasonType
           AND (@team IS NULL OR team = @team)
           AND position IN ('QB','RB','FB','WR','TE')
         ORDER BY fantasy_points_ppr DESC, passing_yards DESC, player_display_name`,
      );

    return NextResponse.json({
      season,
      seasonType,
      week,
      team,
      rows: result.recordset,
    });
  } catch (err) {
    return apiError(err, 'api/nfl/player-stats');
  }
}
