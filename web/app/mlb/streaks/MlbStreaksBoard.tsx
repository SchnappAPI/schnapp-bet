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
import { useMlbFilters } from "@/components/mlb/MlbFilterProvider";
import type { CanonicalMarket } from "@/lib/mlbFilters";

// Maps the shared-bar canonical market onto this board's local StreakMarket.
// The shared bar only exposes a single "HRR" pill; the board still needs to
// remember which sub-variant (>=2 or >=3) was last chosen, so `current` is
// passed through and preserved when the family is HRR.
function streakMarketFrom(
  m: CanonicalMarket,
  current: StreakMarket,
): StreakMarket {
  if (m === "HR") return "HR";
  if (m === "HITS") return "HIT";
  if (m === "HRR") return current === "HRR3" ? "HRR3" : "HRR2";
  return current;
}

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

// Compact tag for the current streak. HR on a 1-game streak (homered last game)
// is the classic back-to-back setup, so it reads "B2B"; everything else is
// "{len}G" (on a len-game streak). The frequency beside it is how often the
// player EXTENDED from exactly this length.
function streakTag(market: StreakMarket, len: number): string {
  if (market === "HR" && len === 1) return "B2B";
  return `${len}G`;
}

function ListRow({ r }: { r: StreakStateRow }) {
  const [open, setOpen] = useState(false);
  const tag = streakTag(r.market, r.len);
  // Career headline (more samples = stabler); season on hover.
  const careerPct =
    r.careerN && r.careerN > 0 ? Math.round((r.careerFreq ?? 0) * 100) : null;
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
        <td className="px-2 py-1.5 whitespace-nowrap">
          <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-semibold text-fg-subtle">
            {tag}
          </span>
          <span
            className={`ml-2 tabular-nums ${careerPct != null && careerPct >= 40 ? "text-pos font-semibold" : "text-fg-muted"}`}
            title={`Career: extended a ${r.len}-game streak ${r.careerHits ?? 0} of ${r.careerN ?? 0} times. This season: ${freqStr(r.seasonHits, r.seasonN)}.`}
          >
            {careerPct == null
              ? "no history"
              : `${r.careerHits}/${r.careerN} (${careerPct}%)`}
          </span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={2} className="p-0">
            <PlayerCurve batterId={r.batterId} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function MlbStreaksBoard() {
  const [data, setData] = useState<StreaksResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);
  // HRR2/HRR3 sub-choice, independent of the shared market pill so it
  // survives switching the shared pill away from HRR and back (previously
  // this lived inside a local `market` useState driven by an effect off
  // ctxMarket, which both flashed on hydration and reset HRR3 -> HRR2).
  const [hrrSub, setHrrSub] = useState<"HRR2" | "HRR3">("HRR2");
  const { date: ctxDate, market: ctxMarket, game } = useMlbFilters();

  const market = useMemo(
    () => streakMarketFrom(ctxMarket, hrrSub),
    [ctxMarket, hrrSub],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/mlb-streaks?date=${ctxDate}`, { cache: "no-store" })
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
  }, [ctxDate]);

  const forMarket = useMemo(
    () => (data?.rows ?? []).filter((r) => r.market === market),
    [data, market],
  );

  // Players currently ON a streak of the event (homered/hit in consecutive
  // games), for today's slate — anyone who homered yesterday shows here as a
  // B2B setup. Ranked by how often they've extended from this length (career).
  // Confidence-weighted rank: a 1/1 (100%) must not outrank a 21/99 (21%) on a
  // single sample, so damp the rate by sample size (full weight at n>=10). The
  // displayed number stays the raw k/n so the denominator is always honest.
  const onStreak = useMemo(() => {
    const key = (r: StreakStateRow) =>
      (r.careerFreq ?? 0) * Math.min(1, (r.careerN ?? 0) / 10);
    return forMarket
      .filter((r) => r.state === "streak" && r.len >= 1)
      .sort((a, b) => key(b) - key(a) || b.len - a.len);
  }, [forMarket]);

  // Client-side GAME filter from the shared bar — restrict to the two teams
  // in the selected matchup. Applied AFTER the confidence-weighted sort above
  // so relative rank among the kept rows is unaffected.
  const shownRows = useMemo(
    () =>
      onStreak.filter(
        (r) =>
          !game || r.teamAbbr === game.awayAbbr || r.teamAbbr === game.homeAbbr,
      ),
    [onStreak, game],
  );

  return (
    <div className="flex flex-col min-h-screen">
      <div className="px-3 py-3 border-b border-border">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg">
          MLB Streaks &amp; Trends
        </div>
        <div className="text-[11px] text-fg-disabled mt-0.5 max-w-2xl">
          Every batter on today&apos;s slate riding an active streak for this
          market — anyone who homered yesterday is here as a B2B setup. The
          number is how often they&apos;ve extended from exactly this streak
          length (career; hover for season). Click a row for their full curve.
        </div>
      </div>

      {(market === "HRR2" || market === "HRR3") && (
        <div className="px-3 py-2 flex items-center gap-2 border-b border-border-subtle">
          <span className="text-[10px] uppercase tracking-wide text-fg-subtle">
            H+R+RBI
          </span>
          {(["HRR2", "HRR3"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setHrrSub(k)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                market === k
                  ? "bg-brand-muted text-brand"
                  : "text-fg-subtle hover:text-fg hover:bg-surface-hover"
              }`}
            >
              {k === "HRR2" ? "≥2" : "≥3"}
            </button>
          ))}
        </div>
      )}

      {!loaded ? (
        <div className="px-4 py-6 text-sm text-fg-subtle">Loading…</div>
      ) : err ? (
        <div className="px-4 py-6 text-sm text-neg">
          Could not load streaks. Try again shortly.
        </div>
      ) : shownRows.length === 0 ? (
        <div className="px-4 py-10 text-sm text-fg-subtle">
          No batters on an active {market} streak in today&apos;s slate.
        </div>
      ) : (
        <div className="overflow-x-auto p-3">
          <table className="w-full max-w-xl text-xs text-fg-muted">
            <thead>
              <tr className="text-fg-subtle border-b border-border text-[10px]">
                <th className="text-left px-2 py-1 font-medium">Batter</th>
                <th className="text-left px-2 py-1 font-medium">
                  Streak · extend rate
                </th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((r) => (
                <ListRow key={`${r.batterId}-${r.market}`} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
