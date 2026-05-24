"use client";

import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { fetcher } from "@/lib/fetcher";

const FORWARD_PARAMS = [
  "range",
  "vs",
  "vsUpcoming",
  "ha",
  "starter",
  "minGt",
  "wl",
  "rest",
  "b2b",
  "since",
  "until",
];

interface SplitRow {
  splitKey: string;
  label: string;
  gp: number;
  min: number;
  pts: number;
  fg3m: number;
  reb: number;
  ast: number;
  pra: number;
  pr: number;
  pa: number;
  ra: number;
  fgPct: number | null;
  fg3Pct: number | null;
  ftPct: number | null;
  gameIds: string[];
}

interface SplitGroup {
  groupKey: string;
  label: string;
  rows: SplitRow[];
}

interface SplitsResponse {
  player_id: number;
  upcoming_opp_team_id: number | null;
  upcoming_opp_abbr: string | null;
  total_games: number;
  groups: SplitGroup[];
  updated_at: string;
}

export interface PlayerSplitsTableProps {
  playerId: number;
  activeSplitKey?: string | null;
  onApplyFilter?: (
    splitKey: string | null,
    splitLabel: string | null,
    gameIds: string[] | null,
  ) => void;
}

function avg(n: number, dp: 1 | 2 = 1): string {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(dp);
}

function pct(n: number | null): string {
  if (n == null) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMin(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "-";
  const m = Math.floor(n);
  const s = Math.round((n - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PlayerSplitsTable({
  playerId,
  activeSplitKey = null,
  onApplyFilter,
}: PlayerSplitsTableProps) {
  const sp = useSearchParams();
  const forwarded = new URLSearchParams();
  for (const key of FORWARD_PARAMS) {
    const v = sp.get(key);
    if (v != null && v !== "") forwarded.set(key, v);
  }
  const qs = forwarded.toString();

  const { data, error, isLoading } = useSWR<SplitsResponse>(
    `/api/player/${playerId}/splits${qs ? `?${qs}` : ""}`,
    fetcher,
    {
      refreshInterval: 0,
      revalidateOnFocus: false,
      dedupingInterval: 15_000,
    },
  );

  if (isLoading) {
    return (
      <div className="px-4 py-3 text-xs text-fg-disabled">
        Loading splits...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 text-xs text-neg">
        Error loading splits: {(error as Error).message}
      </div>
    );
  }

  if (!data || data.total_games === 0) {
    return (
      <div className="px-4 py-3 text-xs text-fg-disabled">
        No games yet this season.
      </div>
    );
  }

  function handleRowClick(row: SplitRow) {
    if (!onApplyFilter) return;
    if (row.gp === 0) return;
    if (activeSplitKey === row.splitKey) {
      onApplyFilter(null, null, null);
    } else {
      onApplyFilter(row.splitKey, row.label, row.gameIds);
    }
  }

  return (
    <div className="overflow-x-auto border-b border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-fg-subtle">
            <th className="text-left px-4 py-2 font-medium sticky left-0 bg-canvas z-10">
              Split
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              GP
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              MIN
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              PTS
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              3PM
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              REB
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              AST
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              PRA
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              PR
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              PA
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              RA
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              FG%
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              3P%
            </th>
            <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
              FT%
            </th>
          </tr>
        </thead>
        <tbody>
          {data.groups.map((group) => (
            <SplitGroupRows
              key={group.groupKey}
              group={group}
              activeSplitKey={activeSplitKey}
              onRowClick={handleRowClick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SplitGroupRows({
  group,
  activeSplitKey,
  onRowClick,
}: {
  group: SplitGroup;
  activeSplitKey: string | null;
  onRowClick: (row: SplitRow) => void;
}) {
  return (
    <>
      {group.groupKey !== "all" && (
        <tr className="bg-surface text-fg-disabled">
          <td
            colSpan={14}
            className="px-4 py-1 text-[10px] uppercase tracking-wider sticky left-0 bg-surface z-10"
          >
            {group.label}
          </td>
        </tr>
      )}
      {group.rows.map((row) => {
        const isActive = activeSplitKey === row.splitKey;
        const isHighlighted = group.groupKey === "all";
        const empty = row.gp === 0;
        return (
          <tr
            key={row.splitKey}
            onClick={() => onRowClick(row)}
            className={[
              "border-t border-subtle transition-colors",
              empty ? "opacity-55" : "cursor-pointer hover:bg-surface-hover",
              isActive ? "bg-brand-muted" : "",
              isHighlighted ? "font-medium" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={
              empty
                ? "No games match this split"
                : isActive
                  ? "Click to clear filter"
                  : "Click to filter game log to these games"
            }
          >
            <td className="px-4 py-2 text-fg-subtle whitespace-nowrap sticky left-0 bg-canvas z-10">
              {row.label}
              {isActive && (
                <span className="ml-2 text-[10px] text-brand">[active]</span>
              )}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {row.gp}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {empty ? "-" : fmtMin(row.min)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {empty ? "-" : avg(row.pts)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {empty ? "-" : avg(row.fg3m)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {empty ? "-" : avg(row.reb)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {empty ? "-" : avg(row.ast)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {empty ? "-" : avg(row.pra)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {empty ? "-" : avg(row.pr)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {empty ? "-" : avg(row.pa)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {empty ? "-" : avg(row.ra)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {pct(row.fgPct)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {pct(row.fg3Pct)}
            </td>
            <td className="px-2 py-2 text-right text-fg-muted tabular-nums">
              {pct(row.ftPct)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
