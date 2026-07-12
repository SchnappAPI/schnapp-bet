"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import type {
  LiveHardHitBattedBall,
  LiveHardHitGame,
  LiveHardHitPitcher,
  LiveHardHitResponse,
  LiveWatchPlayer,
} from "@/app/api/mlb-live-hardhit/route";
import { useMlbFilters } from "@/components/mlb/MlbFilterProvider";
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

type BallSortKey =
  | "ts"
  | "abNumber"
  | "batterName"
  | "inning"
  | "ev"
  | "la"
  | "dist";

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
      <td className={`${NUM} text-fg-subtle text-[11px]`}>{fmtClock(b.ts)}</td>
      <td className={`${NUM} text-fg-disabled`}>{b.abNumber ?? "-"}</td>
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
              label="Time"
              col="ts"
              title="Wall-clock time the ball was hit (from the live feed) — sort for true most-recent-first across ALL games"
              {...shared}
            />
            <SortTh
              label="AB#"
              col="abNumber"
              title="Game at-bat number (1..N per game) — a per-game counter, NOT a cross-game clock; use Time to order across games"
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

// ---- Players to Watch (live loud contact × pre-game HR projection) ----------

const REASON_TAG: Record<
  LiveWatchPlayer["reason"],
  { label: string; cls: string; title: string }
> = {
  barreled: {
    label: "Barreled",
    cls: "bg-neg-muted text-neg",
    title: "Already barreled one — hard contact in the HR launch window",
  },
  just_missed: {
    label: "Adjust LA",
    cls: "bg-warn-muted text-warn",
    title:
      "Hit it hard and far but the launch angle stayed outside the HR window — the power is there, the angle isn't",
  },
  hard_contact: {
    label: "Hard contact",
    cls: "bg-surface text-fg-muted",
    title: "Squaring the ball up — a hard-hit ball (EV 95+)",
  },
};

function tierClass(tier: string | null): string {
  if (!tier) return "text-fg-disabled";
  const t = tier.toLowerCase();
  if (t.includes("elite")) return "bg-pos-muted text-pos";
  if (t.includes("high") || t.includes("above"))
    return "bg-brand-muted text-brand";
  if (t.includes("fade") || t.includes("low") || t.includes("below"))
    return "text-fg-disabled";
  return "text-fg-muted";
}

// The actionable note for an "Adjust LA" flag: how far it went, the angle, and
// which way to correct — "needs loft" (too low) or "get on top" (too high).
function missNote(w: LiveWatchPlayer): string | null {
  if (w.reason !== "just_missed" || w.bestMissLa == null) return null;
  const angle = `${Math.round(w.bestMissLa)}°`;
  const far = w.bestMissDist != null ? `${Math.round(w.bestMissDist)} ft` : null;
  const advice =
    w.missDir === "low"
      ? "needs loft"
      : w.missDir === "high"
        ? "get on top"
        : "";
  return [far, angle, advice].filter(Boolean).join(" · ");
}

function WatchRow({
  w,
  game,
}: {
  w: LiveWatchPlayer;
  game: LiveHardHitGame | undefined;
}) {
  const tag = REASON_TAG[w.reason];
  const note = missNote(w);
  return (
    <tr
      className={`border-b border-border-subtle hover:bg-surface transition-colors ${
        w.reason === "barreled" ? "bg-neg-muted/30" : ""
      }`}
    >
      <td className="px-3 py-1.5">
        <PlayerLink id={w.batterId} name={w.batterName} teamAbbr={w.teamAbbr} />
      </td>
      <td className="px-2 py-1.5 text-left text-[11px]">
        <GameLink game={game} />
      </td>
      <td className="px-2 py-1.5">
        <span
          className={`rounded px-1 py-px text-[9px] font-medium uppercase ${tag.cls}`}
          title={tag.title}
        >
          {tag.label}
        </span>
        {note && (
          <span className="ml-1.5 text-[10px] text-fg-disabled">{note}</span>
        )}
      </td>
      <td className={`${NUM} font-semibold ${veloColor(w.maxEv)}`}>
        {dec(w.maxEv)}
      </td>
      <td
        className={`${NUM} text-fg-subtle`}
        title="Barrels / hard-hit balls this game"
      >
        {w.barrels}/{w.hardHit}
      </td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        {w.hrProb != null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="tabular-nums font-semibold text-fg">
              {Math.round(w.hrProb * 100)}%
            </span>
            {w.hrLift != null && (
              <span className="text-[10px] text-fg-disabled tabular-nums">
                {w.hrLift.toFixed(1)}x
              </span>
            )}
            {w.hrTier && (
              <span
                className={`rounded px-1 py-px text-[9px] font-medium uppercase ${tierClass(w.hrTier)}`}
              >
                {w.hrTier}
              </span>
            )}
          </span>
        ) : (
          <span className="text-fg-disabled text-[11px]">—</span>
        )}
      </td>
    </tr>
  );
}

function WatchPanel({
  rows,
  gameByPk,
}: {
  rows: LiveWatchPlayer[];
  gameByPk: Map<number, LiveHardHitGame>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-fg-muted">
        <thead>
          <tr className="text-fg-subtle border-b border-border">
            <th className="text-left px-3 py-1.5 font-medium">Batter</th>
            <th className="text-left px-2 py-1.5 font-medium">Game</th>
            <th className="text-left px-2 py-1.5 font-medium">Flag</th>
            <th className={NUM} title="Loudest exit velocity this game (mph)">
              Max EV
            </th>
            <th className={NUM} title="Barrels / hard-hit balls this game">
              Brl/HH
            </th>
            <th
              className="text-right px-2 py-1.5 font-medium"
              title="Pre-game model HR probability, lift vs league average, and tier — blended with the live contact"
            >
              HR Proj
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <WatchRow
              key={`${w.gamePk}-${w.batterId}`}
              w={w}
              game={gameByPk.get(w.gamePk)}
            />
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
  const { game } = useMlbFilters();
  const [data, setData] = useState<LiveHardHitResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

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

  // Shared game selection from the persistent MLB filter bar. A selected
  // game that isn't in today's live slate (e.g. it already ended) shows
  // everything rather than an empty board.
  const activeGame = game && gameByPk.has(game.gamePk) ? game.gamePk : null;
  const shownBalls = activeGame
    ? (data?.balls ?? []).filter((b) => b.gamePk === activeGame)
    : (data?.balls ?? []);
  const shownPitchers = activeGame
    ? (data?.pitchers ?? []).filter((p) => p.gamePk === activeGame)
    : (data?.pitchers ?? []);
  const shownWatch = activeGame
    ? (data?.watch ?? []).filter((w) => w.gamePk === activeGame)
    : (data?.watch ?? []);

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
          Players to Watch blends who is squaring the ball up right now with the
          pre-game model HR projection. Below it, every batted ball, one row per
          at-bat, updating every 30s — filter by game and click any column to
          sort. Sort <span className="text-fg-subtle">Time</span> for true
          most-recent-first across games (AB# is per-game). Default is exit
          velocity for HR-hunting; barrels are highlighted.
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
          {shownWatch.length > 0 && (
            <>
              <SectionHeader
                title={`Players to Watch — ${shownWatch.length}`}
                note="Hitting it hard now × pre-game HR projection. Barreled = squared up in the HR window; Adjust LA = hit it hard and far but the launch angle missed. Ranked by the model's HR probability."
              />
              <WatchPanel rows={shownWatch} gameByPk={gameByPk} />
            </>
          )}

          <SectionHeader
            title={`Hitting It Hard — ${shownBalls.length} batted ball${shownBalls.length === 1 ? "" : "s"}`}
            note="One row per at-bat. Barrel rows highlighted. Sort Time for most-recent-first across games."
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
