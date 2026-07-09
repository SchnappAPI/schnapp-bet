import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { fetchMlbLiveOverlay, todayCT } from "@/lib/mlbLive";
import { fetchLiveGame, type LiveAtBat } from "@/lib/mlbLiveStatcast";
import { HARD_HIT_EV, isBarrel } from "@/app/mlb/statcastFormat";

// Live "hard-hit" board for /mlb/live: who is squaring the ball up right now,
// and which pitchers are getting squared up, across every in-progress game.
// Pure enrich — reads the live GUMBO feed (via mlbLiveStatcast), writes
// nothing. Hard-hit is EV >= HARD_HIT_EV and barrel is EV/LA in the HR window,
// the same definitions the ETL uses (mlb_play_by_play.py, mirrored in
// statcastFormat) — barrels are the strongest in-game HR signal, so batters
// are ranked by them. LA/distance/inning/result are reported for each hitter's
// HARDEST ball (so the row is internally consistent); the full per-ball list
// (chronological) rides along so the UI can expand a hitter to show each ball.
//
// EV/LA/distance are live; the modeled Savant stats (true xBA, bat speed) are
// not in the feed and settle in the nightly load — the UI labels this LIVE.

// Pitcher list is bounded (a few per game); cap it so a huge slate can't
// produce a runaway table. Batters are returned in full (dedicated page).
const PITCHER_CAP = 40;

export interface LiveHardHitBall {
  inning: number | null;
  ev: number | null;
  la: number | null;
  dist: number | null;
  result: string | null;
  hard: boolean;
  barrel: boolean;
}

export interface LiveHardHitBatter {
  batterId: number;
  batterName: string;
  teamAbbr: string | null;
  gamePk: number;
  bbe: number; // batted-ball events (tracked)
  maxEv: number | null;
  avgEv: number | null;
  maxEvLa: number | null; // launch angle of the hardest ball
  maxEvDist: number | null; // distance of the hardest ball
  topInning: number | null; // inning of the hardest ball
  topResult: string | null; // result of the hardest ball
  hardHit: number;
  barrels: number;
  balls: LiveHardHitBall[]; // every tracked batted ball, chronological
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
  // evs / las / dists / innings / results are aligned per batted ball.
  evs: number[];
  las: (number | null)[];
  dists: (number | null)[];
  innings: (number | null)[];
  results: (string | null)[];
  hardHit: number;
  barrels: number;
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
        const la = num(ab.launchAngle);
        const dist = num(ab.distance);
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
            dists: [],
            innings: [],
            results: [],
            hardHit: 0,
            barrels: 0,
          };
          b.evs.push(ev);
          b.las.push(la);
          b.dists.push(dist);
          b.innings.push(ab.inning ?? null);
          b.results.push(ab.resultType);
          b.hardHit += hard;
          if (isBarrel(ev, la)) b.barrels += 1;
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
      .map((b) => {
        // Index of the hardest ball; report its LA/distance/inning/result.
        let mi = 0;
        for (let i = 1; i < b.evs.length; i++) if (b.evs[i] > b.evs[mi]) mi = i;
        const balls: LiveHardHitBall[] = b.evs.map((ev, i) => ({
          inning: b.innings[i],
          ev,
          la: b.las[i],
          dist: b.dists[i],
          result: b.results[i],
          hard: ev >= HARD_HIT_EV,
          barrel: isBarrel(ev, b.las[i]),
        }));
        return {
          batterId: b.batterId,
          batterName: b.batterName,
          teamAbbr: b.teamAbbr,
          gamePk: b.gamePk,
          bbe: b.evs.length,
          maxEv: b.evs.length ? b.evs[mi] : null,
          avgEv: avg(b.evs),
          maxEvLa: b.evs.length ? b.las[mi] : null,
          maxEvDist: b.evs.length ? b.dists[mi] : null,
          topInning: b.evs.length ? b.innings[mi] : null,
          topResult: b.evs.length ? b.results[mi] : null,
          hardHit: b.hardHit,
          barrels: b.barrels,
          balls,
        };
      })
      // HR-hunting default order: barrels first, then loudest ball, then most
      // hard-hit balls. (The UI can re-sort by any column.)
      .sort(
        (a, b) =>
          b.barrels - a.barrels ||
          (b.maxEv ?? 0) - (a.maxEv ?? 0) ||
          b.hardHit - a.hardHit,
      );

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
      .slice(0, PITCHER_CAP);

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
