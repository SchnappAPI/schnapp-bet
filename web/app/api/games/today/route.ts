import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import mssql from 'mssql';
import { getPool } from '@/lib/db';
import { getGames, type GameRow } from '@/lib/queries';
import { requireSecret } from '@/lib/secrets';

const RUNNER_URL = process.env.RUNNER_URL ?? 'https://mac-flask.schnapp.bet';

function todayCT(): string {
  const now = new Date();
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return `${ct.getFullYear()}-${String(ct.getMonth() + 1).padStart(2, '0')}-${String(ct.getDate()).padStart(2, '0')}`;
}

type Status = 'scheduled' | 'live' | 'final' | 'postponed';

interface SportGame {
  id: string;
  sport: 'nba' | 'mlb' | 'nfl';
  away: { abbr: string; name: string };
  home: { abbr: string; name: string };
  tipoff_iso: string | null;
  status: Status;
  live?: { period?: string | null; clock?: string | null; away_score: number | null; home_score: number | null };
  market?: { spread: number | null; total: number | null };
}

// nba.schedule.game_status: 1=scheduled, 2=live, 3=final.
// mlb.games.game_status: 'F'=final, 'P'=postponed; otherwise scheduled or live.
function nbaStatus(g: GameRow): Status {
  if (g.gameStatus === 3) return 'final';
  if (g.gameStatus === 2) return 'live';
  // 1 = scheduled, but anything containing PPD in the status text means postponed.
  if (g.gameStatusText && /ppd|postponed/i.test(g.gameStatusText)) return 'postponed';
  return 'scheduled';
}

function mlbStatus(s: string | null): Status {
  if (!s) return 'scheduled';
  const u = s.toUpperCase();
  if (u === 'F' || u === 'FINAL') return 'final';
  if (u === 'P' || u === 'PPD' || u.startsWith('POSTP')) return 'postponed';
  if (u === 'I' || u === 'L' || u === 'LIVE' || u === 'IN PROGRESS') return 'live';
  return 'scheduled';
}

interface MlbRow {
  gameId: string | number;
  gameDate: string;
  gameStatus: string | null;
  awayTeamAbbr: string;
  homeTeamAbbr: string;
  awayTeamName: string;
  homeTeamName: string;
  awayScore: number | null;
  homeScore: number | null;
  gameDateTime: string | Date | null;
}

async function fetchNbaGames(date: string): Promise<{ count: number; games: SportGame[] }> {
  const games = await getGames('nba', date).catch(() => [] as GameRow[]);
  if (games.length === 0) return { count: 0, games: [] };

  // Overlay live CDN data (scoreboard) for in-progress games. The CDN is
  // never used to determine the game list — only to enrich live scores
  // and (where available) period/clock for games already in the DB.
  let cdnByGameId: Map<string, { gameStatus?: number; gameStatusText?: string; homeScore?: number; awayScore?: number; period?: string; clock?: string }> = new Map();
  if (date === todayCT()) {
    try {
      // In production a missing RUNNER_API_KEY throws here and is caught below,
      // dropping the live overlay (DB data still returns). We never call the
      // runner with a repo-published default key. See ADR-20260617-1.
      const RUNNER_KEY = requireSecret('RUNNER_API_KEY', 'runner-Lake4971');
      const res = await fetch(`${RUNNER_URL}/scoreboard`, {
        headers: { 'X-Runner-Key': RUNNER_KEY },
        // Tight timeout: if Flask CDN is slow, drop the live overlay and
        // let the next 30s SWR poll fill it in. The dashboard is a status
        // view; live scores can lag by one cycle without harm.
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const data = await res.json();
        for (const g of (data.games ?? [])) {
          cdnByGameId.set(String(g.gameId), g);
        }
      }
    } catch {
      // Flask unreachable — fall through with DB-only data.
    }
  }

  const out: SportGame[] = games.map((g) => {
    const cdn = cdnByGameId.get(g.gameId);
    const merged: GameRow = cdn
      ? {
          ...g,
          gameStatus:     (cdn.gameStatus ?? g.gameStatus) as number | null,
          gameStatusText: cdn.gameStatusText ?? g.gameStatusText,
          homeScore:      cdn.homeScore     ?? g.homeScore,
          awayScore:      cdn.awayScore     ?? g.awayScore,
        }
      : g;

    const status = nbaStatus(merged);
    const sg: SportGame = {
      id:        merged.gameId,
      sport:     'nba',
      away:      { abbr: merged.awayTeamAbbr, name: merged.awayTeamName },
      home:      { abbr: merged.homeTeamAbbr, name: merged.homeTeamName },
      tipoff_iso: merged.gameDate
        ? new Date(`${merged.gameDate}T00:00:00Z`).toISOString()
        : null,
      status,
      market: { spread: merged.spread, total: merged.total },
    };

    if (status === 'live' || status === 'final') {
      sg.live = {
        period:     cdn?.period ?? merged.gameStatusText ?? null,
        clock:      cdn?.clock  ?? null,
        away_score: merged.awayScore,
        home_score: merged.homeScore,
      };
    }

    return sg;
  });

  return { count: out.length, games: out };
}

async function fetchMlbGames(date: string): Promise<{ count: number; games: SportGame[] }> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('date', mssql.VarChar, date)
    .query<MlbRow>(
      `SELECT
         g.game_pk            AS gameId,
         CONVERT(VARCHAR(10), g.game_date, 120) AS gameDate,
         g.game_status        AS gameStatus,
         at.team_abbreviation AS awayTeamAbbr,
         ht.team_abbreviation AS homeTeamAbbr,
         at.full_name         AS awayTeamName,
         ht.full_name         AS homeTeamName,
         g.away_team_score    AS awayScore,
         g.home_team_score    AS homeScore,
         g.game_datetime      AS gameDateTime
       FROM mlb.games g
       JOIN mlb.teams at ON at.team_id = g.away_team_id
       JOIN mlb.teams ht ON ht.team_id = g.home_team_id
       WHERE CONVERT(VARCHAR(10), g.game_date, 120) = @date
       ORDER BY g.game_datetime, g.game_pk`
    );

  const games: SportGame[] = result.recordset.map((g) => {
    const status = mlbStatus(g.gameStatus);
    const tipoff = g.gameDateTime
      ? (g.gameDateTime instanceof Date ? g.gameDateTime.toISOString() : new Date(g.gameDateTime).toISOString())
      : null;

    const sg: SportGame = {
      id:         String(g.gameId),
      sport:      'mlb',
      away:       { abbr: g.awayTeamAbbr, name: g.awayTeamName },
      home:       { abbr: g.homeTeamAbbr, name: g.homeTeamName },
      tipoff_iso: tipoff,
      status,
    };

    if (status === 'live' || status === 'final') {
      sg.live = {
        away_score: g.awayScore,
        home_score: g.homeScore,
      };
    }

    return sg;
  });

  return { count: games.length, games };
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? todayCT();

  try {
    const [nba, mlb] = await Promise.all([fetchNbaGames(date), fetchMlbGames(date)]);

    return NextResponse.json({
      date,
      sports: {
        nba,
        mlb,
        nfl: { count: 0, games: [] },
      },
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return apiError(err, 'api/games/today');
  }
}
