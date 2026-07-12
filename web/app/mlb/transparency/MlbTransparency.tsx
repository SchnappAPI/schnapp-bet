"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  TierDay,
  TransparencyResponse,
} from "@/app/api/mlb-transparency/route";
import { useMlbFilters } from "@/components/mlb/MlbFilterProvider";

// Transparency (/mlb/transparency). Per-day settled hit rate of the odds-free
// props board, by tier and market. The board's tiers should hit monotonically
// (Elite > ... > Fade); this shows whether they did, day over day.

const TIERS = ["Elite", "Strong", "AboveAvg", "Average", "Fade"];
const TIER_LABEL: Record<string, string> = { AboveAvg: "Above" };

function rateCell(cell: TierDay | undefined) {
  if (!cell || cell.nPlayed === 0)
    return <span className="text-fg-disabled">—</span>;
  const pct = Math.round((cell.hitRate ?? 0) * 100);
  const strong = (cell.hitRate ?? 0) >= 0.5;
  return (
    <span
      className={`tabular-nums ${strong ? "text-pos font-semibold" : "text-fg-muted"}`}
      title={`${cell.nHit}/${cell.nPlayed} cleared (${cell.nProj} projected)`}
    >
      {pct}%
      <span className="text-fg-disabled text-[9px] ml-0.5">
        {cell.nHit}/{cell.nPlayed}
      </span>
    </span>
  );
}

export default function MlbTransparency() {
  const [data, setData] = useState<TransparencyResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);
  const { market } = useMlbFilters();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/mlb-transparency`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: TransparencyResponse) => {
        if (!cancelled) {
          setData(d);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErr(true);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pivot to (date -> tier -> cell) for the selected market, plus a per-day
  // overall (all tiers combined).
  const { dates, byDateTier, overall } = useMemo(() => {
    const rows = (data?.rows ?? []).filter((r) => r.market === market);
    const byDateTier = new Map<string, Map<string, TierDay>>();
    const overall = new Map<string, { hit: number; played: number }>();
    const dateSet = new Set<string>();
    for (const r of rows) {
      dateSet.add(r.date);
      if (!byDateTier.has(r.date)) byDateTier.set(r.date, new Map());
      byDateTier.get(r.date)!.set(r.tier, r);
      const o = overall.get(r.date) ?? { hit: 0, played: 0 };
      o.hit += r.nHit;
      o.played += r.nPlayed;
      overall.set(r.date, o);
    }
    const dates = [...dateSet].sort((a, b) => (a < b ? 1 : -1));
    return { dates, byDateTier, overall };
  }, [data, market]);

  function fmtDate(iso: string): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div className="flex flex-col min-h-screen">
      <div className="px-3 py-3 border-b border-border">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg">
          MLB Transparency
        </div>
        <div className="text-[11px] text-fg-disabled mt-0.5 max-w-2xl">
          Per-day settled hit rate of the odds-free props board, by tier. Higher
          tiers should clear more often than lower ones — this shows whether
          they did, day over day. Graded with the model&apos;s own market
          definitions.
        </div>
      </div>

      {!loaded ? (
        <div className="px-4 py-6 text-sm text-fg-subtle">Loading…</div>
      ) : err ? (
        <div className="px-4 py-6 text-sm text-neg">
          Could not load transparency data. Try again shortly.
        </div>
      ) : dates.length === 0 ? (
        <div className="px-4 py-10 text-sm text-fg-subtle">
          No settled projection days yet.
        </div>
      ) : (
        <div className="overflow-x-auto p-3">
          <table className="text-xs text-fg-muted">
            <thead>
              <tr className="text-fg-subtle border-b border-border">
                <th className="text-left px-2 py-1.5 font-medium">Date</th>
                <th className="text-right px-2 py-1.5 font-medium">All</th>
                {TIERS.map((t) => (
                  <th key={t} className="text-right px-2 py-1.5 font-medium">
                    {TIER_LABEL[t] ?? t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => {
                const o = overall.get(d);
                const orate =
                  o && o.played > 0
                    ? Math.round((o.hit / o.played) * 100)
                    : null;
                return (
                  <tr
                    key={d}
                    className="border-b border-border-subtle hover:bg-surface"
                  >
                    <td className="px-2 py-1.5 whitespace-nowrap text-fg-subtle">
                      {fmtDate(d)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {orate == null ? (
                        <span className="text-fg-disabled">—</span>
                      ) : (
                        <span className="text-fg">
                          {orate}%
                          <span className="text-fg-disabled text-[9px] ml-0.5">
                            {o!.hit}/{o!.played}
                          </span>
                        </span>
                      )}
                    </td>
                    {TIERS.map((t) => (
                      <td key={t} className="px-2 py-1.5 text-right">
                        {rateCell(byDateTier.get(d)?.get(t))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
