"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  LiveHardHitBall,
  LiveHardHitBatter,
  LiveHardHitGame,
  LiveHardHitPitcher,
  LiveHardHitResponse,
} from "@/app/api/mlb-live-hardhit/route";
import { resultColor, resultLabel, veloColor } from "./statcastFormat";

// Standalone /mlb/live board: who is squaring the ball up right now (batters)
// and which pitchers are getting squared up, across every in-progress game.
// Polls /api/mlb-live-hardhit every 30s. Built for HR-hunting: batters ranked
// by barrels then top EV; each hitter's EV/LA/distance/inning/result are from
// their HARDEST ball (so a row is internally consistent), and every hitter row
// expands to show each individual batted ball. Columns are click-to-sort and a
// game filter narrows to one matchup. EV/LA/distance are live from the MLB
// Gameday feed; modeled Savant stats settle in the nightly load. Every name
// links to the player page and every matchup links to the game.

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

// ---- Batter table (sortable + expandable) ----------------------------------

type BatterSortKey =
  | "batterName"
  | "maxEv"
  | "maxEvLa"
  | "maxEvDist"
  | "topInning"
  | "barrels"
  | "hardHit"
  | "bbe";

const NUM = "text-right px-2 py-1.5 tabular-nums whitespace-nowrap";

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
  col: BatterSortKey;
  sortKey: BatterSortKey;
  sortDir: "asc" | "desc";
  onSort: (k: BatterSortKey) => void;
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

function BallRow({ b }: { b: LiveHardHitBall }) {
  const chip = b.barrel ? "Barrel" : b.hard ? "Hard" : null;
  const chipCls = b.barrel
    ? "bg-neg-muted text-neg"
    : "bg-warn-muted text-warn";
  return (
    <tr className="text-[11px]">
      <td className="py-0.5 pr-3 text-fg-subtle tabular-nums">
        {b.inning != null ? `${b.inning}` : "-"}
      </td>
      <td
        className={`py-0.5 pr-3 text-right tabular-nums font-semibold ${veloColor(b.ev)}`}
      >
        {dec(b.ev)}
      </td>
      <td className="py-0.5 pr-3 text-right tabular-nums text-fg-subtle">
        {b.la != null ? `${Math.round(b.la)}°` : "-"}
      </td>
      <td className="py-0.5 pr-3 text-right tabular-nums text-fg-subtle">
        {b.dist != null ? Math.round(b.dist) : "-"}
      </td>
      <td className={`py-0.5 pr-3 ${resultColor(b.result)}`}>
        {resultLabel(b.result)}
      </td>
      <td className="py-0.5">
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

// Rendered as a fragment of <tr>s (main row + optional expanded row).
function BatterRow({
  r,
  game,
  open,
  onToggle,
}: {
  r: LiveHardHitBatter;
  game: LiveHardHitGame | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`border-b border-border-subtle hover:bg-surface transition-colors ${
          r.barrels > 0 ? "bg-neg-muted/40" : ""
        }`}
      >
        <td className="pl-2">
          <button
            onClick={onToggle}
            aria-label={open ? "Collapse" : "Expand"}
            className="text-fg-disabled hover:text-fg"
          >
            {open ? "▾" : "▸"}
          </button>
        </td>
        <td className="px-2 py-1.5">
          <PlayerLink
            id={r.batterId}
            name={r.batterName}
            teamAbbr={r.teamAbbr}
          />
        </td>
        <td className="px-2 py-1.5 text-left text-[11px]">
          <GameLink game={game} />
        </td>
        <td className={`${NUM} font-semibold ${veloColor(r.maxEv)}`}>
          {dec(r.maxEv)}
        </td>
        <td className={`${NUM} text-fg-subtle`}>
          {r.maxEvLa != null ? `${Math.round(r.maxEvLa)}°` : "-"}
        </td>
        <td className={`${NUM} text-fg-subtle`}>
          {r.maxEvDist != null ? Math.round(r.maxEvDist) : "-"}
        </td>
        <td
          className={`px-2 py-1.5 text-left text-[11px] whitespace-nowrap ${resultColor(r.topResult)}`}
        >
          {resultLabel(r.topResult)}
        </td>
        <td className={`${NUM} text-fg-subtle`}>{r.topInning ?? "-"}</td>
        <td
          className={`${NUM} ${r.barrels > 0 ? "font-semibold text-neg" : "text-fg-disabled"}`}
        >
          {r.barrels}
        </td>
        <td
          className={`${NUM} ${r.hardHit > 0 ? "text-warn" : "text-fg-disabled"}`}
        >
          {r.hardHit}
        </td>
        <td className={`${NUM} text-fg-disabled`}>{r.bbe}</td>
      </tr>
      {open && (
        <tr className="bg-canvas">
          <td />
          <td colSpan={10} className="px-3 pb-2 pt-1">
            <div className="text-[10px] uppercase tracking-wider text-fg-disabled mb-1">
              Each batted ball
            </div>
            <table className="text-fg-muted">
              <thead>
                <tr className="text-fg-disabled text-[10px]">
                  <th className="text-left pr-3 font-medium">Inn</th>
                  <th className="text-right pr-3 font-medium">EV</th>
                  <th className="text-right pr-3 font-medium">LA</th>
                  <th className="text-right pr-3 font-medium">Dist</th>
                  <th className="text-left pr-3 font-medium">Result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.balls.map((b, i) => (
                  <BallRow key={i} b={b} />
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function BatterTable({
  rows,
  gameByPk,
}: {
  rows: LiveHardHitBatter[];
  gameByPk: Map<number, LiveHardHitGame>;
}) {
  const [sortKey, setSortKey] = useState<BatterSortKey>("barrels");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const onSort = (k: BatterSortKey) => {
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

  const toggle = (id: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const shared = { sortKey, sortDir, onSort };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-fg-muted">
        <thead>
          <tr className="text-fg-subtle border-b border-border">
            <th className="w-5" />
            <SortTh label="Batter" col="batterName" align="left" {...shared} />
            <th className="text-left px-2 py-1.5 font-medium">Game</th>
            <SortTh
              label="Max EV"
              col="maxEv"
              title="Hardest ball's exit velocity"
              {...shared}
            />
            <SortTh
              label="LA"
              col="maxEvLa"
              title="Launch angle of the hardest ball"
              {...shared}
            />
            <SortTh
              label="Dist"
              col="maxEvDist"
              title="Distance of the hardest ball"
              {...shared}
            />
            <th
              className="text-left px-2 py-1.5 font-medium"
              title="Result of the hardest ball"
            >
              Event
            </th>
            <SortTh
              label="Inn"
              col="topInning"
              title="Inning of the hardest ball"
              {...shared}
            />
            <SortTh
              label="Brl"
              col="barrels"
              title="Barrels — hard-hit in the HR launch window"
              {...shared}
            />
            <SortTh
              label="HH"
              col="hardHit"
              title="Hard-hit balls (EV 95+)"
              {...shared}
            />
            <SortTh
              label="BBE"
              col="bbe"
              title="Batted balls tracked"
              {...shared}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <BatterRow
              key={`${r.gamePk}-${r.batterId}`}
              r={r}
              game={gameByPk.get(r.gamePk)}
              open={expanded.has(r.batterId)}
              onToggle={() => toggle(r.batterId)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Pitcher table ---------------------------------------------------------

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
    !!data?.live && (data.batters.length > 0 || data.pitchers.length > 0);

  // A selected game that has since ended falls back to "all".
  const activeGame =
    gameFilter != null && gameByPk.has(gameFilter) ? gameFilter : null;
  const shownBatters = activeGame
    ? (data?.batters ?? []).filter((b) => b.gamePk === activeGame)
    : (data?.batters ?? []);
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
          Live batted-ball quality, updating every 30s — filter by game, click a
          column to sort, click ▸ to see each batted ball. Ranked by barrels
          (hard contact in the HR launch window) for HR-hunting.
        </div>
      </div>

      {!loaded ? (
        <div className="px-4 py-6 text-sm text-fg-subtle">Loading...</div>
      ) : !hasRows ? (
        <div className="px-4 py-10 text-sm text-fg-subtle">
          No games are live right now. This board fills in with live exit
          velocity — who&apos;s squaring it up and which pitchers are getting
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
            title={`Hitting It Hard — ${shownBatters.length} batter${shownBatters.length === 1 ? "" : "s"}`}
            note="Barrel rows highlighted. Click ▸ to expand each hitter's batted balls (with inning)."
          />
          <BatterTable rows={shownBatters} gameByPk={gameByPk} />

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
