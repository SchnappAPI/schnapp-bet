import { headers } from 'next/headers';
import HomeHub from './HomeHub';

// Pre-fetches the three Today Terminal API responses on the server so the
// dashboard renders fully populated on first paint instead of flashing an
// empty shell while the client waits on three parallel SWR calls. Each
// initial value is then handed to SWR as `fallbackData`, which suppresses
// the redundant client-side fetch and lets polling pick up from the
// next refresh interval.
//
// Each fetch is wrapped in catch() so a single slow / failing endpoint
// can't block the page render — the failing card falls back to the
// HomeHub skeleton state and SWR retries on the client.
async function fetchInitial() {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host  = h.get('host') ?? 'localhost:3000';
  const base  = `${proto}://${host}`;

  const get = (path: string) =>
    fetch(`${base}${path}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

  // Two fetches (was three): /api/grades/top now returns top rows + signal
  // counts in one response.
  const [games, top] = await Promise.all([
    get('/api/games/today'),
    get('/api/grades/top?n=10&sport=all'),
  ]);

  return { games, top };
}

export default async function HomePage() {
  const initial = await fetchInitial();
  return <HomeHub initial={initial} />;
}
