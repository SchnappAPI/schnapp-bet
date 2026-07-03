import { NextRequest, NextResponse } from 'next/server';
import mssql from 'mssql';
import { getPool } from '@/lib/db';
import { apiError } from '@/lib/apiError';

// NFL week slate. nfl.games (nflverse schedules) has one row per game with
// game_type in ('REG','WC','DIV','CON','SB') and week numbering that runs
// straight through the playoffs (REG 1-18, WC=19, DIV=20, CON=21, SB=22).
// The API collapses the four playoff types into season_type='POST' to match
// nfl.player_game_stats.season_type ('REG'|'POST').

type SeasonType = 'REG' | 'POST';

// Fixed literals only — interpolated into SQL, never user input.
const POST_TYPES_SQL = `('WC','DIV','CON','SB')`;

function typePredicate(seasonType: SeasonType): string {
  return seasonType === 'REG' ? `game_type = 'REG'` : `game_type IN ${POST_TYPES_SQL}`;
}

function parseSeasonType(raw: string | null): SeasonType {
  return raw?.toUpperCase() === 'POST' ? 'POST' : 'REG';
}

function todayCT(): string {
  const now = new Date();
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return `${ct.getFullYear()}-${String(ct.getMonth() + 1).padStart(2, '0')}-${String(ct.getDate()).padStart(2, '0')}`;
}

export interface NflGameRow {
  gameId: string;
  season: number;
  gameType: string;
  week: number;
  gameDate: string | null;
  weekday: string | null;
  gametime: string | null; // 'HH:MM' Eastern, from nflverse
  awayTeam: string;
  awayScore: number | null;
  homeTeam: string;
  homeScore: number | null;
  spreadLine: number | null; // positive = home favored by that many
  totalLine: number | null;
  awayMoneyline: number | null;
  homeMoneyline: number | null;
  overtime: number | null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  try {
    const pool = await getPool();
    const seasonType = parseSeasonType(sp.get('season_type'));

    // Season: explicit param, else the latest season present.
    let season = parseInt(sp.get('season') ?? '', 10);
    const seasonsRes = await pool
      .request()
      .query<{ season: number }>(
        `SELECT DISTINCT season FROM nfl.games WHERE season IS NOT NULL ORDER BY season DESC`,
      );
    const seasons = seasonsRes.recordset.map((r) => r.season);
    if (isNaN(season)) season = seasons[0];
    if (seasons.length === 0 || !seasons.includes(season)) {
      return NextResponse.json(
        { error: 'no games for requested season' },
        { status: 404 },
      );
    }

    // Weeks available for this season + season_type, with each week's last
    // game date so the default week can be resolved server-side.
    const weeksRes = await pool
      .request()
      .input('season', mssql.Int, season)
      .query<{ week: number; lastDate: string | null }>(
        `SELECT week, CONVERT(VARCHAR(10), MAX(game_date), 120) AS lastDate
         FROM nfl.games
         WHERE season = @season AND ${typePredicate(seasonType)}
         GROUP BY week
         ORDER BY week`,
      );
    const weekRows = weeksRes.recordset;
    if (weekRows.length === 0) {
      return NextResponse.json({
        season,
        seasonType,
        week: null,
        seasons,
        weeks: [],
        games: [],
      });
    }
    const weeks = weekRows.map((r) => r.week);

    // Week: explicit param, else the current/next week with games — the
    // first week whose last game is today or later; if the season is over,
    // the final week.
    let week = parseInt(sp.get('week') ?? '', 10);
    if (isNaN(week)) {
      const today = todayCT();
      const upcoming = weekRows.find((r) => r.lastDate !== null && r.lastDate >= today);
      week = upcoming ? upcoming.week : weeks[weeks.length - 1];
    }
    if (!weeks.includes(week)) {
      return NextResponse.json({ season, seasonType, week, seasons, weeks, games: [] });
    }

    const gamesRes = await pool
      .request()
      .input('season', mssql.Int, season)
      .input('week', mssql.Int, week)
      .query<NflGameRow>(
        `SELECT
           game_id                                 AS gameId,
           season,
           game_type                               AS gameType,
           week,
           CONVERT(VARCHAR(10), game_date, 120)    AS gameDate,
           weekday,
           gametime,
           away_team                               AS awayTeam,
           away_score                              AS awayScore,
           home_team                               AS homeTeam,
           home_score                              AS homeScore,
           spread_line                             AS spreadLine,
           total_line                              AS totalLine,
           away_moneyline                          AS awayMoneyline,
           home_moneyline                          AS homeMoneyline,
           overtime
         FROM nfl.games
         WHERE season = @season AND week = @week AND ${typePredicate(seasonType)}
         ORDER BY game_date, gametime, game_id`,
      );

    return NextResponse.json({
      season,
      seasonType,
      week,
      seasons,
      weeks,
      games: gamesRes.recordset,
    });
  } catch (err) {
    return apiError(err, 'api/nfl/games');
  }
}
