import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import mssql from 'mssql';
import { getPool } from '@/lib/db';

export async function GET(req: NextRequest) {
  const gameId = req.nextUrl.searchParams.get('gameId');
  if (!gameId) {
    return NextResponse.json({ error: 'gameId required' }, { status: 400 });
  }
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('gameId', mssql.VarChar, gameId)
      .query(
        `SELECT TOP 1 gs.payload
         FROM common.game_supplemental gs
         WHERE gs.game_id = @gameId
         ORDER BY gs.generated_at DESC`
      );
    if (result.recordset.length === 0) {
      return NextResponse.json({ gameId, payload: null });
    }
    const raw = result.recordset[0].payload as string;
    const payload = JSON.parse(raw);
    return NextResponse.json({ gameId, payload });
  } catch (err) {
    return apiError(err, 'api/game-supplemental');
  }
}
