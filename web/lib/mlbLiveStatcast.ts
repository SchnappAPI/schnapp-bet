// Live per-at-bat Statcast overlay from the public MLB Stats API GUMBO feed
// (statsapi.mlb.com/api/v1.1/game/{gamePk}/feed/live).
//
// Same enrich-only contract as mlbLive.ts: the DB (nightly play-by-play ETL)
// owns the settled record; this is a transient overlay for in-progress or
// just-finished games whose pitch data has not been loaded yet. Every
// consumer must survive an empty/null return — a slow or unreachable statsapi
// drops the overlay, never the page. statsapi is the same host the ETL
// already depends on (etl/mlb_play_by_play.py API_BASE), so no Flask hop.
//
// The GUMBO feed carries batted-ball hitData (launchSpeed, launchAngle,
// totalDistance, trajectory, hardness) within seconds of each play. The
// MODELED Statcast fields (true xBA/xSLG/xwOBA, bat speed, HR-park count)
// come from Baseball Savant and are NOT in this feed — they backfill in the
// nightly load. Live rows therefore carry EV/LA/distance and leave hitProb /
// batSpeed / hrBallparks null until then.

const FEED_URL = (gamePk: number) =>
  `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
const FEED_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 12_000;

/**
 * One live at-bat. Field names mirror the mlb-atbats route's SELECT aliases
 * exactly so the game Exit Velo tab renders live and DB rows identically.
 */
export interface LiveAtBat {
  atBatNumber: number;
  inning: number;
  isTop: boolean;
  batterId: number;
  batterName: string;
  pitcherId: number;
  pitcherName: string;
  pitcherHand: string | null;
  resultType: string | null;
  resultDesc: string | null;
  rbi: number | null;
  exitVelo: number | null;
  launchAngle: number | null;
  distance: number | null;
  trajectory: string | null;
  hardness: string | null;
  hitProb: number | null; // modeled (Savant) — always null live
  batSpeed: number | null; // modeled (Savant) — always null live
  hrBallparks: number | null; // modeled (Savant) — always null live
  awayTeamId: number;
  homeTeamId: number;
}

export interface LiveGameAtBats {
  gamePk: number;
  awayTeamId: number;
  homeTeamId: number;
  awayAbbr: string | null;
  homeAbbr: string | null;
  /** Preview | Live | Final */
  abstractState: string;
  atBats: LiveAtBat[];
}

// Minimal typed view of the GUMBO subset we read (the full payload is large
// and untyped upstream; type only what we touch).
interface RawHitData {
  launchSpeed?: number;
  launchAngle?: number;
  totalDistance?: number;
  trajectory?: string;
  hardness?: string;
}
interface RawPlayEvent {
  hitData?: RawHitData;
}
interface RawPlay {
  about?: {
    atBatIndex?: number;
    inning?: number;
    halfInning?: string;
    isComplete?: boolean;
  };
  matchup?: {
    batter?: { id?: number; fullName?: string };
    pitcher?: { id?: number; fullName?: string };
    pitchHand?: { code?: string };
  };
  result?: { eventType?: string; description?: string; rbi?: number };
  playEvents?: RawPlayEvent[];
}
interface RawTeam {
  id?: number;
  abbreviation?: string;
}
interface RawFeed {
  gameData?: {
    status?: { abstractGameState?: string };
    teams?: { away?: RawTeam; home?: RawTeam };
  };
  liveData?: { plays?: { allPlays?: RawPlay[] } };
}

interface CacheEntry {
  at: number;
  data: LiveGameAtBats | null;
}
// Module-level cache: the Next.js server is a single long-lived process, so
// N clients polling the same game (and the game tab + hard-hit board sharing
// a gamePk) collapse to one upstream call per TTL.
const cache = new Map<number, CacheEntry>();

async function fetchUncached(gamePk: number): Promise<LiveGameAtBats | null> {
  try {
    const res = await fetch(FEED_URL(gamePk), {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RawFeed;

    const away = data.gameData?.teams?.away ?? {};
    const home = data.gameData?.teams?.home ?? {};
    const awayTeamId = away.id ?? 0;
    const homeTeamId = home.id ?? 0;
    const abstractState = data.gameData?.status?.abstractGameState ?? "Preview";

    const atBats: LiveAtBat[] = [];
    for (const play of data.liveData?.plays?.allPlays ?? []) {
      const about = play.about ?? {};
      if (!about.isComplete) continue; // settled at-bats only
      // The batted ball's hitData rides the in-play pitch event; take the
      // last one that carries it (a PA can foul off tracked balls first).
      let hit: RawHitData | null = null;
      for (const ev of play.playEvents ?? []) {
        if (ev.hitData) hit = ev.hitData;
      }
      atBats.push({
        atBatNumber: (about.atBatIndex ?? 0) + 1,
        inning: about.inning ?? 0,
        isTop: (about.halfInning ?? "top") === "top",
        batterId: play.matchup?.batter?.id ?? 0,
        batterName: play.matchup?.batter?.fullName ?? "",
        pitcherId: play.matchup?.pitcher?.id ?? 0,
        pitcherName: play.matchup?.pitcher?.fullName ?? "",
        pitcherHand: play.matchup?.pitchHand?.code ?? null,
        resultType: play.result?.eventType ?? null,
        resultDesc: play.result?.description ?? null,
        rbi: play.result?.rbi ?? null,
        exitVelo: hit?.launchSpeed ?? null,
        launchAngle: hit?.launchAngle ?? null,
        distance: hit?.totalDistance ?? null,
        trajectory: hit?.trajectory ?? null,
        hardness: hit?.hardness ?? null,
        hitProb: null,
        batSpeed: null,
        hrBallparks: null,
        awayTeamId,
        homeTeamId,
      });
    }

    return {
      gamePk,
      awayTeamId,
      homeTeamId,
      awayAbbr: away.abbreviation ?? null,
      homeAbbr: home.abbreviation ?? null,
      abstractState,
      atBats,
    };
  } catch {
    return null;
  }
}

/**
 * Live at-bats for one game, cached ~12s. Returns null on any failure or
 * timeout so callers fall back to DB / hide the overlay.
 */
export async function fetchLiveGame(
  gamePk: number,
): Promise<LiveGameAtBats | null> {
  const now = Date.now();
  const hit = cache.get(gamePk);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.data;
  const data = await fetchUncached(gamePk);
  cache.set(gamePk, { at: now, data });
  return data;
}
