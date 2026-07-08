"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  LiveHardHitBatter,
  LiveHardHitGame,
  LiveHardHitPitcher,
  LiveHardHitResponse,
} from "@/app/api/mlb-live-hardhit/route";
import { resultColor, resultLabel, veloColor } from "./statcastFormat";

// Standalone /mlb/live board: who is squaring the ball up right now (batters)
// and which pitchers are getting squared up, across every in-progress game.
// Polls /api/mlb-live-hardhit every 30s. Built for HR-hunting: batters are
// sorted by barrels (hard contact in the HR launch window) then top EV, and
// each hitter's LA + distance are from their hardest ball. EV/LA/distance are
// live from the MLB Gameday feed; the modeled Savant stats (true xBA, bat
// speed) settle in the nightly load. Every name links to the player page and
// every matchup links to the game.

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

const TH = "text-right px-2 py-1.5 font-medium whitespace-nowrap";
const TD = "text-right px-2 py-1.5 tabular-nums whitespace-nowrap";

function BatterTable({
  rows,
  gameByPk,
}: {
  rows: LiveHardHitBatter[];
  gameByPk: Map<number, LiveHardHitGame>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-fg-muted">
        <thead>
          <tr className="text-fg-subtle border-b border-border">
            <th className="text-left px-3 py-1.5 font-medium">Batter</th>
            <th className="text-left px-2 py-1.5 font-medium">Game</th>
            <th className={TH} title="Hardest ball's exit velocity">
              Max EV
            </th>
            <th className={TH} title="Launch angle of the hardest ball">
              LA
            </th>
            <th className={TH} title="Distance of the hardest ball">
              Dist
            </th>
            <th
              className={TH}
              title="Barrels — hard-hit in the HR launch window"
            >
              Brl
            </th>
            <th className={TH} title="Hard-hit balls (EV 95+)">
              HH
            </th>
            <th className={TH} title="Batted balls tracked">
              BBE
            </th>
            <th className="text-left px-2 py-1.5 font-medium">Last</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.gamePk}-${r.batterId}`}
              className={`border-b border-border-subtle hover:bg-surface transition-colors ${
                r.barrels > 0 ? "bg-neg-muted/40" : ""
              }`}
            >
              <td className="px-3 py-1.5">
                <PlayerLink
                  id={r.batterId}
                  name={r.batterName}
                  teamAbbr={r.teamAbbr}
                />
              </td>
              <td className="px-2 py-1.5 text-left text-[11px]">
                <GameLink game={gameByPk.get(r.gamePk)} />
              </td>
              <td className={`${TD} font-semibold ${veloColor(r.maxEv)}`}>
                {dec(r.maxEv)}
              </td>
              <td className={`${TD} text-fg-subtle`}>
                {r.maxEvLa != null ? `${Math.round(r.maxEvLa)}°` : "-"}
              </td>
              <td className={`${TD} text-fg-subtle`}>
                {r.maxEvDist != null ? Math.round(r.maxEvDist) : "-"}
              </td>
              <td
                className={`${TD} ${r.barrels > 0 ? "font-semibold text-neg" : "text-fg-disabled"}`}
              >
                {r.barrels}
              </td>
              <td
                className={`${TD} ${r.hardHit > 0 ? "text-warn" : "text-fg-disabled"}`}
              >
                {r.hardHit}
              </td>
              <td className={`${TD} text-fg-disabled`}>{r.bbe}</td>
              <td
                className={`px-2 py-1.5 text-left text-[11px] whitespace-nowrap ${resultColor(r.lastResult)}`}
              >
                {resultLabel(r.lastResult)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
            <th className={TH} title="Hard-hit balls allowed (EV 95+)">
              HH Allowed
            </th>
            <th className={TH}>Max EV</th>
            <th className={TH}>Avg EV</th>
            <th className={TH}>BBE</th>
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
                className={`${TD} ${r.hardHitAllowed > 0 ? "font-semibold text-warn" : "text-fg-disabled"}`}
              >
                {r.hardHitAllowed}
              </td>
              <td className={`${TD} ${veloColor(r.maxEvAllowed)}`}>
                {dec(r.maxEvAllowed)}
              </td>
              <td className={`${TD} text-fg-subtle`}>{dec(r.avgEvAllowed)}</td>
              <td className={`${TD} text-fg-disabled`}>{r.bbe}</td>
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
          Live batted-ball quality, updating every 30s — ranked by barrels (hard
          contact in the HR launch window) for HR-hunting. xBA and bat speed
          settle in the nightly load.
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
          <div className="px-3 pt-2 text-[11px] text-fg-disabled">
            {data!.games.length} live game
            {data!.games.length === 1 ? "" : "s"}:{" "}
            {data!.games
              .map(
                (g) =>
                  `${g.awayAbbr ?? "?"}@${g.homeAbbr ?? "?"}${g.label ? ` (${g.label})` : ""}`,
              )
              .join(" · ")}
          </div>

          <SectionHeader
            title={`Hitting It Hard — ${data!.batters.length} batters`}
            note="Barrel rows highlighted. LA + distance are from each hitter's hardest ball."
          />
          <BatterTable rows={data!.batters} gameByPk={gameByPk} />

          <SectionHeader
            title="Getting Squared Up"
            note="Pitchers allowing the most hard contact — their opposing hitters are locked in."
          />
          <PitcherTable rows={data!.pitchers} gameByPk={gameByPk} />
        </div>
      )}
    </div>
  );
}
