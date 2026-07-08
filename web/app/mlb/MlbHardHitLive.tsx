"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  LiveHardHitBatter,
  LiveHardHitPitcher,
  LiveHardHitResponse,
} from "@/app/api/mlb-live-hardhit/route";
import { resultColor, resultLabel, veloColor } from "./statcastFormat";

// Live "hard-hit" board on the /mlb landing page: who is squaring the ball up
// right now (batters) and which pitchers are getting squared up, across every
// in-progress game. Polls /api/mlb-live-hardhit every 30s while the slate has
// a live game. EV/LA come from the MLB Gameday feed within seconds of a play;
// the modeled Savant stats (true xBA, bat speed) settle in the nightly load,
// so this is labeled LIVE and sits above the settled Statcast Leaders rails.

const POLL_MS = 30_000;

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
    <div className="rounded border border-border bg-surface px-3 py-2 min-w-[250px] flex-1">
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

export default function MlbHardHitLive({
  date,
  active,
}: {
  date: string;
  active: boolean;
}) {
  const [data, setData] = useState<LiveHardHitResponse | null>(null);
  const savedActive = useRef(active);
  savedActive.current = active;

  useEffect(() => {
    let cancelled = false;
    setData(null);

    const load = () => {
      fetch(`/api/mlb-live-hardhit?date=${date}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d: LiveHardHitResponse) => {
          if (!cancelled) setData(d);
        })
        .catch(() => {
          // Live board is an enrichment — fail silently, the games list is the page.
        });
    };

    load();
    const id = active ? setInterval(load, POLL_MS) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [date, active]);

  if (!data || !data.live) return null;
  if (data.batters.length === 0 && data.pitchers.length === 0) return null;

  return (
    <div className="px-4 pt-5 pb-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-pos mb-0.5 flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-pos animate-pulse" />
        Hard-Hit · Live
        {data.asOf != null && (
          <span className="text-fg-disabled font-normal normal-case tracking-normal">
            as of {fmtClock(data.asOf)}
          </span>
        )}
      </div>
      <div className="text-[11px] text-fg-disabled mb-2.5">
        Exit velocity from the MLB Gameday feed across {data.games.length} live
        game{data.games.length === 1 ? "" : "s"}, updating every 30s. xBA and
        bat speed settle in tonight&apos;s load.
      </div>
      <div className="flex flex-wrap gap-2.5">
        <BatterRail rows={data.batters} />
        <PitcherRail rows={data.pitchers} />
      </div>
    </div>
  );
}
