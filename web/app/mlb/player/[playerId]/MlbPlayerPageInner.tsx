"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

interface MlbLogRow {
  gamePk: number;
  gameDate: string;
  side: string;
  oppAbbr: string | null;
  oppPitcherHand: string | null;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  recencyRank: number;
}

interface MlbLogAverages {
  gp: number;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
}

interface MlbLogResponse {
  playerId: number;
  playerName: string | null;
  teamAbbr: string | null;
  teamName: string | null;
  position: string | null;
  rows: MlbLogRow[];
  averages: MlbLogAverages;
}

interface MlbSplitRow {
  splitKey: string;
  label: string;
  gp: number;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  gamePks: number[];
}

interface MlbSplitGroup {
  groupKey: string;
  label: string;
  rows: MlbSplitRow[];
}

interface MlbSplitsResponse {
  playerId: number;
  total_games: number;
  groups: MlbSplitGroup[];
}

function fmtAvg(val: number | null): string {
  if (val == null) return "---";
  return val.toFixed(3).replace(/^0/, "");
}

export default function MlbPlayerPageInner({ playerId }: { playerId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlRange = searchParams.get("range") ?? "season";
  const urlHa = searchParams.get("ha") ?? null;
  const urlPitcherHand = searchParams.get("pitcherHand") ?? null;

  const [logData, setLogData] = useState<MlbLogResponse | null>(null);
  const [splitsData, setSplitsData] = useState<MlbSplitsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const p = new URLSearchParams();
    if (urlRange !== "season") p.set("range", urlRange);
    if (urlHa) p.set("ha", urlHa);
    if (urlPitcherHand) p.set("pitcherHand", urlPitcherHand);
    const qs = p.toString();
    const suffix = qs ? `?${qs}` : "";

    Promise.all([
      fetch(`/api/mlb/player/${playerId}/log${suffix}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MlbLogResponse>;
      }),
      fetch(`/api/mlb/player/${playerId}/splits${suffix}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MlbSplitsResponse>;
      }),
    ])
      .then(([log, splits]) => {
        setLogData(log);
        setSplitsData(splits);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, [playerId, urlRange, urlHa, urlPitcherHand]);

  // Save to schnapp_recent_mlb_players
  useEffect(() => {
    if (!logData?.playerName) return;
    try {
      const key = "schnapp_recent_mlb_players";
      const numericId = Number(playerId);
      if (!Number.isFinite(numericId)) return;
      const entry = {
        id: numericId,
        name: logData.playerName,
        teamAbbr: logData.teamAbbr ?? undefined,
        position: logData.position ?? undefined,
      };
      const raw = window.localStorage.getItem(key);
      const prev: (typeof entry)[] = raw ? JSON.parse(raw) : [];
      const filtered = Array.isArray(prev)
        ? prev.filter((p) => p && p.id !== entry.id)
        : [];
      window.localStorage.setItem(
        key,
        JSON.stringify([entry, ...filtered].slice(0, 8)),
      );
    } catch {
      // best-effort
    }
  }, [playerId, logData?.playerName, logData?.teamAbbr, logData?.position]);

  function updateFilter(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.replace(`/mlb/player/${playerId}${qs ? `?${qs}` : ""}`);
  }

  const displayName = logData?.playerName ?? `Player ${playerId}`;
  const rows = logData?.rows ?? [];
  const averages = logData?.averages;
  const splitGroups = splitsData?.groups ?? [];

  if (error)
    return <div className="px-4 py-6 text-sm text-neg">Error: {error}</div>;

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <button
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push("/mlb?tab=players");
          }}
          className="text-fg-subtle hover:text-fg-muted text-sm flex-none"
        >
          &#8592;
        </button>
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-fg-muted">
            {displayName}
          </span>
          {logData?.teamAbbr && (
            <span className="text-xs text-fg-subtle font-mono">
              {logData.teamAbbr}
            </span>
          )}
          {logData?.position && (
            <span className="text-xs text-fg-disabled font-mono">
              · {logData.position}
            </span>
          )}
        </div>
        {averages && averages.gp > 0 && (
          <span className="ml-auto text-xs text-fg-disabled">
            {averages.gp} GP
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-wrap">
        {(["l5", "l10", "l20", "season"] as const).map((r) => (
          <button
            key={r}
            onClick={() => updateFilter({ range: r === "season" ? null : r })}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              urlRange === r
                ? "bg-brand text-canvas"
                : "bg-surface-hover text-fg-subtle hover:text-fg"
            }`}
          >
            {r === "season" ? "Season" : r.toUpperCase()}
          </button>
        ))}

        <div className="w-px h-4 bg-border mx-1" />

        {(["home", "away"] as const).map((ha) => (
          <button
            key={ha}
            onClick={() => updateFilter({ ha: urlHa === ha ? null : ha })}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors capitalize ${
              urlHa === ha
                ? "bg-brand text-canvas"
                : "bg-surface-hover text-fg-subtle hover:text-fg"
            }`}
          >
            {ha === "home" ? "Home" : "Away"}
          </button>
        ))}

        <div className="w-px h-4 bg-border mx-1" />

        {(["L", "R"] as const).map((hand) => (
          <button
            key={hand}
            onClick={() =>
              updateFilter({
                pitcherHand: urlPitcherHand === hand ? null : hand,
              })
            }
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              urlPitcherHand === hand
                ? "bg-brand text-canvas"
                : "bg-surface-hover text-fg-subtle hover:text-fg"
            }`}
          >
            vs {hand}HP
          </button>
        ))}
      </div>

      {loading && (
        <div className="px-4 py-3 text-sm text-fg-subtle">Loading...</div>
      )}

      {/* Splits table */}
      {!loading && splitGroups.length > 0 && (
        <div className="overflow-x-auto border-b border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-fg-subtle border-b border-border">
                <th className="text-left px-4 py-2 font-medium">Split</th>
                <th className="text-right px-2 py-2 font-medium">GP</th>
                <th className="text-right px-2 py-2 font-medium">AB</th>
                <th className="text-right px-2 py-2 font-medium">H</th>
                <th className="text-right px-2 py-2 font-medium">HR</th>
                <th className="text-right px-2 py-2 font-medium">RBI</th>
                <th className="text-right px-2 py-2 font-medium">BB</th>
                <th className="text-right px-2 py-2 font-medium">K</th>
                <th className="text-right px-3 py-2 font-medium">AVG</th>
                <th className="text-right px-3 py-2 font-medium">OBP</th>
                <th className="text-right px-3 py-2 font-medium">SLG</th>
              </tr>
            </thead>
            <tbody>
              {splitGroups.map((group) => (
                <>
                  <tr key={group.groupKey}>
                    <td
                      colSpan={11}
                      className="px-4 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-subtle bg-canvas"
                    >
                      {group.label}
                    </td>
                  </tr>
                  {group.rows.map((row) => (
                    <tr
                      key={row.splitKey}
                      className="border-b border-border-subtle hover:bg-surface transition-colors"
                    >
                      <td className="px-4 py-1.5 text-fg-subtle">
                        {row.label}
                      </td>
                      <td className="text-right px-2 py-1.5 text-fg-muted tabular-nums">
                        {row.gp}
                      </td>
                      <td className="text-right px-2 py-1.5 text-fg-muted tabular-nums">
                        {row.ab}
                      </td>
                      <td className="text-right px-2 py-1.5 text-fg-muted tabular-nums">
                        {row.h}
                      </td>
                      <td className="text-right px-2 py-1.5 text-fg-muted tabular-nums">
                        {row.hr}
                      </td>
                      <td className="text-right px-2 py-1.5 text-fg-muted tabular-nums">
                        {row.rbi}
                      </td>
                      <td className="text-right px-2 py-1.5 text-fg-muted tabular-nums">
                        {row.bb}
                      </td>
                      <td className="text-right px-2 py-1.5 text-fg-muted tabular-nums">
                        {row.k}
                      </td>
                      <td className="text-right px-3 py-1.5 font-mono text-fg tabular-nums">
                        {fmtAvg(row.avg)}
                      </td>
                      <td className="text-right px-3 py-1.5 font-mono text-fg-subtle tabular-nums">
                        {fmtAvg(row.obp)}
                      </td>
                      <td className="text-right px-3 py-1.5 font-mono text-fg-subtle tabular-nums">
                        {fmtAvg(row.slg)}
                      </td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Game log */}
      {!loading && (
        <div className="flex-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-canvas">
              <tr className="text-xs text-fg-subtle border-b border-border">
                <th className="text-left px-4 py-1.5 font-medium whitespace-nowrap">
                  Date
                </th>
                <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">
                  Opp
                </th>
                <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">
                  AB
                </th>
                <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">
                  H
                </th>
                <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">
                  HR
                </th>
                <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">
                  RBI
                </th>
                <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">
                  BB
                </th>
                <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">
                  K
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-sm text-fg-subtle">
                    No games found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.gamePk}
                    className="border-b border-border hover:bg-surface transition-colors"
                  >
                    <td className="px-4 py-1.5 text-fg-subtle whitespace-nowrap">
                      <Link
                        href={`/mlb/game/${row.gamePk}`}
                        className="hover:text-brand transition-colors"
                      >
                        {row.gameDate.slice(5)}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-fg-subtle whitespace-nowrap">
                      <Link
                        href={`/mlb/game/${row.gamePk}`}
                        className="hover:text-brand transition-colors"
                      >
                        {row.side === "H" ? "" : "@"}
                        {row.oppAbbr ?? "?"}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-right text-fg-muted tabular-nums">
                      {row.ab}
                    </td>
                    <td className="px-2 py-1.5 text-right text-fg-muted tabular-nums">
                      {row.h}
                    </td>
                    <td className="px-2 py-1.5 text-right text-fg-muted tabular-nums">
                      {row.hr}
                    </td>
                    <td className="px-2 py-1.5 text-right text-fg-muted tabular-nums">
                      {row.rbi}
                    </td>
                    <td className="px-2 py-1.5 text-right text-fg-muted tabular-nums">
                      {row.bb}
                    </td>
                    <td className="px-2 py-1.5 text-right text-fg-muted tabular-nums">
                      {row.k}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
