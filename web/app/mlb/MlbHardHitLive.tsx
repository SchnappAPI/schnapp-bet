"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import type {
  LiveHardHitBattedBall,
  LiveHardHitGame,
  LiveHardHitPitcher,
  LiveHardHitResponse,
} from "@/app/api/mlb-live-hardhit/route";
import { resultColor, resultLabel, veloColor } from "./statcastFormat";

// Standalone /mlb/live board: every batted ball being hit hard right now — ONE
// ROW PER AT-BAT (no per-hitter roll-up) — and which pitchers are getting
// squared up, across every in-progress game. Polls /api/mlb-live-hardhit every
// 30s. Built for HR-hunting: rows default to loudest exit velocity first, every
// column is click-to-sort (incl. AB# for chronological order), and a game
// filter narrows to one matchup. EV/LA/distance are live from the MLB Gameday
// feed; modeled Savant stats settle in the nightly load. Every batter links to
// the player page and every matchup links to the game.

const POLL_MS = 30_000;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtClock(ms: number | null): string {
  if (ms == null) return "";
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function dec(v: number | null, d = 1): string {
  return v == null ? "-" : Number(v).toFixed(d);
}

function GameLink({ game }: { game: LiveHardHitGame | undefined }) {
  if (!game) return <span className="text-fg-disabled">-</span>;
  return (
    <Link
      href={`/mlb/game/${game.gamePk}`}
      className="text-fg-subtle hover:text-brand transition-colors whitespace-nowrap"
    >
      {game.awayAbbr ?? "?"}@{game.homeAbbr ?? "?"}
    </Link>
  );
}

function PlayerLink({
  id,
  name,
  teamAbbr,
}: {
  id: number | null;
  name: string | null;
  teamAbbr: string | null;
}) {
  const label = name ?? (id != null ? String(id) : "-");
  return (
    <span className="whitespace-nowrap">
      {id != null ? (
        <Link
          href={`/mlb/player/${id}`}
          className="text-fg-muted hover:text-brand transition-colors"
        >
          {label}
        </Link>
      ) : (
        label
      )}
      {teamAbbr && (
        <span className="text-fg-disabled ml-1 text-[10px]">{teamAbbr}</span>
      )}
    </span>
  );
}

const NUM = "text-right px-2 py-1.5 tabular-nums whitespace-nowrap";

// ---- Batted-ball table (flat, one row per at-bat, sortable) ----------------

type BallSortKey = "abNumber" | "batterName" | "inning" | "ev" | "la" | "dist";

function SortTh({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align = "right",
  title,
}: {
  label: string;
  col: BallSortKey;
  sortKey: BallSortKey;
  sortDir: "asc" | "desc";
  onSort: (k: BallSortKey) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const active = sortKey === col;
  return (
    <th
      className={`${align === "right" ? "text-right" : "text-left"} px-2 py-1.5 font-medium whitespace-nowrap`}
      title={title}
    >
      <button
        onClick={() => onSort(col)}
        className={`hover:text-fg transition-colors ${active ? "text-fg" : ""}`}
      >
        {label}
        {active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

function BallRow({
  b,
  game,
}: {
  b: LiveHardHitBattedBall;
  game: LiveHardHitGame | undefined;
}) {
  const chip = b.barrel ? "Barrel" : b.hard ? "Hard" : null;
  const chipCls = b.barrel
    ? "bg-neg-muted text-neg"
    : "bg-warn-muted text-warn";
  return (
    <tr
      className={`border-b border-border-subtle hover:bg-surface transition-colors ${
        b.barrel ? "bg-neg-muted/40" : ""
      }`}
    >
      <td className={`${NUM} text-fg-subtle`}>{b.abNumber ?? "-"}</td>
      <td className="px-2 py-1.5">
        <PlayerLink id={b.batterId} name={b.batterName} teamAbbr={b.teamAbbr} />
      </td>
      <td className="px-2 py-1.5 text-left text-[11px]">
        <GameLink game={game} />
      </td>
      <td className={`${NUM} text-fg-subtle`}>{b.inning ?? "-"}</td>
      <td className={`${NUM} font-semibold ${veloColor(b.ev)}`}>{dec(b.ev)}</td>
      <td className={`${NUM} text-fg-subtle`}>
        {b.la != null ? `${Math.round(b.la)}°` : "-"}
      </td>
      <td className={`${NUM} text-fg-subtle`}>
        {b.dist != null ? Math.round(b.dist) : "-"}
      </td>
      <td
        className={`px-2 py-1.5 text-left text-[11px] whitespace-nowrap ${resultColor(b.result)}`}
      >
        {resultLabel(b.result)}
      </td>
      <td className="px-2 py-1.5">
        {chip && (
          <span
            className={`rounded px-1 py-px text-[9px] font-medium uppercase ${chipCls}`}
          >
            {chip}
          </span>
        )}
      </td>
    </tr>
  );
}

function BallTable({
  rows,
  gameByPk,
}: {
  rows: LiveHardHitBattedBall[];
  gameByPk: Map<number, LiveHardHitGame>;
}) {
  // Loudest contact first by default; click AB# for chronological order.
  const [sortKey, setSortKey] = useState<BallSortKey>("ev");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const onSort = (k: BallSortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "batterName" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "batterName")
        return dir * (a.batterName ?? "").localeCompare(b.batterName ?? "");
      const av = (a[sortKey] as number | null) ?? -Infinity;
      const bv = (b[sortKey] as number | null) ?? -Infinity;
      return dir * (av - bv);
    });
  }, [rows, sortKey, sortDir]);

  const shared = { sortKey, sortDir, onSort };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-fg-muted">
        <thead>
          <tr className="text-fg-subtle border-b border-border">
            <SortTh
              label="AB#"
              col="abNumber"
              title="Game at-bat number (1..N in PA order) — sort to order chronologically"
              {...shared}
            />
            <SortTh label="Batter" col="batterName" align="left" {...shared} />
            <th className="text-left px-2 py-1.5 font-medium">Game</th>
            <SortTh
              label="Inn"
              col="inning"
              title="Inning of this batted ball"
              {...shared}
            />
            <SortTh
              label="EV"
              col="ev"
              title="Exit velocity (mph)"
              {...shared}
            />
            <SortTh
              label="LA"
              col="la"
              title="Launch angle (degrees)"
              {...shared}
            />
            <SortTh
              label="Dist"
              col="dist"
              title="Projected distance (ft)"
              {...shared}
            />
            <th
              className="text-left px-2 py-1.5 font-medium"
              title="Result of this at-bat"
            >
              Event
            </th>
            <th
              className="text-left px-2 py-1.5 font-medium"
              title="Barrel (HR launch window) or Hard-hit (EV 95+) tag"
            >
              Tag
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((b, i) => (
            <BallRow
              key={`${b.gamePk}-${b.batterId}-${b.abNumber ?? "?"}-${i}`}
              b={b}
              game={gameByPk.get(b.gamePk)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Pitcher table (aggregate — "who is getting squared up") ----------------

function PitcherTable({
  rows,
  gameByPk,
}: {
  rows: LiveHardHitPitcher[];
  gameByPk: Map<number, LiveHardHitGame>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-fg-muted">
        <thead>
          <tr className="text-fg-subtle border-b border-border">
            <th className="text-left px-3 py-1.5 font-medium">Pitcher</th>
            <th className="text-left px-2 py-1.5 font-medium">Game</th>
            <th className={NUM} title="Hard-hit balls allowed (EV 95+)">
              HH Allowed
            </th>
            <th className={NUM}>Max EV</th>
            <th className={NUM}>Avg EV</th>
            <th className={NUM}>BBE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.gamePk}-${r.pitcherId}`}
              className="border-b border-border-subtle hover:bg-surface transition-colors"
            >
              <td className="px-3 py-1.5">
                <PlayerLink
                  id={r.pitcherId}
                  name={r.pitcherName}
                  teamAbbr={r.teamAbbr}
                />
              </td>
              <td className="px-2 py-1.5 text-left text-[11px]">
                <GameLink game={gameByPk.get(r.gamePk)} />
              </td>
              <td
                className={`${NUM} ${r.hardHitAllowed > 0 ? "font-semibold text-warn" : "text-fg-disabled"}`}
              >
                {r.hardHitAllowed}
              </td>
              <td className={`${NUM} ${veloColor(r.maxEvAllowed)}`}>
                {dec(r.maxEvAllowed)}
              </td>
              <td className={`${NUM} text-fg-subtle`}>{dec(r.avgEvAllowed)}</td>
              <td className={`${NUM} text-fg-disabled`}>{r.bbe}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="px-3 pt-4 pb-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-fg">
        {title}
      </div>
      <div className="text-[10px] text-fg-disabled">{note}</div>
    </div>
  );
}

export default function MlbHardHitLive() {
  const [data, setData] = useState<LiveHardHitResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [gameFilter, setGameFilter] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const date = todayLocal();
    const load = () => {
      fetch(`/api/mlb-live-hardhit?date=${date}`, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d: LiveHardHitResponse) => {
          if (!cancelled) {
            setData(d);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled) setLoaded(true);
        });
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const gameByPk = useMemo(
    () => new Map((data?.games ?? []).map((g) => [g.gamePk, g])),
    [data],
  );

  const hasRows =
    !!data?.live && (data.balls.length > 0 || data.pitchers.length > 0);

  // A selected game that has since ended falls back to "all".
  const activeGame =
    gameFilter != null && gameByPk.has(gameFilter) ? gameFilter : null;
  const shownBalls = activeGame
    ? (data?.balls ?? []).filter((b) => b.gamePk === activeGame)
    : (data?.balls ?? []);
  const shownPitchers = activeGame
    ? (data?.pitchers ?? []).filter((p) => p.gamePk === activeGame)
    : (data?.pitchers ?? []);

  const chip = (on: boolean) =>
    `rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
      on
        ? "bg-brand text-canvas"
        : "bg-surface-hover text-fg-subtle hover:text-fg"
    }`;

  return (
    <div className="flex flex-col min-h-screen">
      <div className="px-3 py-3 border-b border-border">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${hasRows ? "bg-pos animate-pulse" : "bg-fg-disabled"}`}
          />
          MLB Live · Hard-Hit Board
          {hasRows && data?.asOf != null && (
            <span className="text-fg-disabled font-normal normal-case tracking-normal">
              as of {fmtClock(data.asOf)}
            </span>
          )}
        </div>
        <div className="text-[11px] text-fg-disabled mt-0.5">
          Every batted ball, one row per at-bat, updating every 30s — filter by
          game and click any column to sort (AB# for chronological order).
          Sorted by exit velocity for HR-hunting; barrels (hard contact in the
          HR launch window) are highlighted.
        </div>
      </div>

      {!loaded ? (
        <div className="px-4 py-6 text-sm text-fg-subtle">Loading...</div>
      ) : !hasRows ? (
        <div className="px-4 py-10 text-sm text-fg-subtle">
          No games are live right now. This board fills in with live exit
          velocity — every ball being hit hard and which pitchers are getting
          squared up — once games are underway.
        </div>
      ) : (
        <div className="pb-6">
          {/* Game filter */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
            <span className="text-[10px] uppercase tracking-wider text-fg-disabled mr-1">
              Game
            </span>
            <button
              className={chip(activeGame == null)}
              onClick={() => setGameFilter(null)}
            >
              All ({data!.games.length})
            </button>
            {data!.games.map((g) => (
              <button
                key={g.gamePk}
                className={chip(activeGame === g.gamePk)}
                onClick={() => setGameFilter(g.gamePk)}
              >
                {g.awayAbbr ?? "?"}@{g.homeAbbr ?? "?"}
                {g.label ? (
                  <span className="ml-1 opacity-70">{g.label}</span>
                ) : null}
              </button>
            ))}
          </div>

          <SectionHeader
            title={`Hitting It Hard — ${shownBalls.length} batted ball${shownBalls.length === 1 ? "" : "s"}`}
            note="One row per at-bat. Barrel rows highlighted. Sort AB# for chronological order."
          />
          <BallTable rows={shownBalls} gameByPk={gameByPk} />

          <SectionHeader
            title="Getting Squared Up"
            note="Pitchers allowing the most hard contact — their opposing hitters are locked in."
          />
          <PitcherTable rows={shownPitchers} gameByPk={gameByPk} />
        </div>
      )}
    </div>
  );
}
