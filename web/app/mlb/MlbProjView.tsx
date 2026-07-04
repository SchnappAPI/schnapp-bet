'use client';

import { useEffect, useState } from 'react';
import { heatColorFor } from '@/lib/colorScale';

interface MlbGame {
  gameId: number;
  gameDate: string;
  awayTeamAbbr: string;
  homeTeamAbbr: string;
  awayPitcher: string | null;
  homePitcher: string | null;
}

interface TierLine {
  market_key: string;
  composite_grade: number | null;
  safe_line: number | null; safe_prob: number | null; safe_price: number | null;
  value_line: number | null; value_prob: number | null; value_price: number | null;
  highrisk_line: number | null; highrisk_prob: number | null; highrisk_price: number | null;
  lotto_line: number | null; lotto_prob: number | null; lotto_price: number | null;
}

interface BatterRow {
  playerId: number;
  playerName: string | null;
  battingOrder: number;
  position: string | null;
  handCode: string | null;
  oppPitcherHand: string | null;
  trend: {
    w10_pa: number | null; w10_hit_rate: number | null; w10_tb_per_pa: number | null;
    w10_home_runs: number | null; w10_avg_ev: number | null; w10_hard_hit_pct: number | null;
    w10_barrel_pct: number | null; w10_avg_xba: number | null; w10_k_rate: number | null;
    w30_pa: number | null; w30_hit_rate: number | null; w30_tb_per_pa: number | null;
    w30_home_runs: number | null; w30_avg_ev: number | null; w30_hard_hit_pct: number | null;
    w30_barrel_pct: number | null; w30_avg_xba: number | null; w30_k_rate: number | null;
    w60_pa: number | null; w60_hit_rate: number | null; w60_tb_per_pa: number | null;
    vs_lhp_pa: number | null; vs_lhp_hit_rate: number | null;
    vs_rhp_pa: number | null; vs_rhp_hit_rate: number | null;
    home_pa: number | null; home_hit_rate: number | null;
    away_pa: number | null; away_hit_rate: number | null;
  } | null;
  bvp: {
    plate_appearances: number; hits: number; home_runs: number;
    strikeouts: number; batting_avg: number | null; ops: number | null;
  } | null;
  tierLines: TierLine[];
}

interface PitcherStats {
  era: number | null; k_per_9: number | null; bb_per_9: number | null;
  h_per_9: number | null; whip: number | null; ops_against: number | null;
}

interface ProjData {
  gamePk: number; gameDate: string;
  awayAbbr: string; homeAbbr: string;
  awayPitcherId: number | null; awayPitcherName: string | null; awayPitcherHand: string | null;
  homePitcherId: number | null; homePitcherName: string | null; homePitcherHand: string | null;
  awayPitcherStats: PitcherStats | null; homePitcherStats: PitcherStats | null;
  awayLineup: BatterRow[]; homeLineup: BatterRow[];
  lineupAvailable: boolean;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function fmt3(v: number | null | undefined) { return v == null ? '—' : v.toFixed(3).replace(/^0\./, '.'); }
function fmt1(v: number | null | undefined) { return v == null ? '—' : v.toFixed(1); }
function fmt2(v: number | null | undefined) { return v == null ? '—' : v.toFixed(2); }
function fmtPct(v: number | null | undefined) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
function fmtPrice(v: number | null | undefined) { return v == null ? '—' : v > 0 ? `+${v}` : String(v); }

function gradeColor(g: number | null) {
  if (g == null) return 'text-fg-subtle';
  if (g >= 75) return 'text-pos';
  if (g >= 55) return 'text-warn';
  if (g >= 35) return 'text-warn';
  return 'text-neg';
}
function gradeBg(g: number | null) {
  if (g == null) return 'bg-surface-hover';
  if (g >= 75) return 'bg-pos-muted';
  if (g >= 55) return 'bg-warn-muted';
  if (g >= 35) return 'bg-warn-muted';
  return 'bg-surface';
}

// Blend L10/L30/L60 with graceful fallback
function wRate(ts: BatterRow['trend'], col: 'hit_rate' | 'tb_per_pa'): number | null {
  if (!ts) return null;
  const v10 = ts[`w10_${col}`] as number | null;
  const v30 = ts[`w30_${col}`] as number | null;
  const v60 = ts[`w60_${col}`] as number | null;
  const p10 = ts.w10_pa ?? 0, p30 = ts.w30_pa ?? 0, p60 = ts.w60_pa ?? 0;
  if (v60 != null && p60 >= 60) return v10 != null && p10 >= 10 ? 0.25 * v10 + 0.35 * v30! + 0.40 * v60 : v60;
  if (v30 != null && p30 >= 30) return v10 != null && p10 >= 10 ? 0.40 * v10 + 0.60 * v30 : v30;
  return v10;
}

function platoonRate(ts: BatterRow['trend'], hand: string | null): number | null {
  if (!ts || !hand) return null;
  if (hand === 'L' && (ts.vs_lhp_pa ?? 0) >= 20) return ts.vs_lhp_hit_rate;
  if (hand === 'R' && (ts.vs_rhp_pa ?? 0) >= 20) return ts.vs_rhp_hit_rate;
  return null;
}

// Best tier line for a batter: highest composite_grade across markets
function bestTier(tierLines: TierLine[]): TierLine | null {
  if (!tierLines.length) return null;
  return tierLines.reduce((best, t) =>
    (t.composite_grade ?? 0) > (best.composite_grade ?? 0) ? t : best
  );
}

// Market label abbreviation
function mktLabel(key: string) {
  if (key === 'batter_hits') return 'H';
  if (key === 'batter_total_bases') return 'TB';
  if (key === 'batter_home_runs') return 'HR';
  return key;
}

// ── sub-components ───────────────────────────────────────────────────────────

function PitcherSummary({
  name, hand, stats,
}: { name: string | null; hand: string | null; stats: PitcherStats | null }) {
  return (
    <div className="bg-surface rounded px-3 py-2 text-xs flex items-center gap-4 flex-wrap">
      <span className="font-medium text-fg-muted">{name ?? 'TBD'}</span>
      {hand && <span className="text-fg-subtle">{hand}HP</span>}
      {stats && (<>
        <span><span className="text-fg-subtle">ERA </span><span className="text-fg-muted">{fmt2(stats.era)}</span></span>
        <span><span className="text-fg-subtle">K/9 </span><span className="text-fg-muted">{fmt1(stats.k_per_9)}</span></span>
        <span><span className="text-fg-subtle">WHIP </span><span className="text-fg-muted">{fmt2(stats.whip)}</span></span>
        <span><span className="text-fg-subtle">OPS vs </span><span className="text-fg-muted">{fmt3(stats.ops_against)}</span></span>
      </>)}
    </div>
  );
}

function TierBadge({ line }: { line: TierLine }) {
  const tierLabel =
    line.value_line != null ? 'VAL' :
    line.safe_line != null ? 'SAFE' :
    line.highrisk_line != null ? 'RISK' : 'LOTTO';
  const tierColor =
    tierLabel === 'VAL' ? 'text-brand' :
    tierLabel === 'SAFE' ? 'text-pos' :
    tierLabel === 'RISK' ? 'text-warn' : 'text-info';
  const displayLine =
    line.value_line ?? line.safe_line ?? line.highrisk_line ?? line.lotto_line;
  const displayProb =
    line.value_prob ?? line.safe_prob ?? line.highrisk_prob ?? line.lotto_prob;
  const displayPrice =
    line.value_price ?? line.safe_price ?? line.highrisk_price ?? line.lotto_price;

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`font-semibold ${tierColor}`}>{tierLabel}</span>
      <span className="text-fg-muted">{mktLabel(line.market_key)} {displayLine ?? '—'}</span>
      <span className="text-fg-subtle">{fmtPct(displayProb)}</span>
      <span className="text-fg-disabled">{fmtPrice(displayPrice)}</span>
    </span>
  );
}

interface ChipValues {
  hit: (number | null)[];
  tb: (number | null)[];
  ev: (number | null)[];
  hard: (number | null)[];
  brl: (number | null)[];
}

function BatterCard({ batter, isHome, chipValues }: { batter: BatterRow; isHome: boolean; chipValues: ChipValues }) {
  const ts = batter.trend;
  const hitRate = wRate(ts, 'hit_rate');
  const tbRate = wRate(ts, 'tb_per_pa');
  const chip = (v: number | null | undefined, vals: (number | null)[]) => ({
    background: heatColorFor(v, vals),
    borderRadius: 3,
    padding: '0 3px',
  });
  const platoon = platoonRate(ts, batter.oppPitcherHand);
  const best = bestTier(batter.tierLines);
  const grade = best?.composite_grade ?? null;

  return (
    <div className={`rounded px-3 py-2 mb-1 ${gradeBg(grade)}`}>
      <div className="flex items-start justify-between gap-2">
        {/* Left: batting order + name + position */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-fg-disabled text-xs w-4 shrink-0">{batter.battingOrder}</span>
          <div className="min-w-0">
            <span className="text-sm text-fg font-medium truncate block">
              {batter.playerName ?? `#${batter.playerId}`}
            </span>
            <span className="text-xs text-fg-subtle">{batter.position ?? ''} {batter.handCode ?? ''}</span>
          </div>
        </div>

        {/* Right: grade + best tier */}
        <div className="text-right shrink-0">
          {grade != null && (
            <span className={`text-xs font-semibold ${gradeColor(grade)}`}>
              {Math.round(grade)}
            </span>
          )}
          {best && (
            <div className="text-xs mt-0.5">
              <TierBadge line={best} />
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      {ts && (
        <div className="flex gap-3 mt-1.5 text-xs flex-wrap">
          <span style={chip(hitRate, chipValues.hit)}>
            <span className="text-fg-subtle">AVG </span>
            <span className="text-fg-muted">{fmtPct(hitRate)}</span>
          </span>
          <span style={chip(tbRate, chipValues.tb)}>
            <span className="text-fg-subtle">TB/PA </span>
            <span className="text-fg-muted">{fmt3(tbRate)}</span>
          </span>
          {platoon != null && (
            <span>
              <span className="text-fg-subtle">vs{batter.oppPitcherHand} </span>
              <span className="text-fg-muted">{fmtPct(platoon)}</span>
            </span>
          )}
          <span style={chip(ts.w30_avg_ev, chipValues.ev)}>
            <span className="text-fg-subtle">EV </span>
            <span className="text-fg-muted">{fmt1(ts.w30_avg_ev)}</span>
          </span>
          <span style={chip(ts.w30_hard_hit_pct, chipValues.hard)}>
            <span className="text-fg-subtle">Hard </span>
            <span className="text-fg-muted">{fmtPct(ts.w30_hard_hit_pct)}</span>
          </span>
          <span style={chip(ts.w30_barrel_pct, chipValues.brl)}>
            <span className="text-fg-subtle">Brl </span>
            <span className="text-fg-muted">{fmtPct(ts.w30_barrel_pct)}</span>
          </span>
          {batter.bvp && batter.bvp.plate_appearances >= 10 && (
            <span>
              <span className="text-fg-subtle">BvP </span>
              <span className="text-fg-muted">{fmt3(batter.bvp.batting_avg)} ({batter.bvp.plate_appearances}PA)</span>
            </span>
          )}
        </div>
      )}

      {/* All tier lines for this batter */}
      {batter.tierLines.length > 0 && (
        <div className="flex gap-3 mt-1.5 flex-wrap">
          {batter.tierLines.map(tl => (
            <div key={tl.market_key} className="text-xs">
              <TierBadge line={tl} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Top bets card: all tier lines with grade ≥ 55, sorted by grade desc
function BestBets({ awayLineup, homeLineup, awayAbbr, homeAbbr }: {
  awayLineup: BatterRow[]; homeLineup: BatterRow[];
  awayAbbr: string; homeAbbr: string;
}) {
  const candidates: { batter: BatterRow; tl: TierLine; team: string }[] = [];
  for (const b of awayLineup) {
    for (const tl of b.tierLines) {
      if ((tl.composite_grade ?? 0) >= 55) candidates.push({ batter: b, tl, team: awayAbbr });
    }
  }
  for (const b of homeLineup) {
    for (const tl of b.tierLines) {
      if ((tl.composite_grade ?? 0) >= 55) candidates.push({ batter: b, tl, team: homeAbbr });
    }
  }
  candidates.sort((a, b) => (b.tl.composite_grade ?? 0) - (a.tl.composite_grade ?? 0));

  if (candidates.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-2">
        Top Plays (Grade ≥ 55)
      </div>
      <div className="space-y-1">
        {candidates.slice(0, 8).map(({ batter, tl, team }, i) => {
          const grade = tl.composite_grade ?? 0;
          const tierLabel = tl.value_line != null ? 'VALUE' : tl.safe_line != null ? 'SAFE' : tl.highrisk_line != null ? 'HI-RISK' : 'LOTTO';
          const tierColor = tierLabel === 'VALUE' ? 'text-brand' : tierLabel === 'SAFE' ? 'text-pos' : tierLabel === 'HI-RISK' ? 'text-warn' : 'text-info';
          const displayLine = tl.value_line ?? tl.safe_line ?? tl.highrisk_line ?? tl.lotto_line;
          const displayProb = tl.value_prob ?? tl.safe_prob ?? tl.highrisk_prob ?? tl.lotto_prob;
          const displayPrice = tl.value_price ?? tl.safe_price ?? tl.highrisk_price ?? tl.lotto_price;
          return (
            <div key={i} className={`flex items-center justify-between rounded px-3 py-1.5 ${gradeBg(grade)}`}>
              <div className="flex items-center gap-2 text-xs">
                <span className={`font-semibold w-7 ${gradeColor(grade)}`}>{Math.round(grade)}</span>
                <span className="text-fg-muted font-medium">{batter.playerName ?? `#${batter.playerId}`}</span>
                <span className="text-fg-disabled">{team}</span>
                <span className="text-fg-subtle">{mktLabel(tl.market_key)}</span>
                <span className={`font-semibold ${tierColor}`}>{tierLabel}</span>
                <span className="text-fg-muted">{displayLine}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-fg-subtle">{fmtPct(displayProb)}</span>
                <span className="text-fg-subtle">{fmtPrice(displayPrice)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function MlbProjView({ game }: { game: MlbGame }) {
  const [data, setData] = useState<ProjData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTeam, setActiveTeam] = useState<'away' | 'home' | 'both'>('both');

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);
    fetch(`/api/mlb-proj?gamePk=${game.gameId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [game.gameId]);

  if (loading) return <div className="py-4 text-sm text-fg-subtle">Loading projections...</div>;
  if (error) return <div className="py-4 text-sm text-neg">Error: {error}</div>;
  if (!data) return null;

  if (!data.lineupAvailable) {
    return (
      <div className="py-4 space-y-3">
        <div className="text-sm text-fg-subtle">Lineup not yet available for this game.</div>
        <div className="text-xs text-fg-disabled">
          {data.awayPitcherName ?? game.awayPitcher ?? 'TBD'} vs {data.homePitcherName ?? game.homePitcher ?? 'TBD'}
        </div>
      </div>
    );
  }

  const showAway = activeTeam === 'away' || activeTeam === 'both';
  const showHome = activeTeam === 'home' || activeTeam === 'both';

  // Percentile chip shading ranks across BOTH lineups (shared scale with
  // /mlb/research and the game tabs — web/lib/colorScale.ts).
  const allBatters = [...data.awayLineup, ...data.homeLineup];
  const chipValues: ChipValues = {
    hit: allBatters.map((b) => wRate(b.trend, 'hit_rate')),
    tb: allBatters.map((b) => wRate(b.trend, 'tb_per_pa')),
    ev: allBatters.map((b) => b.trend?.w30_avg_ev ?? null),
    hard: allBatters.map((b) => b.trend?.w30_hard_hit_pct ?? null),
    brl: allBatters.map((b) => b.trend?.w30_barrel_pct ?? null),
  };

  return (
    <div className="py-4 space-y-5">

      {/* Team switcher */}
      <div className="flex gap-1">
        {(['both', 'away', 'home'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTeam(t)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              activeTeam === t ? 'bg-brand text-fg' : 'bg-surface-hover text-fg-subtle hover:bg-surface-hover'
            }`}
          >
            {t === 'both' ? 'Both' : t === 'away' ? data.awayAbbr : data.homeAbbr}
          </button>
        ))}
      </div>

      {/* Best bets */}
      <BestBets
        awayLineup={data.awayLineup}
        homeLineup={data.homeLineup}
        awayAbbr={data.awayAbbr}
        homeAbbr={data.homeAbbr}
      />

      {/* Away lineup */}
      {showAway && data.awayLineup.length > 0 && (
        <div>
          <div className="mb-2">
            <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-1">
              {data.awayAbbr} vs
            </div>
            <PitcherSummary
              name={data.homePitcherName}
              hand={data.homePitcherHand}
              stats={data.homePitcherStats}
            />
          </div>
          <div>
            {data.awayLineup.map(b => (
              <BatterCard key={b.playerId} batter={b} isHome={false} chipValues={chipValues} />
            ))}
          </div>
        </div>
      )}

      {/* Home lineup */}
      {showHome && data.homeLineup.length > 0 && (
        <div>
          <div className="mb-2">
            <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-1">
              {data.homeAbbr} vs
            </div>
            <PitcherSummary
              name={data.awayPitcherName}
              hand={data.awayPitcherHand}
              stats={data.awayPitcherStats}
            />
          </div>
          <div>
            {data.homeLineup.map(b => (
              <BatterCard key={b.playerId} batter={b} isHome={true} chipValues={chipValues} />
            ))}
          </div>
        </div>
      )}

      {data.awayLineup.length === 0 && data.homeLineup.length === 0 && (
        <div className="text-sm text-fg-subtle">Lineup not yet available for this game.</div>
      )}

      <div className="text-xs text-fg-disabled pt-1">
        Grade = 40% rolling hit-rate + 30% EV quality + 30% matchup. Tier lines from FanDuel props.
      </div>
    </div>
  );
}
