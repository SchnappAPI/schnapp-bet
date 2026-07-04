'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import HeatCell from '@/components/HeatCell';
import { fmtXba } from './statcastFormat';

interface MlbGame {
  gameId: number;
  awayTeamId: number;
  homeTeamId: number;
  awayTeamAbbr: string;
  homeTeamAbbr: string;
  gameStatus: string | null;
}

interface StarterRow {
  playerId: number;
  playerName: string;
  teamId: number;
  side: 'A' | 'H';
  position: string | null;
  bats: string | null;
  battingOrder: number | null;
  projected: boolean;
}

interface EvSummaryRow {
  playerId: number;
  bbe: number;
  avgEv: number | null;
  maxEv: number | null;
  hardHitPct: number | null;
  avgLa: number | null;
  sweetSpotPct: number | null;
  barrelPct: number | null;
  hrCount: number;
  avgXba: number | null;
}

interface EvAtBatRow {
  playerId: number;
  gamePk: number;
  gameDate: string;
  inning: number;
  pitcherId: number;
  pitcherName: string | null;
  resultType: string | null;
  exitVelo: number | null;
  launchAngle: number | null;
  distance: number | null;
  hitProb: number | null;
}

interface EvResponse {
  gamePk: number;
  awayTeamId: number;
  homeTeamId: number;
  seasonYear: number;
  awayProjected: boolean;
  homeProjected: boolean;
  starters: StarterRow[];
  summary: EvSummaryRow[];
  atBats: EvAtBatRow[];
}

function fmt1(v: number | null): string {
  if (v == null) return '-';
  return v.toFixed(1);
}

function fmtPct(v: number | null): string {
  if (v == null) return '-';
  return `${Math.round(v * 100)}%`;
}

function evTextColor(v: number | null): string {
  if (v == null) return 'text-fg-subtle';
  if (v >= 100) return 'text-neg';
  if (v >= 95) return 'text-warn';
  return 'text-fg-muted';
}

function resultColor(resultType: string | null): string {
  if (!resultType) return 'text-fg-subtle';
  const t = resultType.toLowerCase();
  if (t.includes('home_run')) return 'text-warn';
  if (t.includes('hit') || t === 'single' || t === 'double' || t === 'triple') return 'text-pos';
  if (t.includes('strikeout')) return 'text-neg';
  return 'text-fg-subtle';
}

function resultLabel(resultType: string | null): string {
  if (!resultType) return '-';
  return resultType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtShortDate(iso: string): string {
  // game_date comes back from SQL as a UTC-midnight ISO. Shift to avoid
  // the timezone-to-previous-day problem.
  const d = new Date(iso);
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${m}/${day}`;
}

function TeamTable({
  sideLabel,
  starters,
  summaryByPlayer,
  columnValues,
  atBatsByPlayer,
  expandedId,
  onToggle,
  projected,
}: {
  sideLabel: string;
  starters: StarterRow[];
  summaryByPlayer: Map<number, EvSummaryRow>;
  columnValues: Map<string, (number | null | undefined)[]>;
  atBatsByPlayer: Map<number, EvAtBatRow[]>;
  expandedId: number | null;
  onToggle: (playerId: number) => void;
  projected: boolean;
}) {
  if (starters.length === 0) {
    return (
      <div className="mb-5">
        <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-1.5">
          {sideLabel}
        </div>
        <div className="text-sm text-fg-subtle">No starters available.</div>
      </div>
    );
  }
  return (
    <div className="mb-5">
      <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-1.5 flex items-center gap-2">
        <span>{sideLabel}</span>
        {projected && (
          <span className="text-[10px] font-normal normal-case tracking-normal text-amber-500/70">
            Projected lineup
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-fg-muted">
          <thead>
            <tr className="text-fg-disabled border-b border-border">
              <th className="text-left pb-1 pr-3 font-normal">Batter</th>
              <th className="text-center pb-1 px-1.5 font-normal">BBE</th>
              <th className="text-center pb-1 px-1.5 font-normal">Avg EV</th>
              <th className="text-center pb-1 px-1.5 font-normal">Max EV</th>
              <th className="text-center pb-1 px-1.5 font-normal">Hard%</th>
              <th className="text-center pb-1 px-1.5 font-normal">Avg LA</th>
              <th className="text-center pb-1 px-1.5 font-normal">Sweet%</th>
              <th className="text-center pb-1 px-1.5 font-normal">Barrel%</th>
              <th className="text-center pb-1 px-1.5 font-normal">HR</th>
              <th className="text-center pb-1 px-1.5 font-normal">xBA</th>
            </tr>
          </thead>
          <tbody>
            {starters.map((s) => {
              const sum = summaryByPlayer.get(s.playerId);
              const bbe = sum?.bbe ?? 0;
              const isExpanded = expandedId === s.playerId;
              const detail = atBatsByPlayer.get(s.playerId) ?? [];
              const slot = s.battingOrder != null ? Math.floor(s.battingOrder / 100) : '';
              const dim = bbe === 0;
              return (
                <Fragment key={s.playerId}>
                  <tr
                    onClick={() => bbe > 0 && onToggle(s.playerId)}
                    className={[
                      'border-b border-border-subtle',
                      bbe > 0 ? 'cursor-pointer hover:bg-surface-hover' : '',
                      isExpanded ? 'bg-surface-hover' : '',
                    ].join(' ')}
                  >
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <span className="text-fg-disabled mr-1 text-xs">{slot}</span>
                      <span className={dim ? 'text-fg-subtle' : 'text-fg-muted'}>{s.playerName}</span>
                      {s.bats && (
                        <span className="text-fg-disabled ml-1 text-[10px]">
                          {s.bats}
                        </span>
                      )}
                      {s.position && <span className="text-fg-disabled ml-1">{s.position}</span>}
                    </td>
                    <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">{bbe}</td>
                    <HeatCell value={sum?.avgEv} values={columnValues.get('avgEv') ?? []} format={(v) => v.toFixed(1)} />
                    <HeatCell value={sum?.maxEv} values={columnValues.get('maxEv') ?? []} format={(v) => v.toFixed(1)} />
                    <HeatCell value={sum?.hardHitPct} values={columnValues.get('hardHitPct') ?? []} format={(v) => `${Math.round(v * 100)}%`} />
                    <HeatCell value={sum?.avgLa} values={columnValues.get('avgLa') ?? []} format={(v) => v.toFixed(1)} />
                    <HeatCell value={sum?.sweetSpotPct} values={columnValues.get('sweetSpotPct') ?? []} format={(v) => `${Math.round(v * 100)}%`} />
                    <HeatCell value={sum?.barrelPct} values={columnValues.get('barrelPct') ?? []} format={(v) => `${Math.round(v * 100)}%`} />
                    <HeatCell value={sum?.hrCount ?? 0} values={columnValues.get('hrCount') ?? []} format={String} />
                    <HeatCell value={sum?.avgXba} values={columnValues.get('avgXba') ?? []} format={fmtXba} />
                  </tr>
                  {isExpanded && detail.length > 0 && (
                    <tr className="bg-canvas border-b border-border-subtle">
                      <td colSpan={10} className="py-2 px-3">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-fg-muted">
                            <thead>
                              <tr className="text-fg-disabled border-b border-border">
                                <th className="text-left pb-1 pr-3 font-normal">Date</th>
                                <th className="text-left pb-1 pr-3 font-normal">Pitcher</th>
                                <th className="text-center pb-1 px-1.5 font-normal">Inn</th>
                                <th className="text-left pb-1 px-1.5 font-normal">Result</th>
                                <th className="text-center pb-1 px-1.5 font-normal">EV</th>
                                <th className="text-center pb-1 px-1.5 font-normal">LA</th>
                                <th className="text-center pb-1 px-1.5 font-normal">Dist</th>
                                <th className="text-center pb-1 px-1.5 font-normal">xBA</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.map((ab, i) => (
                                <tr key={`${ab.gamePk}-${i}`} className="border-b border-border-subtle">
                                  <td className="py-1 pr-3 whitespace-nowrap text-fg-subtle">
                                    {fmtShortDate(ab.gameDate)}
                                  </td>
                                  <td className="py-1 pr-3 whitespace-nowrap text-fg-subtle">
                                    {ab.pitcherName ?? '-'}
                                  </td>
                                  <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">{ab.inning}</td>
                                  <td className={`py-1 px-1.5 whitespace-nowrap ${resultColor(ab.resultType)}`}>
                                    {resultLabel(ab.resultType)}
                                  </td>
                                  <td className={`text-center py-1 px-1.5 tabular-nums font-semibold ${evTextColor(ab.exitVelo)}`}>
                                    {fmt1(ab.exitVelo)}
                                  </td>
                                  <td className="text-center py-1 px-1.5 tabular-nums">
                                    {ab.launchAngle != null ? ab.launchAngle : '-'}
                                  </td>
                                  <td className="text-center py-1 px-1.5 tabular-nums">
                                    {ab.distance != null ? ab.distance : '-'}
                                  </td>
                                  <td className="text-center py-1 px-1.5 tabular-nums text-fg-subtle">
                                    {fmtXba(ab.hitProb)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MlbEvView({ game }: { game: MlbGame }) {
  const [data, setData] = useState<EvResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setExpandedId(null);
    fetch(`/api/mlb-ev?gamePk=${game.gameId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: EvResponse) => setData(d))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [game.gameId]);

  const summaryByPlayer = useMemo(() => {
    const m = new Map<number, EvSummaryRow>();
    for (const s of data?.summary ?? []) m.set(s.playerId, s);
    return m;
  }, [data]);

  const columnValues = useMemo(() => {
    const m = new Map<string, (number | null | undefined)[]>();
    const rows = data?.summary ?? [];
    m.set('avgEv', rows.map((r) => r.avgEv));
    m.set('maxEv', rows.map((r) => r.maxEv));
    m.set('hardHitPct', rows.map((r) => r.hardHitPct));
    m.set('avgLa', rows.map((r) => r.avgLa));
    m.set('sweetSpotPct', rows.map((r) => r.sweetSpotPct));
    m.set('barrelPct', rows.map((r) => r.barrelPct));
    m.set('hrCount', rows.map((r) => r.hrCount));
    m.set('avgXba', rows.map((r) => r.avgXba));
    return m;
  }, [data]);

  const atBatsByPlayer = useMemo(() => {
    const m = new Map<number, EvAtBatRow[]>();
    for (const ab of data?.atBats ?? []) {
      const arr = m.get(ab.playerId);
      if (arr) arr.push(ab);
      else m.set(ab.playerId, [ab]);
    }
    return m;
  }, [data]);

  if (loading) return <div className="py-6 text-sm text-fg-subtle">Loading...</div>;
  if (error) return <div className="py-6 text-sm text-neg">Error: {error}</div>;
  if (!data) return null;

  const awayStarters = data.starters.filter((s) => s.side === 'A');
  const homeStarters = data.starters.filter((s) => s.side === 'H');

  const totalBatters = data.starters.length;
  const totalBbe = data.summary.reduce((acc, s) => acc + s.bbe, 0);

  return (
    <div className="py-4">
      <div className="mb-4">
        <div className="text-sm text-fg-muted">
          Exit velocity, {data.seasonYear} season to date
        </div>
        <div className="text-xs text-fg-subtle mt-0.5">
          {totalBatters} batters, {totalBbe} tracked batted-ball events. Excludes this game. Tap a row for per-at-bat detail.
        </div>
      </div>

      <TeamTable
        sideLabel={`${game.awayTeamAbbr} Batters`}
        starters={awayStarters}
        summaryByPlayer={summaryByPlayer}
        columnValues={columnValues}
        atBatsByPlayer={atBatsByPlayer}
        expandedId={expandedId}
        onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
        projected={data.awayProjected}
      />
      <TeamTable
        sideLabel={`${game.homeTeamAbbr} Batters`}
        starters={homeStarters}
        summaryByPlayer={summaryByPlayer}
        columnValues={columnValues}
        atBatsByPlayer={atBatsByPlayer}
        expandedId={expandedId}
        onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
        projected={data.homeProjected}
      />
    </div>
  );
}
