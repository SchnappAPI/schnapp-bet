import { headers } from "next/headers";
import HomeHub from "./HomeHub";

// Pre-fetches the /api/games/today response on the server so the dashboard
// renders fully populated on first paint instead of flashing an empty shell
// while the client waits on the SWR call. The initial value is handed to
// SWR as `fallbackData`, which suppresses the redundant client-side fetch
// and lets polling pick up from the next refresh interval.
//
// Wrapped in catch() so a slow / failing endpoint doesn't block render —
// the page falls back to the HomeHub skeleton state and SWR retries on the
// client.
async function fetchInitial() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const base = `${proto}://${host}`;

  const games = await fetch(`${base}/api/games/today`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  return { games };
}

export default async function HomePage() {
  const initial = await fetchInitial();
  return <HomeHub initial={initial} />;
}
