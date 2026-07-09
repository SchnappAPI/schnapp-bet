import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { fetchMlbLiveOverlay, todayCT } from "@/lib/mlbLive";
import { fetchLiveGame, type LiveAtBat } from "@/lib/mlbLiveStatcast";
import { HARD_HIT_EV, isBarrel } from "@/app/mlb/statcastFormat";

// Live "hard-hit" board for /mlb/live: every tracked batted ball across every
// in-progress game, ONE ROW PER AT-BAT (no per-hitter roll-up), plus which
// pitchers are getting squared up. Pure enrich — reads the live GUMBO feed
// (via mlbLiveStatcast), writes nothing. Hard-hit is EV >= HARD_HIT_EV and
// barrel is EV/LA in the HR window, the same definitions the ETL uses
// (mlb_play_by_play.py, mirrored in statcastFormat) — barrels are the strongest
// in-game HR signal. Each ball carries its game at-bat number (abNumber, 1..N
// in the order PAs happen) so the board can be sorted chronologically, its
// batter identity, and its own EV/LA/distance/result/inning — so every row is
// self-contained (nothing rolls up).
//
// EV/LA/distance are live; the modeled Savant stats (true xBA, bat speed) are
// not in the feed and settle in the nightly load — the UI labels this LIVE.

// Pitcher list is bounded (a few per game); cap it so a huge slate can't
// produce a runaway table. Batted balls are returned in full.
const PITCHER_CAP = 40;

export interface LiveHardHitBattedBall {
  abNumber: number | null; // game at-bat number (1..N, order PAs happen)
  batterId: number;
  batterName: string;
  teamAbbr: string | null;
  gamePk: number;
  inning: number | null;
  ev: number | null;
  la: number | null;
  dist: number | null;
  result: string | null;
  hard: boolean;
  barrel: boolean;
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
  balls: LiveHardHitBattedBall[];
  pitchers: LiveHardHitPitcher[];
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
    balls: [],
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

    const balls: LiveHardHitBattedBall[] = [];
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
        const hard = ev >= HARD_HIT_EV;

        // One row per batted ball — nothing rolls up per hitter.
        if (ab.batterId) {
          balls.push({
            abNumber: ab.atBatNumber ?? null,
            batterId: ab.batterId,
            batterName: ab.batterName,
            teamAbbr: batAbbr,
            gamePk: feed.gamePk,
            inning: ab.inning ?? null,
            ev,
            la,
            dist,
            result: ab.resultType,
            hard,
            barrel: isBarrel(ev, la),
          });
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
          p.hardHit += hard ? 1 : 0;
          pitchers.set(ab.pitcherId, p);
        }
      }
    }

    const avg = (xs: number[]): number | null =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

    // Default order: loudest contact first (the HR signal). The UI re-sorts by
    // any column, including AB# for true chronological order. Barrels cluster
    // at the top (they require EV >= 95) and are highlighted regardless.
    const ballRows = balls.sort(
      (a, b) =>
        (b.ev ?? -Infinity) - (a.ev ?? -Infinity) ||
        (b.abNumber ?? 0) - (a.abNumber ?? 0),
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
      balls: ballRows,
      pitchers: pitcherRows,
    } satisfies LiveHardHitResponse);
  } catch (err) {
    return apiError(err, "api/mlb-live-hardhit");
  }
}
