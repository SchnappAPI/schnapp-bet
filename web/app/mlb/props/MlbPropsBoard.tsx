"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  PropMarket,
  PropRow,
  PropsResponse,
} from "@/app/api/mlb-props/route";
import { useMlbFilters } from "@/components/mlb/MlbFilterProvider";

// Odds-free batter-prop board (/mlb/props). Ranks every projected hitter for
// the chosen market and LEADS WITH rank + plain tier + "x vs the average
// hitter"; the raw probability rides along as the muted detail number (a bare
// "15%" reads like "15% of a home run" — the ranking is the human-facing
// signal). Prev/next arrows page through the as-of dates the engine has
// written. Model prop-v1 (pooled EB-shrunk rate x barrel form), validated on
// held-out 2026.

const MARKETS: { key: PropMarket; label: string; sub: string }[] = [
  { key: "HR", label: "Home Run", sub: "P(≥1 HR)" },
  { key: "HRR", label: "H+R+RBI", sub: "hits+runs+RBI ≥ 2" },
  { key: "HITS", label: "Hits", sub: "P(≥1 hit)" },
];

function tierChip(tier: string): string {
  switch (tier) {
    case "Elite":
      return "bg-pos-muted text-pos";
    case "Strong":
      return "bg-brand-muted text-brand";
    case "AboveAvg":
      return "bg-surface-hover text-fg";
    case "Average":
      return "bg-surface-hover text-fg-subtle";
    default: // Fade
      return "text-fg-disabled";
  }
}

function tierLabel(tier: string): string {
  return tier === "AboveAvg" ? "Above Avg" : tier;
}

// Realized result for a past (settled) slice: did the batter clear this row's
// market that day. DNP = the model projected them but they didn't play (the
// board projects a pool of active hitters, not one slate).
function ResultTag({ played, hit }: { played: boolean; hit: boolean | null }) {
  if (!played)
    return (
      <span className="text-fg-disabled text-[10px]" title="Did not play">
        DNP
      </span>
    );
  return hit ? (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-pos-muted text-pos">
      Hit
    </span>
  ) : (
    <span className="text-fg-disabled text-[10px] font-medium uppercase tracking-wide">
      Miss
    </span>
  );
}

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function LiftBar({ lift }: { lift: number }) {
  // 1x sits at the middle; cap the bar at 3x for scale.
  const w = Math.max(4, Math.min(100, (lift / 3) * 100));
  const strong = lift >= 1.6;
  return (
    <div className="flex items-center gap-2">
      <span
        className={`tabular-nums font-semibold ${strong ? "text-pos" : "text-fg-muted"}`}
      >
        {lift.toFixed(1)}&times;
      </span>
      <span className="hidden sm:block h-1.5 w-16 rounded-full bg-border overflow-hidden">
        <span
          className={`block h-full rounded-full ${strong ? "bg-pos" : "bg-fg-disabled"}`}
          style={{ width: `${w}%` }}
        />
      </span>
    </div>
  );
}

export default function MlbPropsBoard() {
  const { date: ctxDate, market: ctxMarket, game } = useMlbFilters();
  const [data, setData] = useState<PropsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [convictionOnly, setConvictionOnly] = useState(true); // locks by default

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/mlb-props?date=${ctxDate}`, {
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: PropsResponse) => {
        if (!cancelled) {
          setData(d);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ctxDate]);

  // Conviction view (default ON): only track-record-validated locks, ranked by
  // the REALIZED bucket rate (the empirical conviction), not the raw model
  // number. Toggle off to see the full ranked pool.
  const rows = useMemo(() => {
    let r = (data?.rows ?? []).filter((x) => x.market === ctxMarket);
    if (convictionOnly) {
      r = r.filter((x) => x.qualifies);
      return [...r].sort(
        (a, b) => (b.bucketRate ?? 0) - (a.bucketRate ?? 0) || b.prob - a.prob,
      );
    }
    return [...r].sort((a, b) => b.prob - a.prob);
  }, [data, ctxMarket, convictionOnly]);

  // Client-side game filter — composes with the market/conviction filtering
  // above. No game selected = show every row (no narrowing).
  const gameFilteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          !game || r.teamAbbr === game.awayAbbr || r.teamAbbr === game.homeAbbr,
      ),
    [rows, game],
  );

  const active = MARKETS.find((m) => m.key === ctxMarket)!;
  const baseRate = gameFilteredRows[0]?.baseRate ?? null;
  const isHR = ctxMarket === "HR";

  // Past slices are graded. Summarize the TOP of the ranking (not the whole
  // pool — the board spans elite->fade, so a whole-board rate washes out to the
  // league mean and hides the model's edge): of the top-ranked hitters who
  // played, how many cleared.
  const settled = data?.settled ?? false;
  const summary = useMemo(() => {
    if (!settled) return null;
    const n = Math.min(20, gameFilteredRows.length);
    let hit = 0,
      miss = 0,
      dnp = 0;
    for (const r of gameFilteredRows.slice(0, n)) {
      if (!r.played) dnp++;
      else if (r.hit) hit++;
      else miss++;
    }
    return { n, hit, miss, dnp, played: hit + miss };
  }, [gameFilteredRows, settled]);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="px-3 py-3 border-b border-border flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg">
            MLB Prop Projections
          </div>
          <div className="text-[11px] text-fg-disabled mt-0.5 max-w-xl">
            {convictionOnly ? (
              <>
                <span className="text-fg-subtle">Conviction view.</span> Only
                picks the model has enough history on AND whose probability band
                has actually hit — over the last 30 days — at 1.25&times; the
                league rate. Ranked by that realized rate, not the model number.
                Fewer, validated. Toggle off for the full pool.
              </>
            ) : (
              <>
                Full model-ranked pool, odds-free. The Situation column shows
                each batter&apos;s current streak/drought and how often the
                event followed from that exact state.
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
        {baseRate != null && (
          <span className="ml-1 text-[11px] text-fg-disabled">
            {active.sub} &middot; league avg {pct(baseRate)}
          </span>
        )}
        {summary && summary.played > 0 && (
          <span className="text-[11px] text-fg-disabled">
            &middot; top {summary.n} graded{" "}
            <span className="text-pos font-medium">{summary.hit}</span> of{" "}
            {summary.played} cleared
            {summary.dnp > 0 && ` · ${summary.dnp} DNP`}
          </span>
        )}
        <button
          onClick={() => setConvictionOnly((v) => !v)}
          className={`ml-auto rounded px-2.5 py-1 text-[12px] font-medium transition-colors ${
            convictionOnly
              ? "bg-pos-muted text-pos"
              : "bg-surface-hover text-fg-subtle hover:text-fg"
          }`}
          title="Show only track-record-validated conviction picks"
        >
          {convictionOnly ? "✓ Conviction only" : "Show all"}
        </button>
      </div>

      {!loaded ? (
        <div className="px-4 py-6 text-sm text-fg-subtle">Loading...</div>
      ) : gameFilteredRows.length === 0 ? (
        <div className="px-4 py-10 text-sm text-fg-subtle">
          {convictionOnly
            ? "No conviction picks for this market today — nothing cleared the track-record bar. An honest empty is better than a forced pick; toggle Show all to see the full pool."
            : "No projections for this date. The nightly engine writes them after the day's stats land."}
        </div>
      ) : (
        <div className="overflow-x-auto pb-8 mt-2">
          <table className="w-full text-xs text-fg-muted">
            <thead>
              <tr className="text-fg-subtle border-b border-border">
                <th className="text-right pl-3 pr-2 py-1.5 font-medium">#</th>
                <th className="text-left px-2 py-1.5 font-medium">Batter</th>
                <th
                  className="text-left px-2 py-1.5 font-medium"
                  title="Opposing probable starter (hand) + this batter's career line vs him. Context only — the projection does not use it (backtest: matchup signal is game-level noise)."
                >
                  vs SP
                </th>
                <th className="text-left px-2 py-1.5 font-medium">Tier</th>
                <th
                  className="text-left px-2 py-1.5 font-medium"
                  title="How many times the league-average hitter's rate"
                >
                  vs Avg
                </th>
                {convictionOnly && (
                  <th
                    className="text-right px-2 py-1.5 font-medium"
                    title="Realized hit rate of this pick's probability band over the last 30 days (settled samples). The empirical conviction — what actually happened, not the model's claim."
                  >
                    Hit rate 30d
                  </th>
                )}
                <th
                  className="text-right px-2 py-1.5 font-medium"
                  title="Projected probability (the detail behind the ranking)"
                >
                  Prob
                </th>
                {isHR && (
                  <th
                    className="text-right px-2 py-1.5 font-medium"
                    title="Trailing-20-game barrels per game (recent power form)"
                  >
                    Brl/G
                  </th>
                )}
                {settled && (
                  <th
                    className="text-right px-2 py-1.5 pr-3 font-medium"
                    title="Did the batter clear this market that day (DNP = did not play)"
                  >
                    Result
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {gameFilteredRows.map((r, i) => (
                <tr
                  key={r.batterId}
                  className={`border-b border-border-subtle hover:bg-surface transition-colors ${
                    r.tier === "Elite" ? "bg-pos-muted/30" : ""
                  }`}
                >
                  <td className="text-right pl-3 pr-2 py-1.5 tabular-nums text-fg-disabled">
                    {i + 1}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <Link
                      href={`/mlb/player/${r.batterId}`}
                      className="text-fg-muted hover:text-brand transition-colors"
                    >
                      {r.batterName ?? String(r.batterId)}
                    </Link>
                    {r.teamAbbr && (
                      <span className="text-fg-disabled ml-1 text-[10px]">
                        {r.teamAbbr}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.oppPitcher ? (
                      <>
                        <span className="text-fg-subtle">
                          {r.oppPitcher}
                          {r.oppHand ? (
                            <span className="text-fg-disabled">
                              {" "}
                              ({r.oppHand})
                            </span>
                          ) : (
                            ""
                          )}
                        </span>
                        {r.bvp && r.bvp.ab > 0 && (
                          <span className="text-fg-disabled ml-1.5 text-[10px] tabular-nums">
                            {r.bvp.h}-{r.bvp.ab}
                            {r.bvp.hr > 0 ? `, ${r.bvp.hr} HR` : ""}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-fg-disabled">&ndash;</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tierChip(
                        r.tier,
                      )}`}
                    >
                      {tierLabel(r.tier)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <LiftBar lift={r.lift} />
                  </td>
                  {convictionOnly && (
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {r.bucketRate != null ? (
                        <span
                          className="text-pos font-semibold"
                          title={`Picks in this same probability band cleared ${Math.round(r.bucketRate * 100)}% of the time over the last 30 days, across ${r.bucketN} graded picks. It measures the band, not this player's own games.`}
                        >
                          {Math.round(r.bucketRate * 100)}%
                        </span>
                      ) : (
                        <span className="text-fg-disabled">&ndash;</span>
                      )}
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-right tabular-nums text-fg-subtle">
                    {pct(r.prob)}
                  </td>
                  {isHR && (
                    <td className="px-2 py-1.5 text-right tabular-nums text-fg-disabled">
                      {r.recentBarrelsPg != null
                        ? r.recentBarrelsPg.toFixed(2)
                        : "-"}
                    </td>
                  )}
                  {settled && (
                    <td className="px-2 py-1.5 pr-3 text-right whitespace-nowrap">
                      <ResultTag played={r.played} hit={r.hit} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
