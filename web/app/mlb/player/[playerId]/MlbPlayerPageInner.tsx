"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import MlbStatcastSection from "./MlbStatcastSection";

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

interface UpcomingGame {
  gamePk: number;
  gameDate: string;
  gameDateTime: string | null;
  side: string;
  oppAbbr: string | null;
  oppPitcherId: number | null;
  oppPitcherName: string | null;
  oppPitcherHand: string | null;
}

interface BvpLine {
  pa: number | null;
  ab: number | null;
  h: number | null;
  doubles: number | null;
  triples: number | null;
  hr: number | null;
  rbi: number | null;
  bb: number | null;
  k: number | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  lastFaced: string | null;
}

interface PatternLine {
  asOfDate: string;
  gamesPlayed: number | null;
  hrGames: number | null;
  gamesSinceHr: number | null;
  patternSamples: number | null;
  patternRepeats: number | null;
  patternHitRate: number | null;
  hrPatternEarly: number | null;
  hrPatternLate: number | null;
  hrHot: boolean;
}

interface ProjectionCell {
  value: number;
  confidence: number | null;
}

interface MlbLogResponse {
  playerId: number;
  playerName: string | null;
  teamAbbr: string | null;
  teamName: string | null;
  position: string | null;
  rows: MlbLogRow[];
  averages: MlbLogAverages;
  upcoming: UpcomingGame | null;
  bvp: BvpLine | null;
  patterns: PatternLine | null;
  projections: Record<string, ProjectionCell> | null;
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

// Pattern rates and prob markets are 0-1 decimals — display as percents.
function fmtRatePct(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${(val * 100).toFixed(0)}%`;
}

// Projections strip layout: label → market_key, counts vs probabilities.
const PROJ_MARKETS: { label: string; key: string; pct?: boolean }[] = [
  { label: "xH", key: "batter_hits" },
  { label: "xTB", key: "batter_total_bases" },
  { label: "xHR", key: "batter_home_runs" },
  { label: "Hit%", key: "hit_prob", pct: true },
  { label: "HR%", key: "hr_prob", pct: true },
  { label: "H+R+RBI", key: "batter_hits_runs_rbis" },
];

export default function MlbPlayerPageInner({ playerId }: { playerId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlRange = searchParams.get("range") ?? "season";
  const urlHa = searchParams.get("ha") ?? null;
  const urlPitcherHand = searchParams.get("pitcherHand") ?? null;
  // Default to the Statcast (exit-velocity) view; Game Log is opt-in via ?view=log.
  const urlView = searchParams.get("view") === "log" ? "log" : "statcast";

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

      {/* View switch: game log vs Statcast exit-velocity log */}
      <div className="flex items-center gap-1 px-4 pt-3">
        <div className="flex overflow-hidden rounded border border-border">
          {(["log", "statcast"] as const).map((v) => (
            <button
              key={v}
              onClick={() =>
                updateFilter({ view: v === "statcast" ? null : v })
              }
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                urlView === v
                  ? "bg-brand text-canvas"
                  : "bg-surface text-fg-subtle hover:bg-surface-hover"
              }`}
            >
              {v === "log" ? "Game Log" : "Statcast"}
            </button>
          ))}
        </div>
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

        {logData?.upcoming?.oppPitcherHand && (
          <>
            <div className="w-px h-4 bg-border mx-1" />
            <button
              onClick={() =>
                updateFilter({
                  pitcherHand:
                    urlPitcherHand === logData.upcoming!.oppPitcherHand
                      ? null
                      : logData.upcoming!.oppPitcherHand,
                })
              }
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                urlPitcherHand === logData.upcoming.oppPitcherHand
                  ? "bg-brand text-canvas"
                  : "bg-surface-hover text-fg-subtle hover:text-fg"
              }`}
              title={`Next: ${logData.upcoming.side === "H" ? "vs" : "@"} ${
                logData.upcoming.oppAbbr ?? "?"
              } — ${logData.upcoming.oppPitcherName ?? "TBD"}`}
            >
              vs Upcoming SP ({logData.upcoming.oppPitcherHand})
            </button>
          </>
        )}
      </div>

      {/* Career line vs the upcoming probable SP */}
      {logData?.upcoming && logData?.bvp && (
        <div className="px-4 py-2 border-b border-border flex items-baseline gap-x-3 gap-y-1 flex-wrap text-xs">
          <span className="text-fg-subtle uppercase tracking-wider text-[10px] font-semibold">
            BvP
          </span>
          <Link
            href={`/mlb/game/${logData.upcoming.gamePk}`}
            className="text-fg-muted font-semibold hover:text-brand transition-colors"
          >
            vs {logData.upcoming.oppPitcherName}
            {logData.upcoming.oppPitcherHand
              ? ` (${logData.upcoming.oppPitcherHand})`
              : ""}
          </Link>
          <span className="text-fg-muted tabular-nums">
            {logData.bvp.h ?? 0}-for-{logData.bvp.ab ?? 0}
          </span>
          {(logData.bvp.hr ?? 0) > 0 && (
            <span className="text-warn tabular-nums">{logData.bvp.hr} HR</span>
          )}
          {(logData.bvp.k ?? 0) > 0 && (
            <span className="text-fg-subtle tabular-nums">
              {logData.bvp.k} K
            </span>
          )}
          <span className="text-fg-subtle tabular-nums">
            {fmtAvg(logData.bvp.avg)} AVG
          </span>
          <span className="text-fg-subtle tabular-nums">
            {fmtAvg(logData.bvp.ops)} OPS
          </span>
          {logData.bvp.lastFaced && (
            <span className="text-fg-disabled">
              last faced {logData.bvp.lastFaced}
            </span>
          )}
        </div>
      )}

      {/* HR pattern card (mlb.player_patterns; rates are 0-1 decimals) */}
      {logData?.patterns && (
        <div className="px-4 py-2 border-b border-border flex items-baseline gap-x-3 gap-y-1 flex-wrap text-xs">
          <span className="text-fg-subtle uppercase tracking-wider text-[10px] font-semibold">
            HR Pattern
          </span>
          {logData.patterns.hrHot && (
            <span className="inline-block rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide whitespace-nowrap bg-warn-muted text-warn">
              HR Hot
            </span>
          )}
          <span className="text-fg-muted tabular-nums">
            Games since HR: {logData.patterns.gamesSinceHr ?? "—"}
          </span>
          <span className="text-fg-muted tabular-nums">
            Repeat rate: {fmtRatePct(logData.patterns.patternHitRate)} (
            {logData.patterns.patternRepeats ?? 0}/
            {logData.patterns.patternSamples ?? 0})
          </span>
          {(logData.patterns.patternRepeats ?? 0) > 0 && (
            <span className="text-fg-subtle tabular-nums">
              Early/late: {fmtRatePct(logData.patterns.hrPatternEarly)} /{" "}
              {fmtRatePct(logData.patterns.hrPatternLate)}
            </span>
          )}
          <span className="text-fg-disabled">
            as of {logData.patterns.asOfDate}
          </span>
        </div>
      )}

      {/* Projections strip for the upcoming game (proj-v1.1 model outputs) */}
      {logData?.projections && (
        <div className="px-4 py-2 border-b border-border flex items-baseline gap-x-3 gap-y-1 flex-wrap text-xs">
          <span className="text-fg-subtle uppercase tracking-wider text-[10px] font-semibold">
            Projections (proj-v1.1)
          </span>
          {PROJ_MARKETS.map((m) => {
            const cell = logData.projections![m.key];
            if (!cell) return null;
            return (
              <span key={m.key} className="text-fg-muted tabular-nums">
                {m.label}:{" "}
                {m.pct ? fmtRatePct(cell.value) : cell.value.toFixed(2)}
              </span>
            );
          })}
          {(() => {
            const conf = PROJ_MARKETS.map(
              (m) => logData.projections![m.key]?.confidence,
            ).find((c) => c != null);
            return conf != null ? (
              <span className="text-fg-disabled">conf {fmtRatePct(conf)}</span>
            ) : null;
          })()}
        </div>
      )}

      {loading && (
        <div className="px-4 py-3 text-sm text-fg-subtle">Loading...</div>
      )}

      {/* Statcast exit-velocity view */}
      {urlView === "statcast" && (
        <MlbStatcastSection
          playerId={playerId}
          range={urlRange}
          pitcherHand={urlPitcherHand}
        />
      )}

      {/* Splits table */}
      {urlView === "log" && !loading && splitGroups.length > 0 && (
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
                <React.Fragment key={group.groupKey}>
                  <tr>
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
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Game log */}
      {urlView === "log" && !loading && (
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
