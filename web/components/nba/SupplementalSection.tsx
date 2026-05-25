"use client";

import React, { useEffect, useState } from "react";

interface PropTarget {
  playerName: string;
  teamTricode: string;
  marketLabel: string;
  outcomeName: string;
  line: number;
  price: number | null;
  hitRatePct: number | null;
  oppHitRatePct: number | null;
  sampleSize: number;
  compositeGrade: number | null;
}

interface Scenario {
  label: string;
  probability: number;
  description: string;
  propsAffected: string[];
}

interface PairLeg {
  playerName: string;
  marketLabel: string;
  line: number;
  price: number | null;
  hitRatePct: number | null;
  direction: string;
}

interface CorrelatedPair {
  rank: number;
  label: string;
  jointProbability: number;
  reasoning: string;
  legs: PairLeg[];
}

interface BreakoutCandidate {
  playerName: string;
  teamTricode: string;
  reasoning: string;
  targetMarket: string;
  targetLine: number | null;
  targetPrice: number | null;
}

interface AvoidItem {
  playerName: string;
  marketLabel: string;
  line: number;
  reasoning: string;
}

interface RosterPlayer {
  playerName: string;
  avgMin: number;
  avgPts: number;
  avgReb: number;
  avgAst: number;
  avg3pm: number;
  avgStl: number;
  avgBlk: number;
  games: number;
  isStarter: boolean;
}

interface TeamRoster {
  tricode: string;
  players: RosterPlayer[];
}

interface SupplementalPayload {
  scenarios: Scenario[];
  correlatedPairs: CorrelatedPair[];
  breakoutCandidates: BreakoutCandidate[];
  avoidList: AvoidItem[];
  propTargets: PropTarget[];
  rosterAnalysis: { away: TeamRoster; home: TeamRoster };
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return "-";
  return price > 0 ? `+${price}` : String(price);
}

function evPctColor(evPct: number | null): string {
  if (evPct == null) return "text-fg-subtle";
  if (evPct > 8) return "text-pos";
  if (evPct >= 0) return "text-warn";
  return "text-fg-subtle";
}

function SectionHeader({
  children,
  sub,
}: {
  children: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        {children}
      </h3>
      {sub && <span className="text-xs text-fg-disabled">{sub}</span>}
    </div>
  );
}

function ScenariosSection({ scenarios }: { scenarios: Scenario[] }) {
  if (!scenarios?.length) return null;
  return (
    <section>
      <SectionHeader>Game Scenarios</SectionHeader>
      <div className="space-y-3">
        {scenarios.map((s, i) => (
          <div key={i} className="border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-fg-muted">
                {s.label}
              </span>
              <span className="text-xs font-semibold text-brand">
                {s.probability}%
              </span>
            </div>
            <p className="text-xs text-fg-subtle leading-relaxed">
              {s.description}
            </p>
            {s.propsAffected?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {s.propsAffected.map((name, j) => (
                  <span
                    key={j}
                    className="text-xs bg-surface-hover text-fg-subtle rounded px-1.5 py-0.5"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function CorrelatedPairsSection({ pairs }: { pairs: CorrelatedPair[] }) {
  if (!pairs?.length) return null;
  return (
    <section>
      <SectionHeader>Correlated Pairs</SectionHeader>
      <div className="space-y-3">
        {pairs.map((pair, i) => (
          <div key={i} className="border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-disabled font-medium">
                  #{pair.rank}
                </span>
                <span className="text-sm font-medium text-fg-muted">
                  {pair.label}
                </span>
              </div>
              <span className="text-xs font-semibold text-pos">
                ~{pair.jointProbability}% joint
              </span>
            </div>
            <div className="flex gap-2 mb-2">
              {pair.legs?.map((leg, j) => (
                <div key={j} className="flex-1 bg-surface rounded p-2">
                  <div className="text-xs font-medium text-fg-muted truncate">
                    {leg.playerName}
                  </div>
                  <div className="text-xs text-fg-subtle">
                    {leg.direction} {leg.marketLabel} {leg.line}{" "}
                    <span className="text-fg-disabled">
                      {formatPrice(leg.price)}
                    </span>
                  </div>
                  {leg.hitRatePct != null && (
                    <div className="text-xs text-brand mt-0.5">
                      {leg.hitRatePct}% hit rate
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-fg-subtle leading-relaxed">
              {pair.reasoning}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PropTargetsSection({
  targets,
  evPctLookup,
}: {
  targets: PropTarget[];
  evPctLookup: Map<string, number | null>;
}) {
  if (!targets?.length) {
    return (
      <section>
        <SectionHeader>Prop Targets</SectionHeader>
        <p className="text-xs text-fg-disabled">
          No targets meeting the threshold for this game.
        </p>
      </section>
    );
  }
  const sorted = [...targets].sort((a, b) => {
    const ea = evPctLookup.get(`${a.playerName}|${a.line}`) ?? null;
    const eb = evPctLookup.get(`${b.playerName}|${b.line}`) ?? null;
    if (ea == null && eb == null) return 0;
    if (ea == null) return 1;
    if (eb == null) return -1;
    return eb - ea;
  });
  return (
    <section>
      <SectionHeader sub="hit% >= 60, price -300 to +300, n >= 15">
        Prop Targets
      </SectionHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-fg-disabled border-b border-border">
              <th className="pb-2 pr-3 font-medium">Player</th>
              <th className="pb-2 pr-2 font-medium">Mkt</th>
              <th className="pb-2 pr-2 font-medium text-right">Line</th>
              <th className="pb-2 pr-2 font-medium text-right">Price</th>
              <th className="pb-2 pr-2 font-medium text-right">Hit%</th>
              <th className="pb-2 pr-2 font-medium text-right">Opp%</th>
              <th className="pb-2 pr-2 font-medium text-right">n</th>
              <th className="pb-2 font-medium text-right">EV%</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const evPct =
                evPctLookup.get(`${t.playerName}|${t.line}`) ?? null;
              return (
                <tr
                  key={i}
                  className="border-b border-border-subtle hover:bg-surface-hover"
                >
                  <td className="py-2 pr-3">
                    <span className="text-fg-muted">{t.playerName}</span>
                    <span className="ml-1.5 text-fg-disabled">
                      {t.teamTricode}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-fg-subtle">{t.marketLabel}</td>
                  <td className="py-2 pr-2 text-right text-fg-muted">
                    {t.line}
                  </td>
                  <td className="py-2 pr-2 text-right text-fg-subtle">
                    {formatPrice(t.price)}
                  </td>
                  <td className="py-2 pr-2 text-right text-fg">
                    {t.hitRatePct != null ? `${t.hitRatePct}%` : "-"}
                  </td>
                  <td className="py-2 pr-2 text-right text-fg-subtle">
                    {t.oppHitRatePct != null ? `${t.oppHitRatePct}%` : "-"}
                  </td>
                  <td className="py-2 pr-2 text-right text-fg-disabled">
                    {t.sampleSize}
                  </td>
                  <td
                    className={`py-2 text-right font-medium ${evPctColor(evPct)}`}
                  >
                    {evPct != null
                      ? `${evPct > 0 ? "+" : ""}${evPct.toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BreakoutSection({ candidates }: { candidates: BreakoutCandidate[] }) {
  if (!candidates?.length) return null;
  return (
    <section>
      <SectionHeader>Breakout Candidates</SectionHeader>
      <div className="space-y-2">
        {candidates.map((c, i) => (
          <div key={i} className="border border-border rounded-lg p-3">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div>
                <span className="text-sm font-medium text-fg-muted">
                  {c.playerName}
                </span>
                <span className="ml-1.5 text-xs text-fg-disabled">
                  {c.teamTricode}
                </span>
              </div>
              {c.targetMarket && c.targetLine != null && (
                <div className="text-right shrink-0">
                  <span className="text-xs text-warn font-medium">
                    {c.targetMarket} {c.targetLine}
                  </span>
                  {c.targetPrice != null && (
                    <span className="ml-1 text-xs text-fg-disabled">
                      {formatPrice(c.targetPrice)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-fg-subtle leading-relaxed">
              {c.reasoning}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AvoidSection({ items }: { items: AvoidItem[] }) {
  if (!items?.length) return null;
  return (
    <section>
      <SectionHeader>Avoid</SectionHeader>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="border border-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-fg-subtle">
                {item.playerName}
              </span>
              <span className="text-xs text-fg-disabled">
                {item.marketLabel} {item.line}
              </span>
            </div>
            <p className="text-xs text-fg-disabled leading-relaxed">
              {item.reasoning}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RosterSection({ roster }: { roster: TeamRoster }) {
  const starters = roster.players.filter((p) => p.isStarter);
  const bench = roster.players.filter((p) => !p.isStarter);

  const renderGroup = (players: RosterPlayer[], label: string) => {
    if (!players.length) return null;
    return (
      <div className="mb-3">
        <p className="text-xs text-fg-disabled uppercase tracking-wider mb-1.5">
          {label}
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-fg-disabled border-b border-border-subtle">
              <th className="pb-1 pr-2 font-medium">Player</th>
              <th className="pb-1 pr-1 font-medium text-right">MIN</th>
              <th className="pb-1 pr-1 font-medium text-right">PTS</th>
              <th className="pb-1 pr-1 font-medium text-right">REB</th>
              <th className="pb-1 pr-1 font-medium text-right">AST</th>
              <th className="pb-1 pr-1 font-medium text-right">3PM</th>
              <th className="pb-1 font-medium text-right text-fg-disabled">
                G
              </th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr key={i} className="border-b border-border-subtle">
                <td className="py-1.5 pr-2 text-fg-muted">{p.playerName}</td>
                <td className="py-1.5 pr-1 text-right text-fg-subtle">
                  {p.avgMin}
                </td>
                <td className="py-1.5 pr-1 text-right text-fg-muted">
                  {p.avgPts}
                </td>
                <td className="py-1.5 pr-1 text-right text-fg-subtle">
                  {p.avgReb}
                </td>
                <td className="py-1.5 pr-1 text-right text-fg-subtle">
                  {p.avgAst}
                </td>
                <td className="py-1.5 pr-1 text-right text-fg-subtle">
                  {p.avg3pm}
                </td>
                <td className="py-1.5 text-right text-fg-disabled">
                  {p.games}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      <p className="text-xs font-semibold text-fg-subtle mb-2">
        {roster.tricode}
      </p>
      {renderGroup(starters, "Rotation")}
      {renderGroup(bench, "Bench")}
    </div>
  );
}

interface Props {
  gameId: string;
  selectedDate: string;
}

export default function SupplementalSection({ gameId, selectedDate }: Props) {
  const [payload, setPayload] = useState<SupplementalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evPctLookup, setEvPctLookup] = useState<Map<string, number | null>>(
    new Map(),
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/game-supplemental?gameId=${gameId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setPayload(data.payload ?? null))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [gameId]);

  useEffect(() => {
    fetch(`/api/grades?date=${selectedDate}&gameId=${gameId}`)
      .then((r) => (r.ok ? r.json() : { grades: [] }))
      .then((data) => {
        const map = new Map<string, number | null>();
        for (const g of data.grades ?? []) {
          map.set(`${g.playerName}|${g.lineValue}`, g.evPct ?? null);
        }
        setEvPctLookup(map);
      })
      .catch(() => {});
  }, [gameId, selectedDate]);

  if (loading) {
    return <div className="py-6 text-sm text-fg-subtle">Loading...</div>;
  }
  if (error) {
    return <div className="py-6 text-sm text-neg">Error: {error}</div>;
  }
  if (!payload) {
    return (
      <div className="py-6 text-sm text-fg-subtle">
        Supplemental data not yet generated. Run Refresh Data from the admin
        page to populate it.
      </div>
    );
  }

  return (
    <div className="space-y-7 pb-8 px-4 py-4">
      <ScenariosSection scenarios={payload.scenarios} />
      <CorrelatedPairsSection pairs={payload.correlatedPairs} />
      <PropTargetsSection
        targets={payload.propTargets}
        evPctLookup={evPctLookup}
      />
      <BreakoutSection candidates={payload.breakoutCandidates} />
      <AvoidSection items={payload.avoidList} />

      <section>
        <SectionHeader sub="last 60 days, reg season">
          Roster Analysis
        </SectionHeader>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <RosterSection roster={payload.rosterAnalysis.away} />
          <RosterSection roster={payload.rosterAnalysis.home} />
        </div>
      </section>
    </div>
  );
}
