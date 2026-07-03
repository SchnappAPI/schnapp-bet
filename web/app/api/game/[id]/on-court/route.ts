import { NextRequest, NextResponse } from "next/server";
import { requireSecret } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNER_URL = process.env.RUNNER_URL ?? "https://mac-flask.schnapp.bet";
const TIMEOUT_MS = 8_000;

// On-court is only meaningful while the game is live. Pre-game has no
// substitutions yet; post-final has no current 5v5. The endpoint surfaces
// {home:[playerIds], away:[playerIds]} when the live boxscore proxy reports
// at least one player with oncourt=true, otherwise null.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "gameId required" }, { status: 400 });
  }

  try {
    // In production a missing RUNNER_API_KEY throws here (caught below). We
    // never call the runner with a repo-published default key. See ADR-20260617-1.
    const RUNNER_KEY = requireSecret("RUNNER_API_KEY", "runner-Lake4971");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(
      `${RUNNER_URL}/boxscore?gameId=${encodeURIComponent(id)}`,
      {
        headers: { "X-Runner-Key": RUNNER_KEY },
        signal: controller.signal,
        cache: "no-store",
      },
    );
    clearTimeout(timer);

    if (!resp.ok) {
      return NextResponse.json({
        game_id: id,
        on_court: null,
        reason: `runner ${resp.status}`,
        updated_at: new Date().toISOString(),
      });
    }

    const body = await resp.json();
    const homeTeam = body?.game?.homeTeam ?? {};
    const awayTeam = body?.game?.awayTeam ?? {};

    type Player = { personId: number | string; oncourt?: string | boolean };
    function collect(players: Player[] | undefined): number[] {
      if (!Array.isArray(players)) return [];
      return players
        .filter((p) => {
          const v = p.oncourt;
          if (typeof v === "boolean") return v;
          if (typeof v === "string")
            return v === "1" || v.toLowerCase() === "true";
          return false;
        })
        .map((p) => Number(p.personId))
        .filter((n) => !Number.isNaN(n));
    }

    const home = collect(homeTeam.players);
    const away = collect(awayTeam.players);
    const anyOnCourt = home.length > 0 || away.length > 0;

    return NextResponse.json({
      game_id: id,
      on_court: anyOnCourt ? { home, away } : null,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[api] api/game/[id]/on-court:', err);
    return NextResponse.json({
      game_id: id,
      on_court: null,
      reason: 'unavailable',
      updated_at: new Date().toISOString(),
    });
  }
}
