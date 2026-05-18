import { NextRequest, NextResponse } from 'next/server';
import mssql from 'mssql';
import { getPool } from '@/lib/db';
import { jsonWithEtag } from '@/lib/etag';

// Map the frontend's compact market token to:
//  - the per-game stat column we should sum from nba.player_box_score_stats
//  - the LIKE prefix that captures both standard and *_alternate market_key
//    rows in common.daily_grades. Without the LIKE we'd miss alt lines
//    served on the same date.
const MARKET_DEFS: Record<string, { stat: string; likePrefix: string }> = {
  PTS:  { stat: 'pts',  likePrefix: 'player_points' },
  REB:  { stat: 'reb',  likePrefix: 'player_rebounds' },
  AST:  { stat: 'ast',  likePrefix: 'player_assists' },
  STL:  { stat: 'stl',  likePrefix: 'player_steals' },
  BLK:  { stat: 'blk',  likePrefix: 'player_blocks' },
  TOV:  { stat: 'tov',  likePrefix: 'player_turnovers' },
  FG3M: { stat: 'fg3m', likePrefix: 'player_threes' },
};

interface HistoryRow {
  date: string;
  game_id: string;
  value: number | null;
  line: number | null;
  hit: 'over' | 'under' | 'push' | null;
}

interface DbRow {
  gameDate: string;
  gameId: string;
  statValue: number | null;
  lineValue: number | null;
  outcomeName: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const playerId = parseInt(id, 10);
  if (isNaN(playerId)) {
    return NextResponse.json({ error: 'invalid player id' }, { status: 400 });
  }

  const market = (req.nextUrl.searchParams.get('market') ?? 'PTS').toUpperCase();
  const def = MARKET_DEFS[market];
  if (!def) {
    return NextResponse.json({ error: `unknown market: ${market}` }, { status: 400 });
  }

  const nRaw = req.nextUrl.searchParams.get('n');
  const n = Math.max(1, Math.min(50, parseInt(nRaw ?? '10', 10) || 10));

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('playerId', mssql.Int, playerId)
      .input('marketLike', mssql.VarChar, `${def.likePrefix}%`)
      .input('n', mssql.Int, n)
      .query<DbRow>(
        `WITH game_totals AS (
           SELECT
             pbs.game_id,
             pbs.game_date,
             SUM(pbs.${def.stat}) AS stat_value
           FROM nba.player_box_score_stats pbs
           WHERE pbs.player_id = @playerId
           GROUP BY pbs.game_id, pbs.game_date
         ),
         line_per_game AS (
           -- Pick the standard 'Over' line for the player on that date.
           -- A player can have multiple alternate lines per game; for
           -- sparkline rendering we want the canonical posted line, so
           -- prefer the non-alternate market_key when available.
           SELECT
             dg.game_id,
             dg.grade_date,
             dg.line_value,
             dg.outcome_name,
             ROW_NUMBER() OVER (
               PARTITION BY dg.game_id
               ORDER BY
                 CASE WHEN dg.market_key NOT LIKE '%_alternate' THEN 0 ELSE 1 END,
                 CASE WHEN COALESCE(dg.outcome_name, 'Over') = 'Over' THEN 0 ELSE 1 END,
                 dg.grade_id DESC
             ) AS rn
           FROM common.daily_grades dg
           WHERE dg.player_id = @playerId
             AND dg.market_key LIKE @marketLike
             AND dg.bookmaker_key = 'fanduel'
         )
         SELECT TOP (@n)
           CONVERT(VARCHAR(10), gt.game_date, 120) AS gameDate,
           gt.game_id                              AS gameId,
           gt.stat_value                           AS statValue,
           lpg.line_value                          AS lineValue,
           lpg.outcome_name                        AS outcomeName
         FROM game_totals gt
         LEFT JOIN line_per_game lpg
           ON lpg.game_id = gt.game_id AND lpg.rn = 1
         ORDER BY gt.game_date DESC`
      );

    const points: HistoryRow[] = result.recordset.map((r) => {
      let hit: 'over' | 'under' | 'push' | null = null;
      if (r.lineValue != null && r.statValue != null) {
        if (r.statValue > r.lineValue)      hit = 'over';
        else if (r.statValue < r.lineValue) hit = 'under';
        else                                hit = 'push';
      }
      return {
        date:    r.gameDate,
        game_id: r.gameId,
        value:   r.statValue,
        line:    r.lineValue,
        hit,
      };
    });

    // Reverse so the array is chronological (oldest → newest) — sparklines
    // render left-to-right in time.
    points.reverse();

    return jsonWithEtag(req, {
      player_id: playerId,
      market,
      points,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
