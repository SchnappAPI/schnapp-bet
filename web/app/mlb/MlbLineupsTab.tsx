"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

// Lineups tab for the MLB game page. One fetch of
// /api/mlb/game/[gamePk]/lineups per game; every toggle below
// (L5/L10/L20 window, vs-hand) is a pure client-side slice of the
// per-batter game rows that ride along in that response.

interface BatterGame {
  gamePk: number;
  gameDate: string;
  oppStarterHand: string | null;
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  tb: number;
}

interface Batter {
  playerId: number;
  playerName: string | null;
  batSide: string | null;
  position: string | null;
  battingOrder: number;
  games: BatterGame[];
}

interface Pitcher {
  playerId: number;
  name: string | null;
  hand: string | null;
  season: {
    era: number | null;
    whip: number | null;
    inningsPitched: number | null;
    strikeouts: number | null;
    kPer9: number | null;
    wins: number | null;
    losses: number | null;
    gamesStarted: number | null;
    avgAgainst: number | null;
    opsAgainst: number | null;
  } | null;
}

interface TeamLineup {
  teamId: number;
  teamAbbr: string;
  lineupStatus: "confirmed" | "projected" | "unavailable";
  pitcher: Pitcher | null;
  batters: Batter[];
}

interface LineupsResponse {
  gamePk: number;
  gameDate: string;
  gameStatus: string | null;
  away: TeamLineup;
  home: TeamLineup;
}

type WindowKey = "l5" | "l10" | "l20";
const WINDOW_OPTIONS: { key: WindowKey; label: string; n: number }[] = [
  { key: "l5", label: "L5", n: 5 },
  { key: "l10", label: "L10", n: 10 },
  { key: "l20", label: "L20", n: 20 },
];

interface WindowStats {
  gp: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  hr: number;
  rbi: number;
  kPct: number | null;
}

function computeWindowStats(
  games: BatterGame[],
  n: number,
  hand: string | null,
): WindowStats {
  const pool = hand
    ? games.filter((g) => g.oppStarterHand === hand)
    : games;
  const slice = pool.slice(0, n);
  const gp = slice.length;
  let pa = 0,
    ab = 0,
    h = 0,
    bb = 0,
    k = 0,
    tb = 0,
    hr = 0,
    rbi = 0;
  for (const g of slice) {
    pa += g.pa;
    ab += g.ab;
    h += g.h;
    bb += g.bb;
    k += g.k;
    tb += g.tb;
    hr += g.hr;
    rbi += g.rbi;
  }
  return {
    gp,
    avg: ab > 0 ? h / ab : null,
    obp: ab + bb > 0 ? (h + bb) / (ab + bb) : null,
    slg: ab > 0 ? tb / ab : null,
    hr,
    rbi,
    kPct: pa > 0 ? k / pa : null,
  };
}

function fmtAvg(val: number | null): string {
  if (val == null) return "-";
  return val.toFixed(3).replace(/^0/, "");
}

function fmtPct(val: number | null): string {
  if (val == null) return "-";
  return `${Math.round(val * 100)}%`;
}

function fmtIp(val: number | null): string {
  if (val == null) return "-";
  const whole = Math.floor(val);
  const outs = Math.round((val - whole) * 3);
  return outs === 0 ? `${whole}.0` : `${whole}.${outs}`;
}

function handLabel(hand: string | null): string {
  return hand === "L" ? "LHP" : hand === "R" ? "RHP" : "SP";
}

// Platoon edge: opposite-side batter, or a switch hitter, vs a known hand.
function hasPlatoonEdge(
  batSide: string | null,
  oppHand: string | null,
): boolean {
  if (!batSide || !oppHand) return false;
  return batSide === "S" || batSide !== oppHand;
}

function StatusChip({ status }: { status: TeamLineup["lineupStatus"] }) {
  if (status === "confirmed") {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-pos-muted text-pos">
        Confirmed
      </span>
    );
  }
  if (status === "projected") {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-warn-muted text-warn">
        Projected
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface text-fg-subtle">
      Unavailable
    </span>
  );
}

function PitcherCard({
  pitcher,
  label,
}: {
  pitcher: Pitcher | null;
  label: string;
}) {
  if (!pitcher || (!pitcher.name && !pitcher.playerId)) {
    return (
      <div className="text-xs text-fg-subtle mb-2">{label}: TBD</div>
    );
  }
  const s = pitcher.season;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
      <span className="text-sm font-semibold text-fg">
        {pitcher.name ?? "TBD"}
        {pitcher.hand && (
          <span className="ml-1.5 text-xs font-bold text-brand">
            ({pitcher.hand})
          </span>
        )}
      </span>
      {s && (
        <span className="text-xs text-fg-subtle tabular-nums">
          {s.wins != null && s.losses != null ? `${s.wins}-${s.losses}, ` : ""}
          {s.era != null ? `${Number(s.era).toFixed(2)} ERA` : ""}
          {s.whip != null ? ` · ${Number(s.whip).toFixed(2)} WHIP` : ""}
          {s.kPer9 != null ? ` · ${Number(s.kPer9).toFixed(1)} K/9` : ""}
          {s.inningsPitched != null ? ` · ${fmtIp(Number(s.inningsPitched))} IP` : ""}
        </span>
      )}
    </div>
  );
}

function LineupTable({
  team,
  oppPitcher,
  windowKey,
  vsHand,
}: {
  team: TeamLineup;
  oppPitcher: Pitcher | null;
  windowKey: WindowKey;
  vsHand: boolean;
}) {
  const n = WINDOW_OPTIONS.find((w) => w.key === windowKey)?.n ?? 10;
  const oppHand = oppPitcher?.hand ?? null;
  const activeHand = vsHand && oppHand ? oppHand : null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-semibold text-fg-subtle uppercase tracking-wider">
          {team.teamAbbr} Lineup
        </span>
        <StatusChip status={team.lineupStatus} />
        {activeHand && (
          <span className="text-[10px] text-fg-subtle">
            stats vs {handLabel(activeHand)}
          </span>
        )}
      </div>

      {team.batters.length === 0 ? (
        <div className="text-sm text-fg-subtle">
          No lineup information available yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-fg-muted">
            <thead>
              <tr className="text-fg-disabled border-b border-border">
                <th className="text-left pb-1 pr-3 font-normal">Batter</th>
                <th className="text-center pb-1 px-1.5 font-normal">Bats</th>
                <th className="text-center pb-1 px-1.5 font-normal">GP</th>
                <th className="text-center pb-1 px-1.5 font-normal">AVG</th>
                <th className="text-center pb-1 px-1.5 font-normal">OBP</th>
                <th className="text-center pb-1 px-1.5 font-normal">SLG</th>
                <th className="text-center pb-1 px-1.5 font-normal">HR</th>
                <th className="text-center pb-1 px-1.5 font-normal">RBI</th>
                <th className="text-center pb-1 px-1.5 font-normal">K%</th>
              </tr>
            </thead>
            <tbody>
              {team.batters.map((b) => {
                const stats = computeWindowStats(b.games, n, activeHand);
                const edge = hasPlatoonEdge(b.batSide, oppHand);
                const href = `/mlb/player/${b.playerId}?range=${windowKey}${
                  activeHand ? `&pitcherHand=${activeHand}` : ""
                }`;
                return (
                  <tr
                    key={b.playerId}
                    className="border-b border-border-subtle hover:bg-surface-hover"
                  >
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className="text-fg-disabled mr-1.5 tabular-nums">
                        {b.battingOrder}
                      </span>
                      <Link
                        href={href}
                        className="text-fg-muted hover:text-brand hover:underline"
                      >
                        {b.playerName ?? b.playerId}
                      </Link>
                      {b.position && (
                        <span className="text-fg-disabled ml-1.5">
                          {b.position}
                        </span>
                      )}
                    </td>
                    <td className="text-center py-1.5 px-1.5">
                      <span
                        className={
                          edge
                            ? "font-bold text-pos"
                            : "text-fg-subtle"
                        }
                        title={
                          edge ? "Platoon advantage vs probable SP" : undefined
                        }
                      >
                        {b.batSide ?? "-"}
                      </span>
                    </td>
                    <td
                      className={`text-center py-1.5 px-1.5 tabular-nums ${
                        stats.gp > 0 && stats.gp < 5
                          ? "text-warn"
                          : "text-fg-subtle"
                      }`}
                    >
                      {stats.gp}
                    </td>
                    <td className="text-center py-1.5 px-1.5 tabular-nums font-semibold text-fg">
                      {fmtAvg(stats.avg)}
                    </td>
                    <td className="text-center py-1.5 px-1.5 tabular-nums">
                      {fmtAvg(stats.obp)}
                    </td>
                    <td className="text-center py-1.5 px-1.5 tabular-nums">
                      {fmtAvg(stats.slg)}
                    </td>
                    <td
                      className={`text-center py-1.5 px-1.5 tabular-nums ${
                        stats.hr > 0 ? "text-warn font-semibold" : ""
                      }`}
                    >
                      {stats.hr}
                    </td>
                    <td className="text-center py-1.5 px-1.5 tabular-nums">
                      {stats.rbi}
                    </td>
                    <td className="text-center py-1.5 px-1.5 tabular-nums text-fg-subtle">
                      {fmtPct(stats.kPct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MlbLineupsTab({ gamePk }: { gamePk: number }) {
  const [data, setData] = useState<LineupsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>("l10");
  const [vsHand, setVsHand] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/mlb/game/${gamePk}/lineups`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [gamePk]);

  // Away batters face the HOME pitcher and vice versa.
  const anyHandKnown = useMemo(
    () =>
      Boolean(data?.home.pitcher?.hand) || Boolean(data?.away.pitcher?.hand),
    [data],
  );

  if (loading) {
    return <div className="text-sm text-fg-subtle">Loading lineups...</div>;
  }
  if (error) {
    return <div className="text-sm text-neg">Error: {error}</div>;
  }
  if (!data) return null;

  return (
    <div>
      {/* Probable pitchers */}
      <div className="mb-4">
        <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-1.5">
          Probable Pitchers
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-fg-disabled w-8">
              {data.away.teamAbbr}
            </span>
            <PitcherCard pitcher={data.away.pitcher} label="Away SP" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-fg-disabled w-8">
              {data.home.teamAbbr}
            </span>
            <PitcherCard pitcher={data.home.pitcher} label="Home SP" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex overflow-hidden rounded border border-border">
          {WINDOW_OPTIONS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWindowKey(w.key)}
              className={[
                "px-3 py-1 text-xs font-medium transition-colors",
                windowKey === w.key
                  ? "bg-brand text-fg"
                  : "bg-surface text-fg-subtle hover:bg-surface-hover",
              ].join(" ")}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setVsHand((v) => !v)}
          disabled={!anyHandKnown}
          className={[
            "px-3 py-1 text-xs font-medium rounded border transition-colors",
            vsHand && anyHandKnown
              ? "bg-brand text-fg border-brand"
              : "bg-surface text-fg-subtle border-border hover:bg-surface-hover",
            !anyHandKnown ? "opacity-50 cursor-not-allowed" : "",
          ].join(" ")}
          title={
            anyHandKnown
              ? "Limit each batter's window to games vs the probable SP's hand"
              : "Probable pitcher hand not yet known"
          }
        >
          vs SP hand
        </button>
        <span className="text-[11px] text-fg-disabled">
          Averages over each batter&apos;s last {windowKey.slice(1)} games
          {vsHand && anyHandKnown ? " vs that hand" : ""}. Click a batter for
          the full log.
        </span>
      </div>

      {/* Away lineup faces the home SP; home lineup faces the away SP. */}
      <LineupTable
        team={data.away}
        oppPitcher={data.home.pitcher}
        windowKey={windowKey}
        vsHand={vsHand}
      />
      <LineupTable
        team={data.home}
        oppPitcher={data.away.pitcher}
        windowKey={windowKey}
        vsHand={vsHand}
      />
    </div>
  );
}
