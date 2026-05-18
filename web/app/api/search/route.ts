import { NextRequest, NextResponse } from 'next/server';
import mssql from 'mssql';
import { getPool } from '@/lib/db';

interface PlayerHit {
  id: number;
  name: string;
  team_abbr: string | null;
  sport: 'nba' | 'mlb';
}

interface GameHit {
  id: string;
  label: string;
  sport: 'nba' | 'mlb';
  date: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function parseTypes(raw: string | null): { players: boolean; games: boolean } {
  if (!raw) return { players: true, games: true };
  const parts = new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return {
    players: parts.has('players') || parts.has('player'),
    games:   parts.has('games')   || parts.has('game'),
  };
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const limitRaw = req.nextUrl.searchParams.get('limit');
  const limit = Math.max(1, Math.min(MAX_LIMIT, parseInt(limitRaw ?? '', 10) || DEFAULT_LIMIT));
  const types = parseTypes(req.nextUrl.searchParams.get('types'));

  if (q.length < 2) {
    // Bail on very short queries — LIKE '%a%' over <2K rows is fine but
    // returns mostly noise. Single-letter search is essentially ungated.
    return NextResponse.json(
      { players: [], games: [] },
      { headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' } }
    );
  }

  try {
    const pool = await getPool();
    const like = `%${q}%`;

    // UNION over nba.players + mlb.players. There is NO common.players table.
    // <2K total rows so LIKE '%q%' is fine; FTS is unnecessary.
    const playerPromise = types.players
      ? pool
          .request()
          .input('like',  mssql.NVarChar, like)
          .input('limit', mssql.Int, limit)
          .query<{ id: number; name: string; team_abbr: string | null; sport: 'nba' | 'mlb' }>(
            `SELECT TOP (@limit) id, name, team_abbr, sport
             FROM (
               SELECT
                 p.player_id    AS id,
                 p.player_name  AS name,
                 p.team_tricode AS team_abbr,
                 'nba'          AS sport
               FROM nba.players p
               WHERE p.player_name LIKE @like

               UNION ALL

               SELECT
                 p.player_id   AS id,
                 p.player_name AS name,
                 t.team_abbreviation AS team_abbr,
                 'mlb'         AS sport
               FROM mlb.players p
               LEFT JOIN mlb.teams t ON t.team_id = p.team_id
               WHERE p.player_name LIKE @like
             ) AS u
             ORDER BY name`
          )
      : Promise.resolve({ recordset: [] as Array<{ id: number; name: string; team_abbr: string | null; sport: 'nba' | 'mlb' }> });

    // Games: limited to today and upcoming. Yesterday's finals can be looked
    // up other ways. Searching across full history would be expensive even
    // at the current scale and yields ambiguous results (multiple meetings).
    // The label is built server-side: 'AWY @ HME · YYYY-MM-DD'.
    const gamePromise = types.games
      ? pool
          .request()
          .input('like',  mssql.VarChar, like)
          .input('limit', mssql.Int, limit)
          .query<{ id: string; label: string; sport: 'nba' | 'mlb'; date: string }>(
            `SELECT TOP (@limit) id, label, sport, date
             FROM (
               SELECT
                 s.game_id AS id,
                 (at.team_tricode + ' @ ' + ht.team_tricode + ' · ' +
                  CONVERT(VARCHAR(10), s.game_date, 120))                 AS label,
                 'nba'                                                     AS sport,
                 CONVERT(VARCHAR(10), s.game_date, 120)                    AS date
               FROM nba.schedule s
               JOIN nba.teams ht ON ht.team_id = s.home_team_id
               JOIN nba.teams at ON at.team_id = s.away_team_id
               WHERE s.game_date >= CAST(GETUTCDATE() AS DATE)
                 AND (at.team_tricode LIKE @like
                      OR ht.team_tricode LIKE @like
                      OR at.team_name LIKE @like
                      OR ht.team_name LIKE @like)

               UNION ALL

               SELECT
                 CAST(g.game_pk AS VARCHAR(20))                            AS id,
                 (at.team_abbreviation + ' @ ' + ht.team_abbreviation + ' · ' +
                  CONVERT(VARCHAR(10), g.game_date, 120))                  AS label,
                 'mlb'                                                     AS sport,
                 CONVERT(VARCHAR(10), g.game_date, 120)                    AS date
               FROM mlb.games g
               JOIN mlb.teams ht ON ht.team_id = g.home_team_id
               JOIN mlb.teams at ON at.team_id = g.away_team_id
               WHERE g.game_date >= CAST(GETUTCDATE() AS DATE)
                 AND (at.team_abbreviation LIKE @like
                      OR ht.team_abbreviation LIKE @like
                      OR at.full_name LIKE @like
                      OR ht.full_name LIKE @like)
             ) AS u
             ORDER BY date, label`
          )
      : Promise.resolve({ recordset: [] as Array<{ id: string; label: string; sport: 'nba' | 'mlb'; date: string }> });

    const [playersRes, gamesRes] = await Promise.all([playerPromise, gamePromise]);

    const players: PlayerHit[] = playersRes.recordset.map((r) => ({
      id:        r.id,
      name:      r.name,
      team_abbr: r.team_abbr,
      sport:     r.sport,
    }));
    const games: GameHit[] = gamesRes.recordset.map((r) => ({
      id:    r.id,
      label: r.label,
      sport: r.sport,
      date:  r.date,
    }));

    return NextResponse.json(
      { players, games },
      { headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
