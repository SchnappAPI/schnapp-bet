"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  StreakMarket,
  StreakStateRow,
  StreaksResponse,
  StreakDistRow,
  StreakDistResponse,
} from "@/app/api/mlb-streaks/route";

// Streaks / Trends (/mlb/streaks). Player-specific conditional next-game
// frequencies for the current slate: given each batter's current run-state,
// how often the event followed from that exact state (k/N, denominator shown).
// Three scan lists — fade the hot at their ceiling, buy the overdue, ride the
// strong extenders — plus a per-player streak/drought curve drill-down.

const MARKETS: { key: StreakMarket; label: string }[] = [
  { key: "HR", label: "Home Run" },
  { key: "HIT", label: "Hits" },
  { key: "HRR2", label: "H+R+RBI ≥2" },
  { key: "HRR3", label: "H+R+RBI ≥3" },
  { key: "RBI", label: "RBI" },
];

const MIN_N = 3; // hide freq-based ranking below this denominator (too noisy)

function freqStr(hits: number | null, n: number | null): string {
  if (n == null || n === 0) return "—";
  return `${hits ?? 0}/${n} (${Math.round(((hits ?? 0) / n) * 100)}%)`;
}

function PlayerCurve({ batterId }: { batterId: number }) {
  const [data, setData] = useState<StreakDistResponse | null>(null);
  const [market, setMarket] = useState<StreakMarket>("HR");
  const [scope, setScope] = useState<"season" | "career">("season");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/mlb-streaks?batter=${batterId}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: StreakDistResponse) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [batterId]);

  const curve = useMemo(() => {
    const rows = (data?.dist ?? []).filter(
      (r) => r.market === market && r.scope === scope,
    );
    const streak = rows
      .filter((r) => r.stateType === "streak")
      .sort((a, b) => a.stateLen - b.stateLen);
    const drought = rows
      .filter((r) => r.stateType === "drought")
      .sort((a, b) => a.stateLen - b.stateLen);
    return { streak, drought };
  }, [data, market, scope]);

  if (!data)
    return <div className="px-3 py-2 text-xs text-fg-subtle">Loading…</div>;

  const CurveTable = ({
    title,
    rows,
    verb,
  }: {
    title: string;
    rows: StreakDistRow[];
    verb: string;
  }) => (
    <div className="min-w-[220px]">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-fg-disabled">No history</div>
      ) : (
        <table className="text-[11px] tabular-nums">
          <tbody>
            {rows.map((r) => (
              <tr key={r.stateLen} className="text-fg-muted">
                <td className="pr-2 text-fg-subtle">
                  {r.stateType === "streak" ? "at" : "after"} {r.stateLen}
                </td>
                <td className="pr-2">
                  {verb} {r.nEventNext}/{r.nReached}
                </td>
                <td
                  className={
                    r.freq >= 0.5
                      ? "text-pos font-semibold"
                      : "text-fg-disabled"
                  }
                >
                  {Math.round(r.freq * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="px-3 py-2 bg-surface border-t border-border-subtle">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {MARKETS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMarket(m.key)}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              market === m.key
                ? "bg-brand-muted text-brand"
                : "text-fg-subtle hover:text-fg"
            }`}
          >
            {m.label}
          </button>
        ))}
        <span className="mx-1 text-fg-disabled">·</span>
        {(["season", "career"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${
              scope === s
                ? "bg-surface-hover text-fg"
                : "text-fg-subtle hover:text-fg"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex gap-8 flex-wrap">
        <CurveTable
          title="Streak → extended next game"
          rows={curve.streak}
          verb="ext"
        />
        <CurveTable
          title="Drought → broke next game"
          rows={curve.drought}
          verb="broke"
        />
      </div>
    </div>
  );
}

function ListRow({ r }: { r: StreakStateRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className="border-b border-border-subtle hover:bg-surface cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-2 py-1.5 whitespace-nowrap">
          <Link
            href={`/mlb/player/${r.batterId}`}
            className="text-fg-muted hover:text-brand"
            onClick={(e) => e.stopPropagation()}
          >
            {r.batterName ?? String(r.batterId)}
          </Link>
          {r.teamAbbr && (
            <span className="text-fg-disabled ml-1 text-[10px]">
              {r.teamAbbr}
            </span>
          )}
        </td>
        <td className="px-2 py-1.5 text-fg-subtle whitespace-nowrap">
          {r.state === "streak"
            ? `${r.len}-game streak`
            : `${r.len}-game drought`}
          {r.state === "drought" && r.typicalGap != null && (
            <span className="text-fg-disabled text-[10px] ml-1">
              (usual {r.typicalGap})
            </span>
          )}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {freqStr(r.seasonHits, r.seasonN)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-fg-subtle">
          {freqStr(r.careerHits, r.careerN)}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="p-0">
            <PlayerCurve batterId={r.batterId} />
          </td>
        </tr>
      )}
    </>
  );
}

function ListCard({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: StreakStateRow[];
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
          {title}
        </div>
        <div className="text-[10px] text-fg-disabled mt-0.5">{hint}</div>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-4 text-xs text-fg-subtle">
          Nothing on today&apos;s slate.
        </div>
      ) : (
        <table className="w-full text-xs text-fg-muted">
          <thead>
            <tr className="text-fg-subtle border-b border-border text-[10px]">
              <th className="text-left px-2 py-1 font-medium">Batter</th>
              <th className="text-left px-2 py-1 font-medium">State</th>
              <th className="text-right px-2 py-1 font-medium">
                Next (season)
              </th>
              <th className="text-right px-2 py-1 font-medium">Career</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ListRow key={`${r.batterId}-${r.market}`} r={r} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function MlbStreaksBoard() {
  const [data, setData] = useState<StreaksResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);
  const [market, setMarket] = useState<StreakMarket>("HR");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/mlb-streaks`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: StreaksResponse) => {
        if (!cancelled) {
          setData(d);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErr(true);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const forMarket = useMemo(
    () => (data?.rows ?? []).filter((r) => r.market === market),
    [data, market],
  );

  const atCeiling = useMemo(
    () =>
      forMarket
        .filter((r) => r.state === "streak" && r.atCeiling)
        .sort((a, b) => b.len - a.len),
    [forMarket],
  );
  const overdue = useMemo(
    () =>
      forMarket
        .filter((r) => r.state === "drought" && r.phase === "late")
        .sort((a, b) => (b.careerFreq ?? 0) - (a.careerFreq ?? 0)),
    [forMarket],
  );
  const hotStreak = useMemo(
    () =>
      forMarket
        .filter(
          (r) =>
            r.state === "streak" && !r.atCeiling && (r.careerN ?? 0) >= MIN_N,
        )
        .sort((a, b) => (b.careerFreq ?? 0) - (a.careerFreq ?? 0)),
    [forMarket],
  );

  return (
    <div className="flex flex-col min-h-screen">
      <div className="px-3 py-3 border-b border-border">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg">
          MLB Streaks &amp; Trends
        </div>
        <div className="text-[11px] text-fg-disabled mt-0.5 max-w-2xl">
          For today&apos;s slate: each batter&apos;s current streak/drought and
          how often — from that exact state — the event happened the next game.
          Raw counts, player-specific. Click a row for their full curve. Context
          only, never in the projection.
        </div>
      </div>

      <div className="px-3 py-2 flex items-center gap-2 border-b border-border-subtle">
        {MARKETS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMarket(m.key)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              market === m.key
                ? "bg-brand-muted text-brand"
                : "text-fg-subtle hover:text-fg hover:bg-surface-hover"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <div className="px-4 py-6 text-sm text-fg-subtle">Loading…</div>
      ) : err ? (
        <div className="px-4 py-6 text-sm text-neg">
          Could not load streaks. Try again shortly.
        </div>
      ) : forMarket.length === 0 ? (
        <div className="px-4 py-10 text-sm text-fg-subtle">
          No streak data for today&apos;s slate yet. The nightly build writes it
          after the day&apos;s box scores land.
        </div>
      ) : (
        <div className="p-3 grid gap-3 lg:grid-cols-3">
          <ListCard
            title="At Ceiling — fade"
            hint="On a streak at their season high. Extending it is unprecedented for them."
            rows={atCeiling}
          />
          <ListCard
            title="Overdue — due"
            hint="Past their typical gap without the event. Breaks the next game at this rate."
            rows={overdue}
          />
          <ListCard
            title="Hot — strong extenders"
            hint="On a streak below their ceiling with a high historical extend rate."
            rows={hotStreak}
          />
        </div>
      )}
    </div>
  );
}
