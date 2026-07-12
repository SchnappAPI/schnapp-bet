"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { ColumnDef } from "@tanstack/react-table";
import { fetcher } from "@/lib/fetcher";
import { DataTable } from "@/lib/ui/DataTable";
import { cn } from "@/lib/ui/cn";
import { useMlbFilters } from "@/components/mlb/MlbFilterProvider";
import type { CanonicalMarket } from "@/lib/mlbFilters";

// MLB At-a-Glance — every FanDuel Over prop graded by the MLB model for one
// slate date, cross-game. Deliberately simple: no signals or matrix
// machinery, just a filterable, sortable table over /api/mlb/grades.

// ---- API response types -----------------------------------------------------

interface TierPoint {
  line: number | null;
  prob: number | null;
  price: number | null;
}

interface GradeRow {
  playerId: number;
  playerName: string;
  marketKey: string;
  lineValue: number;
  overPrice: number | null;
  compositeGrade: number | null;
  gamePk: number | null;
  matchup: string | null;
  tiers: {
    safe: TierPoint;
    value: TierPoint;
    highrisk: TierPoint;
    lotto: TierPoint;
  } | null;
}

interface GradesResponse {
  date: string;
  games: { gamePk: number; matchup: string }[];
  rows: GradeRow[];
}

// ---- Formatting helpers -------------------------------------------------------

const MARKET_LABELS: Record<string, string> = {
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  batter_hits_runs_rbis: "H+R+RBI",
  batter_singles: "Singles",
  batter_doubles: "Doubles",
  batter_triples: "Triples",
  batter_walks: "Walks",
  batter_strikeouts: "Strikeouts (B)",
  batter_stolen_bases: "Stolen Bases",
  pitcher_strikeouts: "Strikeouts (P)",
  pitcher_hits_allowed: "Hits Allowed",
  pitcher_walks: "Walks Allowed",
  pitcher_earned_runs: "Earned Runs",
};

function marketLabel(key: string): string {
  return (
    MARKET_LABELS[key] ??
    key.replace(/^(batter|pitcher)_/, "").replace(/_/g, " ")
  );
}

function fmtPrice(p: number | null): string {
  if (p == null) return "—";
  return p > 0 ? `+${p}` : String(p);
}

// Grade band: >=80 strong, 50-79 neutral, <50 weak.
function gradeClass(g: number | null): string {
  if (g == null) return "text-fg-disabled";
  if (g >= 80) return "text-pos font-semibold";
  if (g >= 50) return "text-fg";
  return "text-neg";
}

// ---- Tier ladder cell -----------------------------------------------------------

const TIER_META: {
  key: "safe" | "value" | "highrisk" | "lotto";
  label: string;
  cls: string;
}[] = [
  { key: "safe", label: "S", cls: "text-pos" },
  { key: "value", label: "V", cls: "text-info" },
  { key: "highrisk", label: "H", cls: "text-warn" },
  { key: "lotto", label: "L", cls: "text-neg" },
];

function TierLadder({ tiers }: { tiers: GradeRow["tiers"] }) {
  if (!tiers) return <span className="text-fg-disabled">—</span>;
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
      {TIER_META.map(({ key, label, cls }) => {
        const t = tiers[key];
        if (t.line == null) return null;
        return (
          <span key={key} className="whitespace-nowrap" title={`${key} tier`}>
            <span className={cn("font-semibold", cls)}>{label}</span>
            <span className="text-fg-muted"> {t.line}</span>
            <span className="text-fg-subtle">·{fmtPrice(t.price)}</span>
          </span>
        );
      })}
    </span>
  );
}

// ---- Sorting -------------------------------------------------------------------

type SortKey = "player" | "matchup" | "market" | "line" | "odds" | "grade";
type SortDir = "asc" | "desc";

const SORT_ACCESSORS: Record<SortKey, (r: GradeRow) => string | number> = {
  player: (r) => r.playerName.toLowerCase(),
  matchup: (r) => r.matchup ?? "",
  market: (r) => marketLabel(r.marketKey),
  line: (r) => r.lineValue,
  odds: (r) => r.overPrice ?? Number.NEGATIVE_INFINITY,
  grade: (r) => r.compositeGrade ?? Number.NEGATIVE_INFINITY,
};

// ---- Page ----------------------------------------------------------------------

type MarketFilter =
  "all" | "batter_home_runs" | "batter_hits" | "batter_hits_runs_rbis";
type CategoryFilter = "all" | "batter" | "pitcher";

const MIN_GRADE_OPTIONS = [0, 50, 65, 80] as const;

// Map the shared filter bar's canonical market vocab onto this board's
// FanDuel market keys. No canonical equivalent falls back to "all".
function canonicalToGradesMarket(m: CanonicalMarket): MarketFilter {
  switch (m) {
    case "HR":
      return "batter_home_runs";
    case "HITS":
      return "batter_hits";
    case "HRR":
      return "batter_hits_runs_rbis";
    default:
      return "all";
  }
}

export default function MlbGradesPageInner() {
  const { date, market: ctxMarket, game } = useMlbFilters();
  const market = canonicalToGradesMarket(ctxMarket);
  const gamePk = game?.gamePk != null ? String(game.gamePk) : "";
  const [minGrade, setMinGrade] = useState<number>(0);
  // Batter/pitcher CATEGORY axis — independent of the shared market pill,
  // which only expresses specific batter markets (or "all"). The shared bar
  // has no pitcher-prop concept, so this stays a small local control and
  // composes with the canonical-market filter below.
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("grade");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, error, isLoading } = useSWR<GradesResponse>(
    `/api/mlb/grades?date=${date}`,
    fetcher,
    { revalidateOnFocus: false },
  );

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const games = data?.games ?? [];

  const rows = useMemo(() => {
    let out = allRows;
    if (market !== "all") out = out.filter((r) => r.marketKey === market);
    if (category !== "all")
      out = out.filter((r) => r.marketKey.startsWith(`${category}_`));
    if (gamePk) out = out.filter((r) => String(r.gamePk ?? "") === gamePk);
    if (minGrade > 0)
      out = out.filter((r) => (r.compositeGrade ?? -1) >= minGrade);

    const acc = SORT_ACCESSORS[sortKey];
    const mul = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const av = acc(a);
      const bv = acc(b);
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return 0;
    });
  }, [allRows, market, category, gamePk, minGrade, sortKey, sortDir]);

  const avgGrade = useMemo(() => {
    const graded = rows
      .map((r) => r.compositeGrade)
      .filter((g): g is number => g != null);
    if (graded.length === 0) return null;
    return graded.reduce((s, g) => s + g, 0) / graded.length;
  }, [rows]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(
        key === "player" || key === "matchup" || key === "market"
          ? "asc"
          : "desc",
      );
    }
  }

  const sortHeader = (label: string, key: SortKey) => () => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className="flex items-center gap-1 uppercase hover:text-fg"
    >
      {label}
      {sortKey === key && (
        <span className="text-sport-mlb">{sortDir === "asc" ? "▲" : "▼"}</span>
      )}
    </button>
  );

  const columns = useMemo<ColumnDef<GradeRow, unknown>[]>(
    () => [
      {
        id: "player",
        header: sortHeader("Player", "player"),
        size: 170,
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.playerName}
          </span>
        ),
      },
      {
        id: "matchup",
        header: sortHeader("Matchup", "matchup"),
        size: 96,
        cell: ({ row }) => (
          <span className="text-sport-mlb">{row.original.matchup ?? "—"}</span>
        ),
      },
      {
        id: "market",
        header: sortHeader("Market", "market"),
        size: 116,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {marketLabel(row.original.marketKey)}
          </span>
        ),
      },
      {
        id: "line",
        header: sortHeader("Line", "line"),
        size: 64,
        cell: ({ row }) => <span>O {row.original.lineValue}</span>,
      },
      {
        id: "odds",
        header: sortHeader("Odds", "odds"),
        size: 60,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {fmtPrice(row.original.overPrice)}
          </span>
        ),
      },
      {
        id: "grade",
        header: sortHeader("Grade", "grade"),
        size: 64,
        cell: ({ row }) => (
          <span className={gradeClass(row.original.compositeGrade)}>
            {row.original.compositeGrade == null
              ? "—"
              : row.original.compositeGrade.toFixed(0)}
          </span>
        ),
      },
      {
        id: "tiers",
        header: "Tier Ladder",
        size: 320,
        cell: ({ row }) => <TierLadder tiers={row.original.tiers} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortKey, sortDir],
  );

  const selectCls =
    "text-sm bg-surface border border-border rounded px-2 py-1 text-fg-muted focus:outline-none focus:border-border-strong cursor-pointer";

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header — date + filters */}
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-sport-mlb">
          MLB · At-a-Glance
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryFilter)}
            className={selectCls}
            aria-label="Batter/pitcher category"
          >
            <option value="all">All players</option>
            <option value="batter">Batters</option>
            <option value="pitcher">Pitchers</option>
          </select>
          <select
            value={minGrade}
            onChange={(e) => setMinGrade(Number(e.target.value))}
            className={selectCls}
            aria-label="Minimum grade"
          >
            {MIN_GRADE_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g === 0 ? "Any grade" : `Grade ${g}+`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary strip */}
      <div className="px-4 py-2 border-b border-border-subtle flex flex-wrap items-center gap-6 font-mono text-[11px] uppercase tracking-wide text-fg-subtle">
        <span>
          Props <span className="text-fg tabular-nums">{rows.length}</span>
        </span>
        <span>
          Avg grade{" "}
          <span className={cn("tabular-nums", gradeClass(avgGrade))}>
            {avgGrade == null ? "—" : avgGrade.toFixed(1)}
          </span>
        </span>
        <span>
          Games <span className="text-fg tabular-nums">{games.length}</span>
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 p-4">
        {error ? (
          <div className="text-sm text-neg">Failed to load grades.</div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            className="max-h-[calc(100vh-180px)]"
            emptyMessage={
              isLoading ? "Loading..." : `No MLB graded props for ${date}.`
            }
          />
        )}
      </div>
    </div>
  );
}
