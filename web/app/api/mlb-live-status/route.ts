import { NextRequest, NextResponse } from "next/server";
import { fetchMlbLiveOverlay, todayCT } from "@/lib/mlbLive";

// Lightweight "is any MLB game live right now" check for the sidebar Live
// badge. One statsapi schedule call (via the shared overlay) — deliberately
// NOT the heavy mlb-live-hardhit feed aggregation — so a global nav badge that
// polls this stays cheap. Cached ~20s so N clients collapse to ~1 upstream call.

let cache: { at: number; live: boolean; count: number } | null = null;
const TTL_MS = 20_000;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayCT();
  const useCache = date === todayCT();
  const now = Date.now();
  if (useCache && cache && now - cache.at < TTL_MS) {
    return NextResponse.json({ live: cache.live, count: cache.count });
  }
  try {
    const overlay = await fetchMlbLiveOverlay(date);
    const count = [...overlay.values()].filter(
      (o) => o.abstractState === "Live",
    ).length;
    const live = count > 0;
    if (useCache) cache = { at: now, live, count };
    return NextResponse.json({ live, count });
  } catch {
    return NextResponse.json({ live: false, count: 0 });
  }
}
