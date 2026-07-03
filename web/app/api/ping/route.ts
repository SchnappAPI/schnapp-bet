import { NextResponse } from 'next/server';
import { ping } from '@/lib/queries';

export async function GET() {
  try {
    await ping();
    return NextResponse.json({ status: 'ok', ts: new Date().toISOString() });
  } catch (err) {
    console.error('[api] api/ping:', err);
    return NextResponse.json(
      { status: 'error', error: 'Internal server error' },
      { status: 500 },
    );
  }
}
