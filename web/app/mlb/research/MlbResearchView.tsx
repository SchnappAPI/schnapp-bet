"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import HeatCell from "@/components/HeatCell";
import ResearchFilters, { RANGE_OPTIONS } from "./ResearchFilters";
import { fmtHrParks, resultColor, resultLabel } from "@/app/mlb/statcastFormat";
import { StatcastChips, StatcastLegend } from "@/app/mlb/StatcastChips";
import { useMlbFilters } from "@/components/mlb/MlbFilterProvider";
import type { SlateGame } from "@/app/api/mlb/research/slate/route";
import type { GridBatter, GridTeam } from "@/app/api/mlb/research/grid/route";
import type { ResearchAtBatRow } from "@/app/api/mlb/research/atbats/route";

// /mlb/research — the PBI EV-page layout: slicer row -> team heat grid
// (both lineups) -> click a batter -> per-PA log + BvP + platoon strip.
// All slicing is URL-param driven; the grid endpoint re-aggregates
// server-side per filter change.

interface GridResponse {
  gamePk: number;
  gameDate: string;
  from: string;
  to: string;
  hand: string | null;
  abNum: number | null;
  away: GridTeam;
  home: GridTeam;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtAvg(v: number): string {
  return v.toFixed(3).replace(/^0/, "");
}
function fmt1(v: number): string {
  return v.toFixed(1);
}
function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
function fmtShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

interface Col {
  key: string;
  label: string;
  get: (b: GridBatter) => number | null | undefined;
  fmt: (v: number) => string;
  invert?: boolean;
}

const COLS: Col[] = [
  { key: "pa", label: "PA", get: (b) => b.agg?.pa, fmt: String },
  {
    key: "avg",
    label: "AVG",
    get: (b) => b.agg?.avg,
    fmt: fmtAvg,
  },
  { key: "hits", label: "H", get: (b) => b.agg?.hits, fmt: String },
  { key: "hr", label: "HR", get: (b) => b.agg?.homeRuns, fmt: String },
  { key: "xbh", label: "XBH", get: (b) => b.agg?.xbh, fmt: String },
  { key: "tb", label: "TB", get: (b) => b.agg?.totalBases, fmt: String },
  {
    key: "kpct",
    label: "K%",
    get: (b) => (b.agg && b.agg.pa > 0 ? b.agg.strikeouts / b.agg.pa : null),
    fmt: fmtPct,
    invert: true,
  },
  { key: "avgEv", label: "EV", get: (b) => b.agg?.avgEv, fmt: fmt1 },
  { key: "maxEv", label: "Max EV", get: (b) => b.agg?.maxEv, fmt: fmt1 },
  {
    key: "hardHit",
    label: "Hard%",
    get: (b) => b.agg?.hardHitPct,
    fmt: fmtPct,
  },
  {
    key: "barrel",
    label: "Brl%",
    get: (b) => b.agg?.barrelPct,
    fmt: fmtPct,
  },
  { key: "xba", label: "xBA*", get: (b) => b.agg?.avgXba, fmt: fmtAvg },
  { key: "babip", label: "BABIP", get: (b) => b.agg?.babip, fmt: fmtAvg },
  {
    key: "w10",
    label: "L10 H%",
    get: (b) => b.trend?.w10HitRate,
    fmt: fmtAvg,
  },
  {
    key: "vsHandXba",
    label: "Hand xBA*",
    get: (b) => b.trend?.vsHandAvgXba,
    fmt: fmtAvg,
  },
  { key: "bvpPa", label: "BvP PA", get: (b) => b.bvp?.pa, fmt: String },
  {
    key: "bvpAvg",
    label: "BvP AVG",
    get: (b) => b.bvp?.battingAvg,
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

function TeamGrid({
  team,
  opp,
  columnValues,
  selectedId,
  onSelect,
}: {
  team: GridTeam;
  // The OPPOSING side — GridTeam.pitcher* is the team's own probable;
  // these batters face (and the BvP/platoon columns are computed vs)
  // the other team's.
  opp: GridTeam;
  columnValues: Map<string, (number | null | undefined)[]>;
  selectedId: number | null;
  onSelect: (playerId: number) => void;
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
                const selected = selectedId === b.playerId;
                return (
                  <tr
                    key={b.playerId}
                    onClick={() => onSelect(b.playerId)}
                    className={[
                      "border-b border-border-subtle cursor-pointer hover:bg-surface-hover",
                      selected ? "bg-surface-hover" : "",
                    ].join(" ")}
                  >
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <span className="text-fg-disabled mr-1 text-xs">
                        {slot}
                      </span>
                      <span className="text-fg-muted">
                        {b.playerName ?? b.playerId}
                      </span>
                      {b.batSide && (
                        <span className="text-fg-disabled ml-1 text-[10px]">
                          {b.batSide}
                        </span>
                      )}
                      {b.position && (
                        <span className="text-fg-disabled ml-1">
                          {b.position}
                        </span>
                      )}
                    </td>
                    {COLS.map((c) => (
                      <HeatCell
                        key={c.key}
                        value={c.get(b)}
                        values={columnValues.get(c.key) ?? []}
                        format={c.fmt}
                        invert={c.invert}
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

function BatterDetail({
  batter,
  from,
  to,
  hand,
  abNum,
}: {
  batter: GridBatter;
  from: string;
  to: string;
  hand: string | null;
  abNum: string | null;
}) {
  const [atBats, setAtBats] = useState<ResearchAtBatRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAtBats(null);
    setError(null);
    const qs = new URLSearchParams({
      batterId: String(batter.playerId),
      from,
      to,
    });
    if (hand) qs.set("hand", hand);
    if (abNum) qs.set("abNum", abNum);
    fetch(`/api/mlb/research/atbats?${qs.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setAtBats(d.atBats))
      .catch((e: Error) => setError(e.message));
  }, [batter.playerId, from, to, hand, abNum]);

  const t = batter.trend;
  const bvp = batter.bvp;

  return (
    <div className="mt-2 mb-6 rounded border border-border bg-surface p-4">
      <div className="text-sm font-semibold text-fg mb-3">
        {batter.playerName ?? batter.playerId}
        {batter.batSide && (
          <span className="text-fg-disabled ml-1 text-xs">
            ({batter.batSide})
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-6 mb-4 text-xs">
        <div>
          <div className="text-fg-disabled uppercase tracking-wider text-[10px] mb-1">
            Career BvP
          </div>
          {bvp ? (
            <div className="text-fg-muted tabular-nums">
              {bvp.hits}/{bvp.ab} ({bvp.pa} PA), {bvp.homeRuns} HR
              {bvp.battingAvg != null && `, ${fmtAvg(bvp.battingAvg)} AVG`}
              {bvp.ops != null && `, ${fmtAvg(bvp.ops)} OPS`}
              {bvp.avgEv != null && `, ${fmt1(bvp.avgEv)} EV`}
            </div>
          ) : (
            <div className="text-fg-subtle">No history vs this pitcher.</div>
          )}
        </div>
        {t && (
          <div>
            <div className="text-fg-disabled uppercase tracking-wider text-[10px] mb-1">
              Platoon (vs SP hand)
            </div>
            <div className="text-fg-muted tabular-nums">
              {t.vsHandPa != null ? `${t.vsHandPa} PA` : "-"}
              {t.vsHandHitRate != null && `, ${fmtAvg(t.vsHandHitRate)} H rate`}
              {t.vsHandAvgEv != null && `, ${fmt1(t.vsHandAvgEv)} EV`}
              {t.vsHandHardHitPct != null &&
                `, ${fmtPct(t.vsHandHardHitPct)} hard`}
              {t.vsHandAvgXba != null && `, ${fmtAvg(t.vsHandAvgXba)} xBA*`}
            </div>
          </div>
        )}
      </div>

      <div className="text-fg-disabled uppercase tracking-wider text-[10px] mb-1">
        At-bat log ({from} to {to}
        {hand ? `, vs ${hand}HP` : ""}
        {abNum ? `, AB #${abNum}` : ""})
      </div>
      {error && <div className="text-sm text-neg">Error: {error}</div>}
      {!error && atBats == null && (
        <div className="text-sm text-fg-subtle">Loading...</div>
      )}
      {atBats != null && atBats.length === 0 && (
        <div className="text-sm text-fg-subtle">No at-bats in range.</div>
      )}
      {atBats != null && atBats.length > 0 && (
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs text-fg-muted">
            <thead>
              <tr className="text-fg-disabled border-b border-border">
                <th className="text-left pb-1 pr-3 font-normal">Date</th>
                <th className="text-left pb-1 pr-3 font-normal">Opp</th>
                <th className="text-left pb-1 pr-3 font-normal">Pitcher</th>
                <th className="text-center pb-1 px-1.5 font-normal">Inn</th>
                <th className="text-center pb-1 px-1.5 font-normal">AB#</th>
                <th className="text-left pb-1 px-1.5 font-normal">Result</th>
                <th className="text-center pb-1 px-1.5 font-normal">EV</th>
                <th className="text-center pb-1 px-1.5 font-normal">LA</th>
                <th className="text-center pb-1 px-1.5 font-normal">Dist</th>
                <th className="text-center pb-1 px-1.5 font-normal">xBA*</th>
                <th className="text-center pb-1 px-1.5 font-normal">Bat Spd</th>
                <th className="text-center pb-1 px-1.5 font-normal">HR/Pk</th>
              </tr>
            </thead>
            <tbody>
              {atBats.map((ab) => (
                <tr key={ab.atBatId} className="border-b border-border-subtle">
                  <td className="py-1 pr-3 whitespace-nowrap text-fg-subtle">
                    {fmtShortDate(ab.gameDate)}
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap text-fg-subtle">
                    {ab.oppAbbr ?? "-"}
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap text-fg-subtle">
                    {ab.pitcherName ?? "-"}
                    {ab.pitcherHand && (
                      <span className="text-fg-disabled ml-1 text-[10px]">
                        {ab.pitcherHand}
                      </span>
                    )}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                    {ab.inning ?? "-"}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                    {ab.atBatNumber}
                  </td>
                  <td
                    className={`py-1 px-1.5 whitespace-nowrap ${resultColor(ab.result)}`}
                  >
                    {resultLabel(ab.result)}
                    <StatcastChips
                      ev={ab.ev}
                      la={ab.la}
                      batSpeed={ab.batSpeed}
                    />
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {ab.ev != null ? fmt1(ab.ev) : "-"}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {ab.la ?? "-"}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {ab.dist ?? "-"}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                    {ab.xba != null ? fmtAvg(ab.xba / 100) : "-"}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {ab.batSpeed != null ? fmt1(ab.batSpeed) : "-"}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {fmtHrParks(ab.hrParks)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MlbResearchView() {
  const sp = useSearchParams();
  const { date, game } = useMlbFilters();
  const range = sp.get("range") ?? "season";
  const hand = sp.get("hand");
  const abNum = sp.get("abNum");
  const batterParam = sp.get("batter");

  const [slate, setSlate] = useState<SlateGame[] | null>(null);
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBatter, setSelectedBatter] = useState<number | null>(
    batterParam ? parseInt(batterParam, 10) : null,
  );

  useEffect(() => {
    setSlate(null);
    fetch(`/api/mlb/research/slate?date=${date}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setSlate(d.games))
      .catch((e: Error) => setError(e.message));
  }, [date]);

  const gamePk = useMemo(() => {
    if (game?.gamePk) return game.gamePk;
    return slate && slate.length > 0 ? slate[0].gamePk : null;
  }, [game, slate]);

  const selectedGame = useMemo(
    () => slate?.find((g) => g.gamePk === gamePk) ?? null,
    [slate, gamePk],
  );

  const { from, to } = useMemo(() => {
    const anchor = selectedGame?.gameDate ?? date;
    const opt = RANGE_OPTIONS.find((o) => o.key === range);
    if (!opt || opt.days == null) {
      return { from: `${anchor.slice(0, 4)}-01-01`, to: anchor };
    }
    return { from: shiftDate(anchor, -opt.days), to: anchor };
  }, [selectedGame, date, range]);

  useEffect(() => {
    if (gamePk == null) return;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      gamePk: String(gamePk),
      from,
      to,
    });
    if (hand) qs.set("hand", hand);
    if (abNum) qs.set("abNum", abNum);
    fetch(`/api/mlb/research/grid?${qs.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: GridResponse) => setGrid(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [gamePk, from, to, hand, abNum]);

  // Percentiles rank across BOTH lineups so the two team tables share one
  // scale (a hot away bat and a cold home bat read on the same gradient).
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

  const allBatters = useMemo(
    () => (grid ? [...grid.away.batters, ...grid.home.batters] : []),
    [grid],
  );
  const detailBatter =
    allBatters.find((b) => b.playerId === selectedBatter) ?? null;

  return (
    <div>
      <ResearchFilters basePath="/mlb/research" />
      <div className="px-4 py-4">
        <div className="mb-3">
          <div className="text-sm text-fg-muted">
            Batter research grid, {from} to {to}
            {hand ? `, vs ${hand}HP` : ""}
            {abNum ? `, AB #${abNum}` : ""}
          </div>
          <div className="text-xs text-fg-subtle mt-0.5">
            Cell shading is the batter&apos;s percentile across both lineups for
            that column. xBA* is the StatsAPI hit-probability proxy. Tap a row
            for the per-at-bat log.
          </div>
          <StatcastLegend className="mt-1.5" />
        </div>

        {error && <div className="py-6 text-sm text-neg">Error: {error}</div>}
        {!error && (loading || slate == null) && (
          <div className="py-6 text-sm text-fg-subtle">Loading...</div>
        )}
        {!error && !loading && slate != null && slate.length === 0 && (
          <div className="py-6 text-sm text-fg-subtle">No games on {date}.</div>
        )}
        {!error && !loading && grid && (
          <>
            {detailBatter && (
              <BatterDetail
                batter={detailBatter}
                from={from}
                to={to}
                hand={hand}
                abNum={abNum}
              />
            )}
            <TeamGrid
              team={grid.away}
              opp={grid.home}
              columnValues={columnValues}
              selectedId={selectedBatter}
              onSelect={(id) =>
                setSelectedBatter((cur) => (cur === id ? null : id))
              }
            />
            <TeamGrid
              team={grid.home}
              opp={grid.away}
              columnValues={columnValues}
              selectedId={selectedBatter}
              onSelect={(id) =>
                setSelectedBatter((cur) => (cur === id ? null : id))
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
