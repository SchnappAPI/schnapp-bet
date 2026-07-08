"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  fmtHrParks,
  fmtXba,
  isBarrel,
  isHardHit,
  resultColor,
  resultLabel,
  veloColor,
} from "../../statcastFormat";
import { StatcastChips, StatcastLegend } from "../../StatcastChips";

// Comprehensive per-at-bat exit velocity log for the player page.
// One fetch of /api/mlb/player/[playerId]/atbats; the page's range and
// pitcher-hand filters apply as pure client-side slices, and the summary
// tiles are computed over the FILTERED batted balls so they always match
// the visible rows.

interface AtBatRow {
  atBatId: string;
  gamePk: number;
  gameDate: string;
  inning: number | null;
  oppAbbr: string | null;
  pitcherId: number | null;
  pitcherName: string | null;
  pitcherHand: string | null;
  result: string | null;
  resultDesc: string | null;
  rbi: number | null;
  ev: number | null;
  la: number | null;
  dist: number | null;
  trajectory: string | null;
  hardness: string | null;
  xba: number | null;
  batSpeed: number | null;
  hrParks: number | null;
}

function fmtDec(val: number | null, decimals = 1): string {
  if (val == null) return "-";
  return Number(val).toFixed(decimals);
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded border border-border bg-surface px-3 py-2 min-w-[92px]">
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${accent ?? "text-fg"}`}>
        {value}
      </div>
    </div>
  );
}

export default function MlbStatcastSection({
  playerId,
  range,
  pitcherHand,
}: {
  playerId: string;
  range: string; // "l5" | "l10" | "l20" | "season"
  pitcherHand: string | null; // "L" | "R" | null
}) {
  const [atBats, setAtBats] = useState<AtBatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [battedOnly, setBattedOnly] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = (silent: boolean) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      fetch(`/api/mlb/player/${playerId}/atbats`, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => {
          if (cancelled) return;
          setAtBats(d.atBats ?? []);
          const isLive = Boolean(d.live);
          setLive(isLive);
          // Begin polling only once we learn the player's game is live.
          if (isLive && !timer) {
            timer = setInterval(() => load(true), 30_000);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled && !silent)
            setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled && !silent) setLoading(false);
        });
    };

    load(false);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [playerId]);

  const filtered = useMemo(() => {
    let rows = atBats;
    if (pitcherHand) rows = rows.filter((r) => r.pitcherHand === pitcherHand);
    // Range = last N distinct GAMES within the current filter, matching the
    // game-log semantics (rows arrive newest-first).
    const n =
      range === "l5" ? 5 : range === "l10" ? 10 : range === "l20" ? 20 : null;
    if (n != null) {
      const keep = new Set<number>();
      for (const r of rows) {
        if (!keep.has(r.gamePk)) {
          if (keep.size >= n) continue;
          keep.add(r.gamePk);
        }
      }
      rows = rows.filter((r) => keep.has(r.gamePk));
    }
    if (battedOnly) rows = rows.filter((r) => r.ev != null);
    return rows;
  }, [atBats, pitcherHand, range, battedOnly]);

  const summary = useMemo(() => {
    const batted = filtered.filter((r) => r.ev != null);
    const evs = batted.map((r) => Number(r.ev));
    const avgEv =
      evs.length > 0 ? evs.reduce((a, b) => a + b, 0) / evs.length : null;
    const maxEv = evs.length > 0 ? Math.max(...evs) : null;
    const hardHits = batted.filter((r) => isHardHit(Number(r.ev))).length;
    const barrels = batted.filter((r) =>
      isBarrel(Number(r.ev), r.la != null ? Number(r.la) : null),
    ).length;
    const xbas = batted.filter((r) => r.xba != null).map((r) => Number(r.xba));
    const avgXba =
      xbas.length > 0 ? xbas.reduce((a, b) => a + b, 0) / xbas.length : null;
    return {
      bbe: batted.length,
      avgEv,
      maxEv,
      hardHitPct: batted.length > 0 ? hardHits / batted.length : null,
      barrelPct: batted.length > 0 ? barrels / batted.length : null,
      avgXba,
    };
  }, [filtered]);

  if (loading) {
    return (
      <div className="px-4 py-3 text-sm text-fg-subtle">
        Loading Statcast data...
      </div>
    );
  }
  if (error) {
    return <div className="px-4 py-3 text-sm text-neg">Error: {error}</div>;
  }
  if (atBats.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-fg-subtle">
        No at-bat Statcast data for this player this season.
      </div>
    );
  }

  return (
    <div className="flex-1">
      {live && (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-[11px] text-pos">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-pos" />
          Live — today&apos;s at-bats update every 30s (EV/LA; xBA &amp; bat
          speed settle in tonight&apos;s load).
        </div>
      )}
      {/* Summary tiles (over the filtered set) */}
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Tile label="Batted Balls" value={String(summary.bbe)} />
        <Tile
          label="Avg EV"
          value={summary.avgEv != null ? `${fmtDec(summary.avgEv)}` : "-"}
          accent={veloColor(summary.avgEv)}
        />
        <Tile
          label="Max EV"
          value={summary.maxEv != null ? `${fmtDec(summary.maxEv)}` : "-"}
          accent={veloColor(summary.maxEv)}
        />
        <Tile
          label="Hard Hit%"
          value={
            summary.hardHitPct != null
              ? `${Math.round(summary.hardHitPct * 100)}%`
              : "-"
          }
        />
        <Tile
          label="Barrel%"
          value={
            summary.barrelPct != null
              ? `${Math.round(summary.barrelPct * 100)}%`
              : "-"
          }
        />
        <Tile label="Avg xBA" value={fmtXba(summary.avgXba)} />
      </div>

      <div className="flex items-center gap-2 px-4 pb-2">
        <button
          onClick={() => setBattedOnly((v) => !v)}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            battedOnly
              ? "bg-brand text-canvas"
              : "bg-surface-hover text-fg-subtle hover:text-fg"
          }`}
        >
          Batted balls only
        </button>
        <span className="text-[11px] text-fg-disabled">
          {filtered.length} at-bat{filtered.length === 1 ? "" : "s"} shown
        </span>
      </div>

      <StatcastLegend className="px-4 pb-2" />

      {/* Per-at-bat log */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-20 bg-canvas">
            <tr className="text-fg-subtle border-b border-border">
              <th className="text-left px-4 py-1.5 font-medium whitespace-nowrap">
                Date
              </th>
              <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">
                Opp
              </th>
              <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">
                Pitcher
              </th>
              <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">
                Result
              </th>
              <th className="text-right px-2 py-1.5 font-medium">EV</th>
              <th className="text-right px-2 py-1.5 font-medium">LA</th>
              <th className="text-right px-2 py-1.5 font-medium">Dist</th>
              <th className="text-right px-2 py-1.5 font-medium">xBA</th>
              <th className="text-right px-2 py-1.5 font-medium">Bat Spd</th>
              <th className="text-right px-2 py-1.5 font-medium">HR/Pk</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ab) => (
              <tr
                key={ab.atBatId}
                className="border-b border-border-subtle hover:bg-surface transition-colors"
              >
                <td className="px-4 py-1.5 text-fg-subtle whitespace-nowrap">
                  <Link
                    href={`/mlb/game/${ab.gamePk}`}
                    className="hover:text-brand transition-colors"
                  >
                    {ab.gameDate.slice(5)}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-fg-subtle whitespace-nowrap">
                  {ab.oppAbbr ?? "?"}
                </td>
                <td className="px-2 py-1.5 text-fg-subtle whitespace-nowrap">
                  {ab.pitcherName ?? "-"}
                  {ab.pitcherHand && (
                    <span className="text-fg-disabled ml-1">
                      ({ab.pitcherHand})
                    </span>
                  )}
                </td>
                <td
                  className={`px-2 py-1.5 whitespace-nowrap ${resultColor(ab.result)}`}
                >
                  {resultLabel(ab.result)}
                  {ab.rbi != null && ab.rbi > 0 && (
                    <span className="text-fg-disabled ml-1">{ab.rbi} RBI</span>
                  )}
                  <StatcastChips
                    ev={ab.ev != null ? Number(ab.ev) : null}
                    la={ab.la != null ? Number(ab.la) : null}
                    batSpeed={ab.batSpeed != null ? Number(ab.batSpeed) : null}
                  />
                </td>
                <td
                  className={`px-2 py-1.5 text-right tabular-nums font-semibold ${veloColor(
                    ab.ev != null ? Number(ab.ev) : null,
                  )}`}
                >
                  {ab.ev != null ? Number(ab.ev).toFixed(1) : "-"}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">
                  {ab.la ?? "-"}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">
                  {ab.dist ?? "-"}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-fg-subtle">
                  {fmtXba(ab.xba != null ? Number(ab.xba) : null)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">
                  {ab.batSpeed != null ? Number(ab.batSpeed).toFixed(1) : "-"}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">
                  {fmtHrParks(ab.hrParks != null ? Number(ab.hrParks) : null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
