import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { getBoxscore } from '@/lib/queries';

export async function GET(req: NextRequest) {
  const gameId = req.nextUrl.searchParams.get('gameId');
  if (!gameId) {
    return NextResponse.json({ error: 'gameId required' }, { status: 400 });
  }

  try {
    const rows = await getBoxscore(gameId);
    return NextResponse.json({ gameId, rows });
  } catch (err) {
    return apiError(err, 'api/boxscore');
  }
}
