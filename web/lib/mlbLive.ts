// Live MLB overlay from the public MLB Stats API (statsapi.mlb.com).
//
// Mirrors the NBA pattern in /api/games/today: the DB (mlb.games, loaded by
// the nightly ETL + intraday poller) always owns the game LIST; statsapi is
// only an enrichment overlay for scores/status/inning while games are in
// progress. Every consumer must survive this returning an empty map — a
// slow or unreachable statsapi drops the overlay, never the page.
//
// statsapi is a public unauthenticated API; the ETL already depends on the
// same host (etl/mlb_play_by_play.py API_BASE), so no proxy hop via Flask.

const SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule";
const OVERLAY_TIMEOUT_MS = 1500;

export interface MlbLiveInning {
  inning: number;
  isTop: boolean;
  runs: number | null;
}

export interface MlbLiveOverlay {
  gamePk: number;
  /** detailedState, except Final/Game Over which collapse to 'F' to match mlb.games. */
  gameStatus: string;
  /** Preview | Live | Final */
  abstractState: string;
  awayScore: number | null;
  homeScore: number | null;
  inning: number | null;
  inningOrdinal: string | null;
  /** Top | Bottom | Middle | End */
  inningState: string | null;
  outs: number | null;
  /** e.g. "Top 5th" while live, null otherwise. */
  liveLabel: string | null;
  innings: MlbLiveInning[];
  awayHits: number | null;
  homeHits: number | null;
}

export function todayCT(): string {
  const now = new Date();
  const ct = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Chicago" }),
  );
  return `${ct.getFullYear()}-${String(ct.getMonth() + 1).padStart(2, "0")}-${String(ct.getDate()).padStart(2, "0")}`;
}

function collapseStatus(
  detailedState: string | undefined,
  abstractState: string | undefined,
): string {
  const d = detailedState ?? "Scheduled";
  // Postponed/Cancelled/Suspended carry abstractGameState "Final" in the
  // API but were not played — keep the detailedState, don't show Final.
  if (/^(Postponed|Cancelled|Suspended)/.test(d)) return d;
  if (abstractState === "Final" || d === "Final" || d === "Game Over") return "F";
  return d;
}

/**
 * One schedule call for the date's full slate. Returns an empty map on any
 * failure or timeout — callers always fall back to DB data.
 */
export async function fetchMlbLiveOverlay(
  date: string,
): Promise<Map<number, MlbLiveOverlay>> {
  const out = new Map<number, MlbLiveOverlay>();
  try {
    const res = await fetch(
      `${SCHEDULE_URL}?sportId=1&date=${date}&hydrate=linescore`,
      { signal: AbortSignal.timeout(OVERLAY_TIMEOUT_MS), cache: "no-store" },
    );
    if (!res.ok) return out;
    const data = await res.json();
    for (const g of data?.dates?.[0]?.games ?? []) {
      const abstractState: string = g?.status?.abstractGameState ?? "Preview";
      const ls = g?.linescore ?? {};
      const isLive = abstractState === "Live";

      const innings: MlbLiveInning[] = [];
      for (const inn of ls.innings ?? []) {
        innings.push({
          inning: inn.num,
          isTop: true,
          runs: inn.away?.runs ?? null,
        });
        innings.push({
          inning: inn.num,
          isTop: false,
          runs: inn.home?.runs ?? null,
        });
      }

      out.set(g.gamePk, {
        gamePk: g.gamePk,
        gameStatus: collapseStatus(g?.status?.detailedState, abstractState),
        abstractState,
        awayScore: g?.teams?.away?.score ?? null,
        homeScore: g?.teams?.home?.score ?? null,
        inning: ls.currentInning ?? null,
        inningOrdinal: ls.currentInningOrdinal ?? null,
        inningState: ls.inningState ?? null,
        outs: ls.outs ?? null,
        liveLabel:
          isLive && ls.currentInningOrdinal
            ? `${ls.inningState ?? ""} ${ls.currentInningOrdinal}`.trim()
            : null,
        innings,
        awayHits: ls.teams?.away?.hits ?? null,
        homeHits: ls.teams?.home?.hits ?? null,
      });
    }
    return out;
  } catch {
    return out;
  }
}
