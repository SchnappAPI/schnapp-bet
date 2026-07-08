"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  LiveHardHitBatter,
  LiveHardHitPitcher,
  LiveHardHitResponse,
} from "@/app/api/mlb-live-hardhit/route";
import { resultColor, resultLabel, veloColor } from "./statcastFormat";

// Standalone /mlb/live board: who is squaring the ball up right now (batters)
// and which pitchers are getting squared up, across every in-progress game.
// Polls /api/mlb-live-hardhit every 30s. EV/LA come from the MLB Gameday feed
// within seconds of a play; the modeled Savant stats (true xBA, bat speed)
// settle in the nightly load, so this is labeled LIVE and lives on its own
// page (linked from the sidebar) rather than buried under the games list.

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

function PlayerCell({
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
    <td className="py-0.5 pr-2 whitespace-nowrap max-w-[140px] overflow-hidden text-ellipsis">
      {id != null ? (
        <Link
          href={`/mlb/player/${id}`}
          className="hover:text-brand transition-colors"
        >
          {label}
        </Link>
      ) : (
        label
      )}
      {teamAbbr && (
        <span className="text-fg-disabled ml-1 text-[10px]">{teamAbbr}</span>
      )}
    </td>
  );
}

function Rail({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border bg-surface px-3 py-2 min-w-[260px] flex-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">
        {title}
      </div>
      <table className="w-full text-xs text-fg-muted">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function BatterRail({ rows }: { rows: LiveHardHitBatter[] }) {
  if (rows.length === 0) return null;
  return (
    <Rail title="Hitting It Hard">
      {rows.map((r) => (
        <tr key={`${r.gamePk}-${r.batterId}`}>
          <PlayerCell
            id={r.batterId}
            name={r.batterName}
            teamAbbr={r.teamAbbr}
          />
          <td
            className={`py-0.5 px-1 text-right tabular-nums font-semibold whitespace-nowrap ${veloColor(
              r.maxEv,
            )}`}
          >
            {r.maxEv != null ? Number(r.maxEv).toFixed(1) : "-"}
            <span className="text-fg-disabled font-normal ml-0.5 text-[10px]">
              mph
            </span>
          </td>
          <td className="py-0.5 pl-2 text-right whitespace-nowrap text-[10px] text-fg-subtle">
            {r.hardHit > 0 ? `${r.hardHit} hard` : `${r.bbe} bbe`}
            {r.lastResult ? (
              <span className={`ml-1 ${resultColor(r.lastResult)}`}>
                {resultLabel(r.lastResult)}
              </span>
            ) : null}
          </td>
        </tr>
      ))}
    </Rail>
  );
}

function PitcherRail({ rows }: { rows: LiveHardHitPitcher[] }) {
  if (rows.length === 0) return null;
  return (
    <Rail title="Getting Squared Up">
      {rows.map((r) => (
        <tr key={`${r.gamePk}-${r.pitcherId}`}>
          <PlayerCell
            id={r.pitcherId}
            name={r.pitcherName}
            teamAbbr={r.teamAbbr}
          />
          <td className="py-0.5 px-1 text-right tabular-nums font-semibold whitespace-nowrap">
            {r.hardHitAllowed}
            <span className="text-fg-disabled font-normal ml-0.5 text-[10px]">
              hard
            </span>
          </td>
          <td className="py-0.5 pl-2 text-right whitespace-nowrap text-[10px] text-fg-subtle">
            {r.avgEvAllowed != null
              ? `${Number(r.avgEvAllowed).toFixed(1)} avg`
              : ""}
            {r.bbe ? ` · ${r.bbe} bbe` : ""}
          </td>
        </tr>
      ))}
    </Rail>
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

  const hasRows =
    !!data?.live && (data.batters.length > 0 || data.pitchers.length > 0);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="px-4 py-3 border-b border-border">
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
          Exit velocity from the MLB Gameday feed, updating every 30s. xBA and
          bat speed settle in the nightly load.
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
        <div className="px-4 py-4">
          <div className="text-[11px] text-fg-disabled mb-2.5">
            {data!.games.length} live game
            {data!.games.length === 1 ? "" : "s"}:{" "}
            {data!.games
              .map(
                (g) =>
                  `${g.awayAbbr ?? "?"}@${g.homeAbbr ?? "?"}${g.label ? ` (${g.label})` : ""}`,
              )
              .join(" · ")}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <BatterRail rows={data!.batters} />
            <PitcherRail rows={data!.pitchers} />
          </div>
        </div>
      )}
    </div>
  );
}
