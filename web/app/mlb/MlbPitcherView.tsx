'use client';

import { useEffect, useState } from 'react';

interface MlbGame {
  gameId: number;
  gameDate: string;
  awayTeamId: number;
  homeTeamId: number;
  awayTeamAbbr: string;
  homeTeamAbbr: string;
  awayPitcher: string | null;
  homePitcher: string | null;
  away_pitcher_id?: number;
  home_pitcher_id?: number;
}

interface TierLine {
  market_key: string;
  composite_grade: number | null;
  safe_line: number | null; safe_prob: number | null; safe_price: number | null;
  value_line: number | null; value_prob: number | null; value_price: number | null;
  highrisk_line: number | null; highrisk_prob: number | null; highrisk_price: number | null;
  lotto_line: number | null; lotto_prob: number | null; lotto_price: number | null;
  kde_window: number | null;
  grade_date: string | null;
}

interface SeasonStats {
  season_year: number;
  games_started: number | null;
  innings_pitched: number | null;
  strikeouts: number | null;
  walks: number | null;
  era: number | null;
  whip: number | null;
  k_per_9: number | null;
  bb_per_9: number | null;
  h_per_9: number | null;
  hr_per_9: number | null;
  batting_avg_against: number | null;
  obp_against: number | null;
  ops_against: number | null;
}

interface StartLogRow {
  game_date: string;
  game_display: string | null;
  batters_faced: number;
  strikeouts: number;
  hits_allowed: number;
  hr_allowed: number;
  walks: number;
  ip_approx: number | null;
}

interface LineupBatter {
  player_id: number;
  player_name: string | null;
  batting_order: number;
  position_abbreviation: string | null;
  hand_code: string | null;
  trend: {
    w10_k_rate: number | null; w30_k_rate: number | null; w60_k_rate: number | null;
    w10_pa: number | null; w30_pa: number | null; w60_pa: number | null;
    w30_avg_ev: number | null; w30_hard_hit_pct: number | null;
    vs_lhp_pa: number | null; vs_lhp_hit_rate: number | null;
    vs_rhp_pa: number | null; vs_rhp_hit_rate: number | null;
  } | null;
  bvp: {
    plate_appearances: number; at_bats: number; hits: number;
    home_runs: number; walks: number; strikeouts: number;
    batting_avg: number | null; obp: number | null; slg: number | null; ops: number | null;
    last_faced_date: string | null;
  } | null;
}

interface PitcherData {
  pitcherId: number;
  pitcherName: string | null;
  pitcherHand: string | null;
  gameDate: string | null;
  oppTeamId: number | null;
  seasonStats: SeasonStats | null;
  startLog: StartLogRow[];
  lineup: LineupBatter[];
  tierLines: TierLine[];
}

interface BvpPitcher {
  awayPitcherId: number | null;
  homePitcherId: number | null;
}

function fmt3(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(3).replace(/^0\./, '.');
}
function fmt1(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(1);
}
function fmt2(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(2);
}
function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return (v * 100).toFixed(1) + '%';
}
function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '—';
  return v > 0 ? `+${v}` : String(v);
}

function gradeColor(g: number | null): string {
  if (g == null) return 'text-fg-subtle';
  if (g >= 75) return 'text-pos';
  if (g >= 55) return 'text-warn';
  if (g >= 35) return 'text-warn';
  return 'text-neg';
}

function kRateColor(r: number | null): string {
  if (r == null) return 'text-fg-subtle';
  if (r >= 0.30) return 'text-pos';   // high K rate = favorable for pitcher
  if (r >= 0.22) return 'text-warn';
  if (r >= 0.15) return 'text-warn';
  return 'text-neg';
}

function eraColor(era: number | null): string {
  if (era == null) return 'text-fg-subtle';
  if (era <= 3.00) return 'text-pos';
  if (era <= 4.00) return 'text-warn';
  if (era <= 5.00) return 'text-warn';
  return 'text-neg';
}

function kColor(k: number): string {
  if (k >= 9) return 'text-pos';
  if (k >= 6) return 'text-warn';
  if (k >= 4) return 'text-warn';
  return 'text-fg-subtle';
}

// Weighted K-rate blending w10/w30/w60 with graceful fallback
function weightedKRate(trend: LineupBatter['trend']): number | null {
  if (!trend) return null;
  const w10 = trend.w10_k_rate, pa10 = trend.w10_pa ?? 0;
  const w30 = trend.w30_k_rate, pa30 = trend.w30_pa ?? 0;
  const w60 = trend.w60_k_rate, pa60 = trend.w60_pa ?? 0;
  if (w60 != null && pa60 >= 60) return w10 != null && pa10 >= 10 ? 0.25 * w10 + 0.35 * w30! + 0.40 * w60 : w60;
  if (w30 != null && pa30 >= 30) return w10 != null && pa10 >= 10 ? 0.40 * w10 + 0.60 * w30 : w30;
  if (w10 != null && pa10 >= 10) return w10;
  return null;
}

// Platoon-adjusted hit rate: use split if >=20 PA, else overall w30
function platoonHitRate(trend: LineupBatter['trend'], pitcherHand: string | null): number | null {
  if (!trend) return null;
  if (pitcherHand === 'L' && (trend.vs_lhp_pa ?? 0) >= 20) return trend.vs_lhp_hit_rate;
  if (pitcherHand === 'R' && (trend.vs_rhp_pa ?? 0) >= 20) return trend.vs_rhp_hit_rate;
  return null;
}

export default function MlbPitcherView({ game }: { game: MlbGame }) {
  const [pitcherIds, setPitcherIds] = useState<BvpPitcher>({ awayPitcherId: null, homePitcherId: null });
  const [selectedPitcherId, setSelectedPitcherId] = useState<number | null>(null);
  const [data, setData] = useState<PitcherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve pitcher IDs from the BvP endpoint which already fetches game starters
  useEffect(() => {
    setData(null);
    setSelectedPitcherId(null);
    setPitcherIds({ awayPitcherId: null, homePitcherId: null });

    fetch(`/api/mlb-bvp?gamePk=${game.gameId}`)
      .then(r => r.json())
      .then(d => {
        const awayId = d.awaySP?.playerId ?? null;
        const homeId = d.homeSP?.playerId ?? null;
        setPitcherIds({ awayPitcherId: awayId, homePitcherId: homeId });
        // Default to away pitcher
        setSelectedPitcherId(awayId ?? homeId);
      })
      .catch(() => {});
  }, [game.gameId]);

  useEffect(() => {
    if (!selectedPitcherId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/mlb-pitcher?gamePk=${game.gameId}&pitcherId=${selectedPitcherId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [game.gameId, selectedPitcherId]);

  const tierLine = data?.tierLines.find(t => t.market_key === 'pitcher_strikeouts') ?? null;

  return (
    <div className="py-4 space-y-6">

      {/* Pitcher selector */}
      <div className="flex gap-2">
        {[
          { id: pitcherIds.awayPitcherId, label: game.awayTeamAbbr, name: game.awayPitcher },
          { id: pitcherIds.homePitcherId, label: game.homeTeamAbbr, name: game.homePitcher },
        ].map(({ id, label, name }) => (
          id != null && (
            <button
              key={id}
              onClick={() => setSelectedPitcherId(id)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                selectedPitcherId === id
                  ? 'bg-brand text-fg'
                  : 'bg-surface-hover text-fg-muted hover:bg-surface-hover'
              }`}
            >
              {label} — {name ?? `#${id}`}
            </button>
          )
        ))}
      </div>

      {loading && <div className="text-sm text-fg-subtle">Loading...</div>}
      {error && <div className="text-sm text-neg">Error: {error}</div>}

      {data && (
        <>
          {/* Tier lines */}
          {tierLine ? (
            <div>
              <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-2">
                Strikeout Tier Lines
                <span className={`ml-2 ${gradeColor(tierLine.composite_grade)}`}>
                  Grade {tierLine.composite_grade != null ? Math.round(tierLine.composite_grade) : '—'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {([
                  { label: 'Safe', line: tierLine.safe_line, prob: tierLine.safe_prob, price: tierLine.safe_price, color: 'text-pos' },
                  { label: 'Value', line: tierLine.value_line, prob: tierLine.value_prob, price: tierLine.value_price, color: 'text-brand' },
                  { label: 'Hi-Risk', line: tierLine.highrisk_line, prob: tierLine.highrisk_prob, price: tierLine.highrisk_price, color: 'text-warn' },
                  { label: 'Lotto', line: tierLine.lotto_line, prob: tierLine.lotto_prob, price: tierLine.lotto_price, color: 'text-info' },
                ] as const).map(t => (
                  <div key={t.label} className="bg-surface rounded p-3 text-center">
                    <div className={`text-xs font-semibold ${t.color} mb-1`}>{t.label}</div>
                    <div className="text-lg font-bold text-fg">{t.line ?? '—'}</div>
                    <div className="text-xs text-fg-subtle">{fmtPct(t.prob)}</div>
                    <div className="text-xs text-fg-subtle">{fmtPrice(t.price)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-fg-subtle">No tier lines available for this pitcher.</div>
          )}

          {/* Season stats */}
          {data.seasonStats && (
            <div>
              <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-2">
                {data.seasonStats.season_year} Season
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-1 text-sm bg-surface rounded p-3">
                <div><span className="text-fg-subtle text-xs">ERA</span><br /><span className={`font-medium ${eraColor(data.seasonStats.era)}`}>{fmt2(data.seasonStats.era)}</span></div>
                <div><span className="text-fg-subtle text-xs">WHIP</span><br /><span className="font-medium text-fg-muted">{fmt2(data.seasonStats.whip)}</span></div>
                <div><span className="text-fg-subtle text-xs">K/9</span><br /><span className="font-medium text-fg-muted">{fmt1(data.seasonStats.k_per_9)}</span></div>
                <div><span className="text-fg-subtle text-xs">BB/9</span><br /><span className="font-medium text-fg-muted">{fmt1(data.seasonStats.bb_per_9)}</span></div>
                <div><span className="text-fg-subtle text-xs">H/9</span><br /><span className="font-medium text-fg-muted">{fmt1(data.seasonStats.h_per_9)}</span></div>
                <div><span className="text-fg-subtle text-xs">HR/9</span><br /><span className="font-medium text-fg-muted">{fmt2(data.seasonStats.hr_per_9)}</span></div>
                <div><span className="text-fg-subtle text-xs">BAA</span><br /><span className="font-medium text-fg-muted">{fmt3(data.seasonStats.batting_avg_against)}</span></div>
                <div><span className="text-fg-subtle text-xs">OPS vs</span><br /><span className="font-medium text-fg-muted">{fmt3(data.seasonStats.ops_against)}</span></div>
                <div><span className="text-fg-subtle text-xs">IP</span><br /><span className="font-medium text-fg-muted">{fmt1(data.seasonStats.innings_pitched)}</span></div>
                <div><span className="text-fg-subtle text-xs">GS</span><br /><span className="font-medium text-fg-muted">{data.seasonStats.games_started ?? '—'}</span></div>
                <div><span className="text-fg-subtle text-xs">K</span><br /><span className="font-medium text-fg-muted">{data.seasonStats.strikeouts ?? '—'}</span></div>
                <div><span className="text-fg-subtle text-xs">Hand</span><br /><span className="font-medium text-fg-muted">{data.pitcherHand ?? '—'}</span></div>
              </div>
            </div>
          )}

          {/* Recent start log */}
          {data.startLog.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-2">Recent Starts</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-fg-subtle border-b border-border">
                      <th className="text-left py-1 pr-3 font-normal">Game</th>
                      <th className="text-right py-1 px-2 font-normal">IP</th>
                      <th className="text-right py-1 px-2 font-normal">BF</th>
                      <th className="text-right py-1 px-2 font-normal">K</th>
                      <th className="text-right py-1 px-2 font-normal">H</th>
                      <th className="text-right py-1 px-2 font-normal">HR</th>
                      <th className="text-right py-1 px-2 font-normal">BB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.startLog.map((row, i) => (
                      <tr key={i} className="border-b border-border-subtle">
                        <td className="py-1 pr-3 text-fg-subtle">{row.game_display ?? row.game_date}</td>
                        <td className="text-right py-1 px-2 text-fg-muted">{fmt1(row.ip_approx)}</td>
                        <td className="text-right py-1 px-2 text-fg-muted">{row.batters_faced}</td>
                        <td className={`text-right py-1 px-2 font-semibold ${kColor(row.strikeouts)}`}>{row.strikeouts}</td>
                        <td className="text-right py-1 px-2 text-fg-subtle">{row.hits_allowed}</td>
                        <td className="text-right py-1 px-2 text-fg-subtle">{row.hr_allowed}</td>
                        <td className="text-right py-1 px-2 text-fg-subtle">{row.walks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Opposing lineup */}
          {data.lineup.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-2">
                Opposing Lineup — K Vulnerability
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-fg-subtle border-b border-border">
                      <th className="text-left py-1 pr-2 font-normal w-4">#</th>
                      <th className="text-left py-1 pr-3 font-normal">Batter</th>
                      <th className="text-left py-1 pr-2 font-normal">B</th>
                      <th className="text-right py-1 px-2 font-normal">K%</th>
                      <th className="text-right py-1 px-2 font-normal">Hit%{data.pitcherHand ? ` vs${data.pitcherHand}` : ''}</th>
                      <th className="text-right py-1 px-2 font-normal">EV</th>
                      <th className="text-right py-1 px-2 font-normal">BvP PA</th>
                      <th className="text-right py-1 px-2 font-normal">BvP AVG</th>
                      <th className="text-right py-1 px-2 font-normal">BvP K</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lineup.map((batter) => {
                      const kRate = weightedKRate(batter.trend);
                      const hitRate = platoonHitRate(batter.trend, data.pitcherHand);
                      const pa = batter.bvp?.plate_appearances ?? 0;
                      return (
                        <tr key={batter.player_id} className="border-b border-border-subtle">
                          <td className="py-1 pr-2 text-fg-disabled">{Math.floor(batter.batting_order / 100)}</td>
                          <td className="py-1 pr-3 text-fg-muted">{batter.player_name ?? `#${batter.player_id}`}</td>
                          <td className="py-1 pr-2 text-fg-subtle">{batter.hand_code ?? '—'}</td>
                          <td className={`text-right py-1 px-2 font-semibold ${kRateColor(kRate)}`}>{fmtPct(kRate)}</td>
                          <td className="text-right py-1 px-2 text-fg-muted">{hitRate != null ? fmtPct(hitRate) : '—'}</td>
                          <td className="text-right py-1 px-2 text-fg-muted">{fmt1(batter.trend?.w30_avg_ev)}</td>
                          <td className="text-right py-1 px-2 text-fg-subtle">{pa > 0 ? pa : '—'}</td>
                          <td className="text-right py-1 px-2 text-fg-muted">{pa >= 5 ? fmt3(batter.bvp?.batting_avg) : '—'}</td>
                          <td className="text-right py-1 px-2 text-fg-muted">{pa >= 5 ? (batter.bvp?.strikeouts ?? '—') : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-1 text-xs text-fg-disabled">
                K% = weighted L10/L30/L60 strikeout rate. Hit% uses platoon split when ≥20 PA. BvP shown when ≥5 PA.
              </div>
            </div>
          )}

          {data.lineup.length === 0 && !loading && (
            <div className="text-xs text-fg-subtle">Opposing lineup not yet available for this game.</div>
          )}
        </>
      )}
    </div>
  );
}
