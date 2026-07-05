"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  LeaderAtBat,
  LeaderHrHot,
  LeaderPitcher,
  LeadersResponse,
} from "@/app/api/mlb/research/leaders/route";
import { fmtHrParks, resultColor, resultLabel } from "./statcastFormat";

// Day-level "Top ..." leaderboard rails on the /mlb landing page (Savant
// Gamefeed format). Nightly grain: the API resolves the requested date
// down to the latest loaded day and the header labels that date — these
// rails never imply live. Every name links to the player page, where the
// prop research (log, splits, Statcast, BvP) lives.

function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function Rail({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border bg-surface px-3 py-2 min-w-[230px] flex-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">
        {title}
        {note && (
          <span className="ml-1 font-normal normal-case tracking-normal text-fg-disabled">
            {note}
          </span>
        )}
      </div>
      <table className="w-full text-xs text-fg-muted">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
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
    <td className="py-0.5 pr-2 whitespace-nowrap max-w-[130px] overflow-hidden text-ellipsis">
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

function AtBatRail({
  title,
  note,
  rows,
  value,
  unit,
  showResult = true,
}: {
  title: string;
  note?: string;
  rows: LeaderAtBat[];
  value: (r: LeaderAtBat) => string;
  unit: string;
  showResult?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <Rail title={title} note={note}>
      {rows.map((r, i) => (
        <tr key={`${r.gamePk}-${r.batterId}-${i}`}>
          <PlayerCell
            id={r.batterId}
            name={r.batterName}
            teamAbbr={r.teamAbbr}
          />
          <td className="py-0.5 px-1 text-right tabular-nums font-semibold whitespace-nowrap">
            {value(r)}
            <span className="text-fg-disabled font-normal ml-0.5 text-[10px]">
              {unit}
            </span>
          </td>
          {showResult && (
            <td
              className={`py-0.5 pl-2 text-right whitespace-nowrap text-[10px] ${resultColor(r.result)}`}
            >
              {resultLabel(r.result)}
            </td>
          )}
        </tr>
      ))}
    </Rail>
  );
}

function PitcherRail({
  title,
  rows,
  value,
  unit,
  context,
}: {
  title: string;
  rows: LeaderPitcher[];
  value: (r: LeaderPitcher) => string;
  unit: string;
  context?: (r: LeaderPitcher) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <Rail title={title}>
      {rows.map((r, i) => (
        <tr key={`${r.gamePk}-${r.pitcherId}-${i}`}>
          <PlayerCell
            id={r.pitcherId}
            name={r.pitcherName}
            teamAbbr={r.teamAbbr}
          />
          <td className="py-0.5 px-1 text-right tabular-nums font-semibold whitespace-nowrap">
            {value(r)}
            <span className="text-fg-disabled font-normal ml-0.5 text-[10px]">
              {unit}
            </span>
          </td>
          {context && (
            <td className="py-0.5 pl-2 text-right whitespace-nowrap text-[10px] text-fg-subtle">
              {context(r)}
            </td>
          )}
        </tr>
      ))}
    </Rail>
  );
}

function HrHotRail({ rows }: { rows: LeaderHrHot[] }) {
  if (rows.length === 0) return null;
  return (
    <Rail title="HR Hot Today" note="pattern window active">
      {rows.map((r) => (
        <tr key={r.batterId}>
          <PlayerCell
            id={r.batterId}
            name={r.batterName}
            teamAbbr={r.teamAbbr}
          />
          <td className="py-0.5 px-1 text-right tabular-nums font-semibold whitespace-nowrap">
            {r.patternHitRate != null
              ? `${Math.round(r.patternHitRate * 100)}%`
              : "-"}
            <span className="text-fg-disabled font-normal ml-0.5 text-[10px]">
              {r.patternRepeats != null && r.patternSamples != null
                ? `${r.patternRepeats}/${r.patternSamples}`
                : ""}
            </span>
          </td>
          <td className="py-0.5 pl-2 text-right whitespace-nowrap text-[10px] text-fg-subtle">
            {r.gamesSinceHr != null ? `${r.gamesSinceHr} since HR` : ""}
            {r.oppAbbr ? ` · vs ${r.oppAbbr}` : ""}
          </td>
        </tr>
      ))}
    </Rail>
  );
}

export default function MlbLeadersRails({ date }: { date: string }) {
  const [data, setData] = useState<LeadersResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/mlb/research/leaders?date=${date}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: LeadersResponse) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        // Rails are an enrichment — fail silently, the games list is the page.
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (!data || !data.resolvedDate) return null;
  const stale = data.resolvedDate !== data.date;

  return (
    <div className="px-4 pt-5 pb-4 border-t border-border mt-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-0.5">
        Statcast Leaders · {fmtShortDate(data.resolvedDate)}
      </div>
      <div className="text-[11px] text-fg-disabled mb-2.5">
        {stale
          ? `Latest loaded day — the nightly play-by-play load for ${fmtShortDate(data.date)} hasn't run yet.`
          : "From the nightly play-by-play load."}
      </div>
      <div className="flex flex-wrap gap-2.5">
        <HrHotRail rows={data.hrHotToday} />
        <AtBatRail
          title="Top Exit Velo"
          rows={data.topEv}
          value={(r) => (r.ev != null ? Number(r.ev).toFixed(1) : "-")}
          unit="mph"
        />
        <AtBatRail
          title="Top Distance"
          rows={data.topDist}
          value={(r) => (r.dist != null ? String(r.dist) : "-")}
          unit="ft"
        />
        <AtBatRail
          title="Top Bat Speed"
          rows={data.topBatSpeed}
          value={(r) =>
            r.batSpeed != null ? Number(r.batSpeed).toFixed(1) : "-"
          }
          unit="mph"
        />
        <AtBatRail
          title="HR Near-Misses"
          note="out here, gone elsewhere"
          rows={data.hrParkNearMiss}
          value={(r) => fmtHrParks(r.hrParks)}
          unit="parks"
        />
        <PitcherRail
          title="Top Pitch Velo"
          rows={data.topPitchVelo}
          value={(r) =>
            r.maxVelo != null ? Number(r.maxVelo).toFixed(1) : "-"
          }
          unit="mph"
        />
        <PitcherRail
          title="Most Whiffs"
          rows={data.topWhiffs}
          value={(r) => String(r.whiffs)}
          unit=""
          context={(r) => `${r.pitches} pitches`}
        />
      </div>
    </div>
  );
}
