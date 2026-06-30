import { NextRequest, NextResponse } from 'next/server';
import { requireSecret } from '@/lib/secrets';

// Proxies live box score requests through a Flask runner that calls the NBA
// CDN endpoints directly (no proxy needed for those CDN URLs).
//
// RUNNER_URL/RUNNER_API_KEY are env-driven so the same code can target the
// Mac-hosted Flask at mac-flask.schnapp.bet (prod) or local at 127.0.0.1:5000 (dev)
// without code changes.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RUNNER_URL = process.env.RUNNER_URL ?? 'https://mac-flask.schnapp.bet';
const TIMEOUT_MS = 10_000;

export async function GET(req: NextRequest) {
  const gameId = req.nextUrl.searchParams.get('gameId');
  if (!gameId) {
    return NextResponse.json({ error: 'gameId required' }, { status: 400 });
  }

  try {
    // In production a missing RUNNER_API_KEY throws here (caught below -> 503).
    // We never call the runner with a repo-published default key. See ADR-20260617-1.
    const RUNNER_KEY = requireSecret('RUNNER_API_KEY', 'runner-Lake4971');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const resp = await fetch(
      `${RUNNER_URL}/boxscore?gameId=${encodeURIComponent(gameId)}`,
      {
        headers: { 'X-Runner-Key': RUNNER_KEY },
        signal: controller.signal,
        cache: 'no-store',
      }
    );
    clearTimeout(timer);

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return NextResponse.json(
        { error: body.error ?? `Runner returned ${resp.status}` },
        { status: 502 }
      );
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Runner unavailable: ${message}` }, { status: 503 });
  }
}
