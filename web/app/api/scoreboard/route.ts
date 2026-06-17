import { NextResponse } from 'next/server';
import { requireSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RUNNER_URL = process.env.RUNNER_URL ?? 'https://mac-flask.schnapp.bet';
const TIMEOUT_MS = 10_000;

export async function GET() {
  try {
    // In production a missing RUNNER_API_KEY throws here (caught below -> 503).
    // We never call the runner with a repo-published default key. See ADR-20260617-1.
    const RUNNER_KEY = requireSecret('RUNNER_API_KEY', 'runner-Lake4971');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(`${RUNNER_URL}/scoreboard`, {
      headers: { 'X-Runner-Key': RUNNER_KEY },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!resp.ok) {
      return NextResponse.json({ error: `Runner returned ${resp.status}` }, { status: 502 });
    }
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Runner unavailable: ${message}` }, { status: 503 });
  }
}
