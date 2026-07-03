import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { getPlayerProps } from '@/lib/queries';

export async function GET(req: NextRequest) {
  const playerIdRaw = req.nextUrl.searchParams.get('playerId');
  if (!playerIdRaw) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }
  const playerId = parseInt(playerIdRaw, 10);
  if (isNaN(playerId)) {
    return NextResponse.json({ error: 'playerId must be an integer' }, { status: 400 });
  }
  try {
    const props = await getPlayerProps(playerId);
    return NextResponse.json({ playerId, props });
  } catch (err) {
    return apiError(err, 'api/player-props');
  }
}
