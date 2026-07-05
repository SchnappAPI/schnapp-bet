"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HeatCell from "@/components/HeatCell";
import type { GridBatter, GridTeam } from "@/app/api/mlb/research/grid/route";

// Pregame Matchups tab for the game page (Phase 4.5 item 4 — Savant's
// pregame Matchups framing). Lineup-vs-probable BvP plus the platoon
// split and hit/total-bases projections, reusing the research grid
// endpoint (one fetch, season window). Prop-column bias: everything here
// answers "should I take this batter's hits / TB / HR line tonight?" —
// the full slicer grid lives at /mlb/research.

interface GridResponse {
  gamePk: number;
  gameDate: string;
  away: GridTeam;
  home: GridTeam;
}

function fmtAvg(v: number): string {
  return v.toFixed(3).replace(/^0/, "");
}
function fmt1(v: number): string {
  return v.toFixed(1);
}

interface Col {
  key: string;
  label: string;
  get: (b: GridBatter) => number | null | undefined;
  fmt: (v: number) => string;
}

const COLS: Col[] = [
  { key: "bvpPa", label: "BvP PA", get: (b) => b.bvp?.pa, fmt: String },
  { key: "bvpHits", label: "BvP H", get: (b) => b.bvp?.hits, fmt: String },
  { key: "bvpHr", label: "BvP HR", get: (b) => b.bvp?.homeRuns, fmt: String },
  {
    key: "bvpAvg",
    label: "BvP AVG",
    get: (b) => b.bvp?.battingAvg,
    fmt: fmtAvg,
  },
  { key: "bvpOps", label: "BvP OPS", get: (b) => b.bvp?.ops, fmt: fmtAvg },
  { key: "bvpEv", label: "BvP EV", get: (b) => b.bvp?.avgEv, fmt: fmt1 },
  {
    key: "handHitRate",
    label: "Hand H%",
    get: (b) => b.trend?.vsHandHitRate,
    fmt: fmtAvg,
  },
  {
    key: "handXba",
    label: "Hand xBA*",
    get: (b) => b.trend?.vsHandAvgXba,
    fmt: fmtAvg,
  },
  {
    key: "projH",
    label: "xH",
    get: (b) => b.proj["batter_hits"],
    fmt: (v) => v.toFixed(2),
  },
  {
    key: "projTb",
    label: "xTB",
    get: (b) => b.proj["batter_total_bases"],
    fmt: (v) => v.toFixed(2),
  },
  // hit_prob / hr_prob are 0-1 P(>=1 in the game) — display as percents.
  {
    key: "projHitProb",
    label: "Hit%",
    get: (b) => b.proj["hit_prob"],
    fmt: (v) => `${(v * 100).toFixed(0)}%`,
  },
  {
    key: "projHrProb",
    label: "HR%",
    get: (b) => b.proj["hr_prob"],
    fmt: (v) => `${(v * 100).toFixed(0)}%`,
  },
];

function TeamMatchups({
  team,
  opp,
  columnValues,
}: {
  team: GridTeam;
  // The OPPOSING side — GridTeam.pitcher* is the team's own probable;
  // these batters face the other team's.
  opp: GridTeam;
  columnValues: Map<string, (number | null | undefined)[]>;
}) {
  return (
    <div className="mb-5">
      <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-1.5 flex items-center gap-2">
        <span>{team.teamAbbr} Batters</span>
        {opp.pitcherName && (
          <span className="text-[10px] font-normal normal-case tracking-normal text-fg-disabled">
            vs {opp.pitcherName}
            {opp.pitcherHand ? ` (${opp.pitcherHand})` : ""}
          </span>
        )}
        {team.lineupStatus === "projected" && (
          <span className="text-[10px] font-normal normal-case tracking-normal text-amber-500/70">
            Projected lineup
          </span>
        )}
      </div>
      {team.batters.length === 0 ? (
        <div className="text-sm text-fg-subtle">No lineup available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-fg-muted">
            <thead>
              <tr className="text-fg-disabled border-b border-border">
                <th className="text-left pb-1 pr-3 font-normal">Batter</th>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    className="text-center pb-1 px-1.5 font-normal whitespace-nowrap"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.batters.map((b) => {
                const slot =
                  b.battingOrder >= 100
                    ? Math.floor(b.battingOrder / 100)
                    : b.battingOrder;
                return (
                  <tr
                    key={b.playerId}
                    className="border-b border-border-subtle"
                  >
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <span className="text-fg-disabled mr-1 text-xs">
                        {slot}
                      </span>
                      <Link
                        href={`/mlb/player/${b.playerId}`}
                        className="text-fg-muted hover:text-brand transition-colors"
                      >
                        {b.playerName ?? b.playerId}
                      </Link>
                      {b.batSide && (
                        <span className="text-fg-disabled ml-1 text-[10px]">
                          {b.batSide}
                        </span>
                      )}
                    </td>
                    {COLS.map((c) => (
                      <HeatCell
                        key={c.key}
                        value={c.get(b)}
                        values={columnValues.get(c.key) ?? []}
                        format={c.fmt}
                      />
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

export default function MlbMatchupsTab({ gamePk }: { gamePk: number }) {
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/mlb/research/grid?gamePk=${gamePk}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: GridResponse) => {
        if (!cancelled) setGrid(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gamePk]);

  // One shading scale across BOTH lineups, matching /mlb/research.
  const columnValues = useMemo(() => {
    const m = new Map<string, (number | null | undefined)[]>();
    if (!grid) return m;
    const all = [...grid.away.batters, ...grid.home.batters];
    for (const c of COLS) {
      m.set(
        c.key,
        all.map((b) => c.get(b)),
      );
    }
    return m;
  }, [grid]);

  if (loading) {
    return <div className="text-sm text-fg-subtle">Loading matchups...</div>;
  }
  if (error) {
    return <div className="text-sm text-neg">Error: {error}</div>;
  }
  if (!grid) return null;

  return (
    <div>
      <div className="text-xs text-fg-subtle mb-3">
        Career BvP vs tonight&apos;s probable, season platoon split, and
        projected hits / total bases. Shading is the batter&apos;s percentile
        across both lineups.{" "}
        <Link
          href={`/mlb/research?gamePk=${gamePk}&date=${grid.gameDate}`}
          className="text-brand hover:underline"
        >
          Full research grid →
        </Link>
      </div>
      <TeamMatchups
        team={grid.away}
        opp={grid.home}
        columnValues={columnValues}
      />
      <TeamMatchups
        team={grid.home}
        opp={grid.away}
        columnValues={columnValues}
      />
    </div>
  );
}
