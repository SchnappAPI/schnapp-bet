"use client";

import { useEffect, useState } from "react";
import MlbLineupsTab from "./MlbLineupsTab";
import MlbMatchupsTab from "./MlbMatchupsTab";
import { fmtHrParks, fmtXba, resultColor, resultLabel } from "./statcastFormat";
import { StatcastChips, StatcastLegend } from "./StatcastChips";
import { isFinalStatus, isLiveStatus } from "./gameStatus";
import HeatCell from "@/components/HeatCell";

interface MlbGame {
  gameId: number;
  awayTeamId: number;
  homeTeamId: number;
  awayTeamAbbr: string;
  homeTeamAbbr: string;
  awayScore: number | null;
  homeScore: number | null;
  gameStatus: string | null;
  awayPitcher: string | null;
  homePitcher: string | null;
  liveLabel?: string | null;
}

interface Batter {
  playerId: number;
  playerName: string;
  teamId: number;
  side: string;
  position: string | null;
  battingOrder: number | null;
  ab: number | null;
  r: number | null;
  h: number | null;
  doubles: number | null;
  triples: number | null;
  hr: number | null;
  rbi: number | null;
  bb: number | null;
  k: number | null;
  sb: number | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
}

interface Pitcher {
  playerId: number;
  playerName: string;
  teamId: number;
  side: string;
  note: string | null;
  ip: number | null;
  h: number | null;
  r: number | null;
  er: number | null;
  bb: number | null;
  k: number | null;
  hr: number | null;
  era: number | null;
  pitches: number | null;
  strikes: number | null;
}

interface InningLine {
  inning: number;
  isTop: boolean;
  runs: number;
}

interface Summary {
  runs: number;
  hits: number;
}

interface AtBat {
  atBatNumber: number;
  inning: number;
  isTop: boolean;
  batterId: number;
  batterName: string;
  pitcherId: number;
  pitcherName: string;
  resultType: string | null;
  resultDesc: string | null;
  rbi: number | null;
  exitVelo: number | null;
  launchAngle: number | null;
  distance: number | null;
  trajectory: string | null;
  hardness: string | null;
  hitProb: number | null;
  batSpeed: number | null;
  hrBallparks: number | null;
  awayTeamId: number;
  homeTeamId: number;
}

type TabKey = "lineups" | "matchups" | "boxscore" | "exitvelo";

function fmt(val: number | null, decimals = 0): string {
  if (val == null) return "-";
  return decimals > 0 ? val.toFixed(decimals) : String(val);
}

function fmtAvg(val: number | null): string {
  if (val == null) return "-";
  return val.toFixed(3).replace(/^0/, "");
}

function fmtIp(val: number | null): string {
  if (val == null) return "-";
  const whole = Math.floor(val);
  const frac = val - whole;
  const outs = Math.round(frac * 3);
  return outs === 0 ? `${whole}.0` : `${whole}.${outs}`;
}

// ---------------------------------------------------------------------------
// Linescore
// ---------------------------------------------------------------------------

function Linescore({
  innings,
  summary,
  awayAbbr,
  homeAbbr,
  awayScore,
  homeScore,
}: {
  innings: InningLine[];
  summary: Record<string, Summary>;
  awayAbbr: string;
  homeAbbr: string;
  awayScore: number | null;
  homeScore: number | null;
}) {
  const maxInning = Math.max(...innings.map((i) => i.inning), 9);
  const inningNums = Array.from({ length: maxInning }, (_, i) => i + 1);

  function getScore(isTop: boolean, inning: number): string {
    const row = innings.find((i) => i.inning === inning && i.isTop === isTop);
    return row != null ? String(row.runs) : "-";
  }

  const awayR = summary["A"]?.runs ?? awayScore ?? 0;
  const homeR = summary["H"]?.runs ?? homeScore ?? 0;
  const awayH = summary["A"]?.hits ?? null;
  const homeH = summary["H"]?.hits ?? null;

  return (
    <div className="overflow-x-auto mb-5">
      <table className="text-xs text-center text-fg-muted">
        <thead>
          <tr className="text-fg-subtle border-b border-border">
            <th className="text-left pr-4 pb-1 font-normal w-12"></th>
            {inningNums.map((n) => (
              <th key={n} className="w-7 pb-1 font-normal">
                {n}
              </th>
            ))}
            <th className="pl-3 pb-1 font-semibold">R</th>
            <th className="pl-2 pb-1 font-normal">H</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border-subtle">
            <td className="text-left pr-4 py-1.5 font-semibold text-fg-muted">
              {awayAbbr}
            </td>
            {inningNums.map((n) => (
              <td key={n} className="py-1.5">
                {getScore(true, n)}
              </td>
            ))}
            <td
              className={`pl-3 py-1.5 font-bold ${awayR > homeR ? "text-fg" : "text-fg-subtle"}`}
            >
              {awayR}
            </td>
            <td className="pl-2 py-1.5 text-fg-subtle">
              {awayH != null ? awayH : "-"}
            </td>
          </tr>
          <tr>
            <td className="text-left pr-4 py-1.5 font-semibold text-fg-muted">
              {homeAbbr}
            </td>
            {inningNums.map((n) => (
              <td key={n} className="py-1.5">
                {getScore(false, n)}
              </td>
            ))}
            <td
              className={`pl-3 py-1.5 font-bold ${homeR > awayR ? "text-fg" : "text-fg-subtle"}`}
            >
              {homeR}
            </td>
            <td className="pl-2 py-1.5 text-fg-subtle">
              {homeH != null ? homeH : "-"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batter table
// ---------------------------------------------------------------------------

function BatterTable({
  batters,
  teamAbbr,
}: {
  batters: Batter[];
  teamAbbr: string;
}) {
  if (batters.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-1.5">
        {teamAbbr} Batting
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-fg-muted">
          <thead>
            <tr className="text-fg-disabled border-b border-border">
              <th className="text-left pb-1 pr-3 font-normal">Batter</th>
              <th className="text-center pb-1 px-1.5 font-normal">AB</th>
              <th className="text-center pb-1 px-1.5 font-normal">R</th>
              <th className="text-center pb-1 px-1.5 font-normal">H</th>
              <th className="text-center pb-1 px-1.5 font-normal">2B</th>
              <th className="text-center pb-1 px-1.5 font-normal">3B</th>
              <th className="text-center pb-1 px-1.5 font-normal">HR</th>
              <th className="text-center pb-1 px-1.5 font-normal">RBI</th>
              <th className="text-center pb-1 px-1.5 font-normal">BB</th>
              <th className="text-center pb-1 px-1.5 font-normal">K</th>
              <th className="text-center pb-1 px-1.5 font-normal">SB</th>
              <th className="text-center pb-1 px-1.5 font-normal">AVG</th>
              <th className="text-center pb-1 px-1.5 font-normal">OBP</th>
              <th className="text-center pb-1 px-1.5 font-normal">SLG</th>
              <th className="text-center pb-1 px-1.5 font-normal">OPS</th>
            </tr>
          </thead>
          <tbody>
            {batters.map((b, idx) => {
              const isSubstitute =
                idx > 0 &&
                b.battingOrder !== null &&
                batters[idx - 1].battingOrder !== null &&
                Math.floor((b.battingOrder ?? 0) / 100) ===
                  Math.floor((batters[idx - 1].battingOrder ?? 0) / 100) &&
                b.battingOrder !== batters[idx - 1].battingOrder;
              return (
                <tr
                  key={b.playerId}
                  className={`border-b border-border-subtle ${
                    (b.h ?? 0) > 0 ? "bg-pos-muted" : ""
                  }`}
                >
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {isSubstitute && (
                      <span className="text-fg-disabled mr-1">+</span>
                    )}
                    <span className="text-fg-disabled mr-1 text-xs">
                      {b.battingOrder != null
                        ? Math.floor(b.battingOrder / 100)
                        : ""}
                    </span>
                    <span
                      className={
                        isSubstitute ? "text-fg-subtle" : "text-fg-muted"
                      }
                    >
                      {b.playerName}
                    </span>
                    {b.position && (
                      <span className="text-fg-disabled ml-1">
                        {b.position}
                      </span>
                    )}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {fmt(b.ab)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {fmt(b.r)}
                  </td>
                  <td
                    className={`text-center py-1 px-1.5 tabular-nums font-semibold ${
                      (b.h ?? 0) > 0 ? "text-fg" : "text-fg-subtle"
                    }`}
                  >
                    {fmt(b.h)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {fmt(b.doubles)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {fmt(b.triples)}
                  </td>
                  <td
                    className={`text-center py-1 px-1.5 tabular-nums ${
                      (b.hr ?? 0) > 0 ? "text-warn font-semibold" : ""
                    }`}
                  >
                    {fmt(b.hr)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {fmt(b.rbi)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {fmt(b.bb)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {fmt(b.k)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums">
                    {fmt(b.sb)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                    {fmtAvg(b.avg)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                    {fmtAvg(b.obp)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                    {fmtAvg(b.slg)}
                  </td>
                  <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                    {fmtAvg(b.ops)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pitcher table
// ---------------------------------------------------------------------------

function PitcherTable({
  pitchers,
  teamAbbr,
}: {
  pitchers: Pitcher[];
  teamAbbr: string;
}) {
  if (pitchers.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-1.5">
        {teamAbbr} Pitching
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-fg-muted">
          <thead>
            <tr className="text-fg-disabled border-b border-border">
              <th className="text-left pb-1 pr-3 font-normal">Pitcher</th>
              <th className="text-center pb-1 px-1.5 font-normal">IP</th>
              <th className="text-center pb-1 px-1.5 font-normal">H</th>
              <th className="text-center pb-1 px-1.5 font-normal">R</th>
              <th className="text-center pb-1 px-1.5 font-normal">ER</th>
              <th className="text-center pb-1 px-1.5 font-normal">BB</th>
              <th className="text-center pb-1 px-1.5 font-normal">K</th>
              <th className="text-center pb-1 px-1.5 font-normal">HR</th>
              <th className="text-center pb-1 px-1.5 font-normal">ERA</th>
              <th className="text-center pb-1 px-1.5 font-normal">P-S</th>
            </tr>
          </thead>
          <tbody>
            {pitchers.map((p) => (
              <tr key={p.playerId} className="border-b border-border-subtle">
                <td className="py-1 pr-3 whitespace-nowrap">
                  <span
                    className={
                      p.note === "SP" ? "text-fg-muted" : "text-fg-subtle"
                    }
                  >
                    {p.playerName}
                  </span>
                  {p.note === "SP" && (
                    <span className="text-fg-disabled ml-1 text-xs">SP</span>
                  )}
                </td>
                <td className="text-center py-1 px-1.5 tabular-nums">
                  {fmtIp(p.ip)}
                </td>
                <td className="text-center py-1 px-1.5 tabular-nums">
                  {fmt(p.h)}
                </td>
                <td className="text-center py-1 px-1.5 tabular-nums">
                  {fmt(p.r)}
                </td>
                <td className="text-center py-1 px-1.5 tabular-nums">
                  {fmt(p.er)}
                </td>
                <td className="text-center py-1 px-1.5 tabular-nums">
                  {fmt(p.bb)}
                </td>
                <td className="text-center py-1 px-1.5 tabular-nums">
                  {fmt(p.k)}
                </td>
                <td
                  className={`text-center py-1 px-1.5 tabular-nums ${
                    (p.hr ?? 0) > 0 ? "text-warn" : ""
                  }`}
                >
                  {fmt(p.hr)}
                </td>
                <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                  {fmt(p.era, 2)}
                </td>
                <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                  {p.pitches != null ? `${p.pitches}-${p.strikes ?? "-"}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exit velo table
// ---------------------------------------------------------------------------

function ExitVeloTable({
  atBats,
  teamId,
  teamAbbr,
  awayTeamId,
}: {
  atBats: AtBat[];
  teamId: number;
  teamAbbr: string;
  awayTeamId: number;
}) {
  // Batters from this team are in the opposing half-inning
  // isTop=true means away team is batting; isTop=false means home team batting
  const isAway = teamId === awayTeamId;
  const teamAtBats = atBats.filter((ab) => (isAway ? ab.isTop : !ab.isTop));

  // Only show plate appearances with ball-in-play data
  const withData = teamAtBats.filter(
    (ab) => ab.exitVelo != null || ab.resultType != null,
  );

  if (withData.length === 0) return null;

  // Percentile heat shading within this team's at-bats (shared scale with
  // /mlb/research — web/lib/colorScale.ts).
  const evVals = withData.map((ab) => ab.exitVelo);
  const laVals = withData.map((ab) => ab.launchAngle);
  const distVals = withData.map((ab) => ab.distance);
  const xbaVals = withData.map((ab) => ab.hitProb);
  const batSpeedVals = withData.map((ab) => ab.batSpeed);
  const hrParksVals = withData.map((ab) => ab.hrBallparks);

  return (
    <div className="mb-5">
      <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-1.5">
        {teamAbbr} At-Bats
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-fg-muted">
          <thead>
            <tr className="text-fg-disabled border-b border-border">
              <th className="text-left pb-1 pr-3 font-normal">Batter</th>
              <th className="text-left pb-1 pr-3 font-normal">Pitcher</th>
              <th className="text-center pb-1 px-1.5 font-normal">Inn</th>
              <th className="text-left pb-1 px-1.5 font-normal">Result</th>
              <th className="text-center pb-1 px-1.5 font-normal">EV</th>
              <th className="text-center pb-1 px-1.5 font-normal">LA</th>
              <th className="text-center pb-1 px-1.5 font-normal">Dist</th>
              <th className="text-center pb-1 px-1.5 font-normal">xBA</th>
              <th className="text-center pb-1 px-1.5 font-normal">Bat Spd</th>
              <th className="text-center pb-1 px-1.5 font-normal">HR/Pk</th>
            </tr>
          </thead>
          <tbody>
            {withData.map((ab) => (
              <tr
                key={ab.atBatNumber}
                className="border-b border-border-subtle"
              >
                <td className="py-1 pr-3 whitespace-nowrap text-fg-muted">
                  {ab.batterName}
                </td>
                <td className="py-1 pr-3 whitespace-nowrap text-fg-subtle">
                  {ab.pitcherName}
                </td>
                <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                  {ab.inning}
                </td>
                <td
                  className={`py-1 px-1.5 whitespace-nowrap ${resultColor(ab.resultType)}`}
                >
                  {resultLabel(ab.resultType)}
                  <StatcastChips
                    ev={ab.exitVelo}
                    la={ab.launchAngle}
                    batSpeed={ab.batSpeed}
                  />
                </td>
                <HeatCell
                  value={ab.exitVelo}
                  values={evVals}
                  format={(v) => v.toFixed(1)}
                  className="font-semibold"
                />
                <HeatCell
                  value={ab.launchAngle}
                  values={laVals}
                  format={String}
                />
                <HeatCell
                  value={ab.distance}
                  values={distVals}
                  format={String}
                />
                <HeatCell value={ab.hitProb} values={xbaVals} format={fmtXba} />
                <HeatCell
                  value={ab.batSpeed}
                  values={batSpeedVals}
                  format={(v) => v.toFixed(1)}
                />
                <HeatCell
                  value={ab.hrBallparks}
                  values={hrParksVals}
                  format={fmtHrParks}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MlbGameTabs({ game }: { game: MlbGame }) {
  // Pregame the lineups are the story; final games open on the box score.
  const [activeTab, setActiveTab] = useState<TabKey>(() =>
    game.gameStatus === "F" || game.gameStatus === "Final"
      ? "boxscore"
      : "lineups",
  );
  const [batters, setBatters] = useState<Batter[]>([]);
  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [innings, setInnings] = useState<InningLine[]>([]);
  const [summary, setSummary] = useState<Record<string, Summary>>({});
  const [hasPbp, setHasPbp] = useState(false);
  const [atBats, setAtBats] = useState<AtBat[]>([]);
  const [atBatSource, setAtBatSource] = useState<string>("db");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isLive = isLiveStatus(game.gameStatus);

  useEffect(() => {
    let cancelled = false;

    function load(silent: boolean) {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      const j = (r: Response) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      };
      Promise.all([
        fetch(`/api/mlb-boxscore?gamePk=${game.gameId}`).then(j),
        fetch(`/api/mlb-linescore?gamePk=${game.gameId}`).then(j),
        fetch(`/api/mlb-atbats?gamePk=${game.gameId}`).then(j),
      ])
        .then(([boxData, lineData, atBatData]) => {
          if (cancelled) return;
          setBatters(boxData.batters ?? []);
          setPitchers(boxData.pitchers ?? []);
          setInnings(lineData.innings ?? []);
          setSummary(lineData.summary ?? {});
          setHasPbp(lineData.hasPbp ?? false);
          setAtBats(atBatData.atBats ?? []);
          setAtBatSource(atBatData.source ?? "db");
        })
        .catch((err) => {
          if (!cancelled && !silent) setError(err.message);
        })
        .finally(() => {
          if (!cancelled && !silent) setLoading(false);
        });
    }

    load(false);
    // While live, the linescore route serves statsapi innings — track them.
    const id = isLive ? setInterval(() => load(true), 30_000) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [game.gameId, isLive]);

  const isFinal = isFinalStatus(game.gameStatus);

  const awayBatters = batters.filter((b) => b.side === "A");
  const homeBatters = batters.filter((b) => b.side === "H");
  const awayPitchers = pitchers.filter((p) => p.side === "A");
  const homePitchers = pitchers.filter((p) => p.side === "H");

  // Status-keyed tab set (Savant's codedGameState swap, adapted): pregame
  // is the research surface (Lineups + Matchups — stat tabs would be
  // empty); finals are the review surface (Box Score + Exit Velo); live
  // keeps all stat tabs while the linescore tracks the overlay.
  const tabs: { key: TabKey; label: string }[] = isFinal
    ? [
        { key: "boxscore", label: "Box Score" },
        { key: "exitvelo", label: "Exit Velo" },
      ]
    : isLive
      ? [
          { key: "lineups", label: "Lineups" },
          { key: "boxscore", label: "Box Score" },
          { key: "exitvelo", label: "Exit Velo" },
        ]
      : [
          { key: "lineups", label: "Lineups" },
          { key: "matchups", label: "Matchups" },
        ];
  // If a status flip (repoll) drops the active tab, fall back to the set's
  // first tab rather than rendering nothing.
  const shownTab = tabs.some((t) => t.key === activeTab)
    ? activeTab
    : tabs[0].key;

  return (
    <div className="py-4">
      {/* Score header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold text-fg">
              {game.awayTeamAbbr}
            </span>
            {(isFinal || isLive) && game.awayScore != null && (
              <span
                className={`text-2xl font-bold tabular-nums ${
                  isFinal && game.awayScore > (game.homeScore ?? 0)
                    ? "text-fg"
                    : "text-fg-subtle"
                }`}
              >
                {game.awayScore}
              </span>
            )}
          </div>
          {game.awayPitcher && (
            <div className="text-xs text-fg-subtle mt-0.5">
              {game.awayPitcher}
            </div>
          )}
        </div>
        <div
          className={`text-xs pt-2 ${isLive ? "text-pos font-medium" : "text-fg-subtle"}`}
        >
          {isFinal
            ? "Final"
            : isLive
              ? (game.liveLabel ?? game.gameStatus ?? "")
              : (game.gameStatus ?? "")}
        </div>
        <div className="text-right">
          <div className="flex items-center gap-3 justify-end">
            {(isFinal || isLive) && game.homeScore != null && (
              <span
                className={`text-2xl font-bold tabular-nums ${
                  isFinal && game.homeScore > (game.awayScore ?? 0)
                    ? "text-fg"
                    : "text-fg-subtle"
                }`}
              >
                {game.homeScore}
              </span>
            )}
            <span className="text-lg font-semibold text-fg">
              {game.homeTeamAbbr}
            </span>
          </div>
          {game.homePitcher && (
            <div className="text-xs text-fg-subtle mt-0.5 text-right">
              {game.homePitcher}
            </div>
          )}
        </div>
      </div>

      {loading && <div className="text-sm text-fg-subtle">Loading...</div>}
      {error && <div className="text-sm text-neg">Error: {error}</div>}

      {!loading && !error && (
        <>
          {/* Linescore — pbp-derived after the nightly load, statsapi live
              innings while the game is in progress. */}
          {innings.length > 0 && (
            <Linescore
              innings={innings}
              summary={summary}
              awayAbbr={game.awayTeamAbbr}
              homeAbbr={game.homeTeamAbbr}
              awayScore={game.awayScore}
              homeScore={game.homeScore}
            />
          )}

          {/* Tabs render regardless of box-score availability so pregame
              games surface the Lineups tab instead of an empty page. */}
          <div className="flex gap-1 mb-4 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={[
                  "px-4 py-2 text-sm font-medium transition-colors",
                  shownTab === t.key
                    ? "text-fg border-b-2 border-brand -mb-px"
                    : "text-fg-subtle hover:text-fg-muted",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </div>

          {shownTab === "lineups" && <MlbLineupsTab gamePk={game.gameId} />}

          {shownTab === "matchups" && <MlbMatchupsTab gamePk={game.gameId} />}

          {shownTab === "boxscore" &&
            (batters.length === 0 ? (
              <div className="text-sm text-fg-subtle">
                Box score not yet available for this game.
              </div>
            ) : (
              <>
                <BatterTable
                  batters={awayBatters}
                  teamAbbr={game.awayTeamAbbr}
                />
                <BatterTable
                  batters={homeBatters}
                  teamAbbr={game.homeTeamAbbr}
                />
                <PitcherTable
                  pitchers={awayPitchers}
                  teamAbbr={game.awayTeamAbbr}
                />
                <PitcherTable
                  pitchers={homePitchers}
                  teamAbbr={game.homeTeamAbbr}
                />
              </>
            ))}

          {shownTab === "exitvelo" &&
            (atBats.length === 0 ? (
              <div className="text-sm text-fg-subtle">
                {isLive
                  ? "Waiting for the first tracked batted ball — live exit velocity appears here within seconds of contact."
                  : "Exit velocity data not yet available for this game. It loads after the game finishes, in the nightly play-by-play run."}
              </div>
            ) : (
              <>
                {atBatSource === "live" && (
                  <div className="mb-3 flex items-center gap-1.5 text-[11px] text-pos">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-pos" />
                    Live from the MLB Gameday feed — EV/LA update every 30s. xBA
                    and bat speed settle in tonight&apos;s load.
                  </div>
                )}
                <StatcastLegend className="mb-3" />
                <ExitVeloTable
                  atBats={atBats}
                  teamId={game.awayTeamId}
                  teamAbbr={game.awayTeamAbbr}
                  awayTeamId={game.awayTeamId}
                />
                <ExitVeloTable
                  atBats={atBats}
                  teamId={game.homeTeamId}
                  teamAbbr={game.homeTeamAbbr}
                  awayTeamId={game.awayTeamId}
                />
              </>
            ))}
        </>
      )}
    </div>
  );
}
