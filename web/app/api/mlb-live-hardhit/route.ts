import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { fetchMlbLiveOverlay, todayCT } from "@/lib/mlbLive";
import { fetchLiveGame, type LiveAtBat } from "@/lib/mlbLiveStatcast";
import { HARD_HIT_EV } from "@/app/mlb/statcastFormat";

// Live "hard-hit" board for the /mlb landing page: who is squaring the ball
// up right now, and which pitchers are getting squared up, across every
// in-progress game. Pure enrich — reads the live GUMBO feed (via
// mlbLiveStatcast), writes nothing. Hard-hit is EV >= HARD_HIT_EV, the same
// threshold the ETL uses (mlb_play_by_play.py, mirrored in statcastFormat).
//
// EV/LA are live; the modeled Savant stats (true xBA, bat speed) are not in
// the feed and settle in the nightly load — the UI labels this LIVE so it is
// never confused with the settled Statcast Leaders rails below it.

const TOP_N = 8;

export interface LiveHardHitBatter {
  batterId: number;
  batterName: string;
  teamAbbr: string | null;
  gamePk: number;
  bbe: number; // batted-ball events (tracked)
  maxEv: number | null;
  avgEv: number | null;
  hardHit: number;
  bestLa: number | null;
  lastResult: string | null;
}

export interface LiveHardHitPitcher {
  pitcherId: number;
  pitcherName: string;
  teamAbbr: string | null;
  gamePk: number;
  bbe: number;
  maxEvAllowed: number | null;
  avgEvAllowed: number | null;
  hardHitAllowed: number;
}

export interface LiveHardHitGame {
  gamePk: number;
  awayAbbr: string | null;
  homeAbbr: string | null;
  label: string | null;
}

export interface LiveHardHitResponse {
  date: string;
  live: boolean;
  asOf: number | null;
  games: LiveHardHitGame[];
  batters: LiveHardHitBatter[];
  pitchers: LiveHardHitPitcher[];
}

interface BatterAcc {
  batterId: number;
  batterName: string;
  teamAbbr: string | null;
  gamePk: number;
  evs: number[];
  las: number[];
  hardHit: number;
  lastResult: string | null;
}
interface PitcherAcc {
  pitcherId: number;
  pitcherName: string;
  teamAbbr: string | null;
  gamePk: number;
  evs: number[];
  hardHit: number;
}

function num(v: number | null): number | null {
  return v == null ? null : Number(v);
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayCT();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const empty: LiveHardHitResponse = {
    date,
    live: false,
    asOf: null,
    games: [],
    batters: [],
    pitchers: [],
  };

  try {
    const overlay = await fetchMlbLiveOverlay(date);
    const liveGamePks = [...overlay.values()]
      .filter((o) => o.abstractState === "Live")
      .map((o) => o.gamePk);
    if (liveGamePks.length === 0) return NextResponse.json(empty);

    const feeds = (
      await Promise.all(liveGamePks.map((pk) => fetchLiveGame(pk)))
    ).filter((f): f is NonNullable<typeof f> => f != null);
    if (feeds.length === 0) return NextResponse.json(empty);

    const batters = new Map<number, BatterAcc>();
    const pitchers = new Map<number, PitcherAcc>();
    const games: LiveHardHitGame[] = [];

    for (const feed of feeds) {
      const label = overlay.get(feed.gamePk)?.liveLabel ?? null;
      games.push({
        gamePk: feed.gamePk,
        awayAbbr: feed.awayAbbr,
        homeAbbr: feed.homeAbbr,
        label,
      });

      for (const ab of feed.atBats as LiveAtBat[]) {
        const ev = num(ab.exitVelo);
        if (ev == null) continue; // batted balls only
        // Batting team is away on a top-half PA; pitching team is the other.
        const batAbbr = ab.isTop ? feed.awayAbbr : feed.homeAbbr;
        const pitchAbbr = ab.isTop ? feed.homeAbbr : feed.awayAbbr;
        const hard = ev >= HARD_HIT_EV ? 1 : 0;

        if (ab.batterId) {
          const b = batters.get(ab.batterId) ?? {
            batterId: ab.batterId,
            batterName: ab.batterName,
            teamAbbr: batAbbr,
            gamePk: feed.gamePk,
            evs: [],
            las: [],
            hardHit: 0,
            lastResult: null,
          };
          b.evs.push(ev);
          const la = num(ab.launchAngle);
          if (la != null) b.las.push(la);
          b.hardHit += hard;
          b.lastResult = ab.resultType;
          batters.set(ab.batterId, b);
        }

        if (ab.pitcherId) {
          const p = pitchers.get(ab.pitcherId) ?? {
            pitcherId: ab.pitcherId,
            pitcherName: ab.pitcherName,
            teamAbbr: pitchAbbr,
            gamePk: feed.gamePk,
            evs: [],
            hardHit: 0,
          };
          p.evs.push(ev);
          p.hardHit += hard;
          pitchers.set(ab.pitcherId, p);
        }
      }
    }

    const avg = (xs: number[]): number | null =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

    const batterRows: LiveHardHitBatter[] = [...batters.values()]
      .map((b) => ({
        batterId: b.batterId,
        batterName: b.batterName,
        teamAbbr: b.teamAbbr,
        gamePk: b.gamePk,
        bbe: b.evs.length,
        maxEv: b.evs.length ? Math.max(...b.evs) : null,
        avgEv: avg(b.evs),
        hardHit: b.hardHit,
        bestLa: b.las.length ? Math.max(...b.las) : null,
        lastResult: b.lastResult,
      }))
      // Squaring it up: most hard-hit balls first, then the loudest single one.
      .sort((a, b) => b.hardHit - a.hardHit || (b.maxEv ?? 0) - (a.maxEv ?? 0))
      .slice(0, TOP_N);

    const pitcherRows: LiveHardHitPitcher[] = [...pitchers.values()]
      .map((p) => ({
        pitcherId: p.pitcherId,
        pitcherName: p.pitcherName,
        teamAbbr: p.teamAbbr,
        gamePk: p.gamePk,
        bbe: p.evs.length,
        maxEvAllowed: p.evs.length ? Math.max(...p.evs) : null,
        avgEvAllowed: avg(p.evs),
        hardHitAllowed: p.hardHit,
      }))
      // Getting squared up: most hard contact allowed, then highest avg EV.
      .sort(
        (a, b) =>
          b.hardHitAllowed - a.hardHitAllowed ||
          (b.avgEvAllowed ?? 0) - (a.avgEvAllowed ?? 0),
      )
      .slice(0, TOP_N);

    return NextResponse.json({
      date,
      live: true,
      asOf: Date.now(),
      games,
      batters: batterRows,
      pitchers: pitcherRows,
    } satisfies LiveHardHitResponse);
  } catch (err) {
    return apiError(err, "api/mlb-live-hardhit");
  }
}
