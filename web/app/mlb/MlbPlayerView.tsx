'use client';

import { useEffect, useState, type ReactNode } from 'react';

interface MlbGame {
  gameId: number;
  gameDate: string;
  awayTeamId: number;
  homeTeamId: number;
  awayTeamAbbr: string;
  homeTeamAbbr: string;
  awayPitcher: string | null;
  homePitcher: string | null;
}

interface TrendStats {
  w10_pa: number | null; w10_hits: number | null; w10_hit_rate: number | null;
  w10_total_bases: number | null; w10_home_runs: number | null;
  w10_avg_ev: number | null; w10_hard_hit_pct: number | null;
  w10_barrel_pct: number | null; w10_avg_xba: number | null;
  w10_bb_rate: number | null; w10_k_rate: number | null;
  w30_pa: number | null; w30_hits: number | null; w30_hit_rate: number | null;
  w30_total_bases: number | null; w30_home_runs: number | null;
  w30_avg_ev: number | null; w30_hard_hit_pct: number | null;
  w30_barrel_pct: number | null; w30_avg_xba: number | null;
  w30_bb_rate: number | null; w30_k_rate: number | null;
  w60_pa: number | null; w60_hits: number | null; w60_hit_rate: number | null;
  w60_total_bases: number | null; w60_home_runs: number | null;
  w60_avg_ev: number | null; w60_hard_hit_pct: number | null;
  w60_barrel_pct: number | null; w60_avg_xba: number | null;
  w60_bb_rate: number | null; w60_k_rate: number | null;
  vs_lhp_pa: number | null; vs_lhp_hits: number | null; vs_lhp_hit_rate: number | null;
  vs_rhp_pa: number | null; vs_rhp_hits: number | null; vs_rhp_hit_rate: number | null;
  home_pa: number | null; home_hits: number | null; home_hit_rate: number | null;
  away_pa: number | null; away_hits: number | null; away_hit_rate: number | null;
}

interface GameLogRow {
  game_date: string;
  hits: number;
  total_bases: number;
  home_runs: number;
  pa: number;
  walks: number;
  strikeouts: number;
  avg_ev: number | null;
  hard_hit: number;
  bbe: number;
  avg_xba: number | null;
  game_display: string | null;
}

interface Bvp {
  plate_appearances: number;
  at_bats: number;
  hits: number;
  home_runs: number;
  walks: number;
  strikeouts: number;
  total_bases: number;
  batting_avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  last_faced_date: string | null;
}

interface PitcherStats {
  k_per_9: number | null;
  bb_per_9: number | null;
  h_per_9: number | null;
  era: number | null;
  whip: number | null;
  obp_against: number | null;
  ops_against: number | null;
  hr_per_9: number | null;
  strikeouts: number | null;
  innings_pitched: number | null;
  games_started: number | null;
}

interface TierLine {
  market_key: string;
  composite_grade: number;
  safe_line: number | null; safe_prob: number | null; safe_price: number | null;
  value_line: number | null; value_prob: number | null; value_price: number | null;
  highrisk_line: number | null; highrisk_prob: number | null; highrisk_price: number | null;
  lotto_line: number | null; lotto_prob: number | null; lotto_price: number | null;
}

interface PlayerData {
  playerId: number;
  playerName: string | null;
  gameDate: string | null;
  trendStats: TrendStats | null;
  gameLog: GameLogRow[];
  bvp: Bvp | null;
  oppPitcherId: number | null;
  oppPitcherName: string | null;
  oppPitcherHand: string | null;
  pitcherStats: PitcherStats | null;
  tierLines: TierLine[];
}

interface BatterOption {
  player_id: number;
  player_name: string;
  batting_order: number;
  side: string;
  position: string;
}

// --- Helpers ---

function pct(v: number | null, digits = 0): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

function dec(v: number | null, digits = 3): string {
  if (v == null) return '—';
  return v.toFixed(digits);
}

function evColor(v: number | null): string {
  if (v == null) return '';
  if (v >= 100) return 'text-neg';
  if (v >= 95)  return 'text-warn';
  if (v >= 90)  return 'text-warn';
  return '';
}

function hitColor(h: number): string {
  if (h >= 2) return 'text-pos font-semibold';
  if (h >= 1) return 'text-pos';
  return '';
}

function priceLabel(price: number | null): string {
  if (price == null) return '—';
  return price > 0 ? `+${price}` : String(price);
}

function gradeColor(g: number): string {
  if (g >= 75) return 'text-pos';
  if (g >= 55) return 'text-warn';
  if (g >= 35) return 'text-warn';
  return 'text-neg';
}

const MARKET_LABEL: Record<string, string> = {
  batter_hits: 'Hits',
  batter_total_bases: 'Total Bases',
  batter_home_runs: 'Home Runs',
};

// --- Sub-components ---

function WindowRow({ label, pa, hitRate, tbPerPa, hrs, avgEv, hardHit, barrel, xba }: {
  label: string;
  pa: number | null;
  hitRate: number | null;
  tbPerPa: number | null;
  hrs: number | null;
  avgEv: number | null;
  hardHit: number | null;
  barrel: number | null;
  xba: number | null;
}) {
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-3 text-fg-subtle text-xs font-medium whitespace-nowrap">{label}</td>
      <td className="py-1.5 pr-3 text-right text-xs text-fg-subtle">{pa ?? '—'}</td>
      <td className="py-1.5 pr-3 text-right text-xs">{dec(hitRate)}</td>
      <td className="py-1.5 pr-3 text-right text-xs">{dec(tbPerPa)}</td>
      <td className="py-1.5 pr-3 text-right text-xs">{hrs ?? '—'}</td>
      <td className={`py-1.5 pr-3 text-right text-xs ${evColor(avgEv)}`}>{avgEv?.toFixed(1) ?? '—'}</td>
      <td className="py-1.5 pr-3 text-right text-xs">{pct(hardHit)}</td>
      <td className="py-1.5 pr-3 text-right text-xs">{pct(barrel)}</td>
      <td className="py-1.5 text-right text-xs">{dec(xba)}</td>
    </tr>
  );
}

function TrendStatsTable({ ts }: { ts: TrendStats }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-fg-muted min-w-max">
        <thead>
          <tr className="text-xs text-fg-subtle uppercase tracking-wide">
            <th className="pb-1.5 pr-3 text-left">Window</th>
            <th className="pb-1.5 pr-3 text-right">PA</th>
            <th className="pb-1.5 pr-3 text-right">AVG</th>
            <th className="pb-1.5 pr-3 text-right">TB/PA</th>
            <th className="pb-1.5 pr-3 text-right">HR</th>
            <th className="pb-1.5 pr-3 text-right">AvgEV</th>
            <th className="pb-1.5 pr-3 text-right">Hard%</th>
            <th className="pb-1.5 pr-3 text-right">Brrl%</th>
            <th className="pb-1.5 text-right">xBA</th>
          </tr>
        </thead>
        <tbody>
          <WindowRow label="L10"
            pa={ts.w10_pa} hitRate={ts.w10_hit_rate} tbPerPa={null}
            hrs={ts.w10_home_runs} avgEv={ts.w10_avg_ev}
            hardHit={ts.w10_hard_hit_pct} barrel={ts.w10_barrel_pct} xba={ts.w10_avg_xba}
          />
          <WindowRow label="L30"
            pa={ts.w30_pa} hitRate={ts.w30_hit_rate} tbPerPa={null}
            hrs={ts.w30_home_runs} avgEv={ts.w30_avg_ev}
            hardHit={ts.w30_hard_hit_pct} barrel={ts.w30_barrel_pct} xba={ts.w30_avg_xba}
          />
          <WindowRow label="L60"
            pa={ts.w60_pa} hitRate={ts.w60_hit_rate} tbPerPa={null}
            hrs={ts.w60_home_runs} avgEv={ts.w60_avg_ev}
            hardHit={ts.w60_hard_hit_pct} barrel={ts.w60_barrel_pct} xba={ts.w60_avg_xba}
          />
        </tbody>
      </table>
    </div>
  );
}

function SplitsTable({ ts }: { ts: TrendStats }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-fg-muted">
        <thead>
          <tr className="text-xs text-fg-subtle uppercase tracking-wide">
            <th className="pb-1.5 pr-3 text-left">Split</th>
            <th className="pb-1.5 pr-3 text-right">PA</th>
            <th className="pb-1.5 text-right">AVG</th>
          </tr>
        </thead>
        <tbody>
          {([
            ['vs LHP', ts.vs_lhp_pa, ts.vs_lhp_hit_rate],
            ['vs RHP', ts.vs_rhp_pa, ts.vs_rhp_hit_rate],
            ['Home',   ts.home_pa,   ts.home_hit_rate],
            ['Away',   ts.away_pa,   ts.away_hit_rate],
          ] as [string, number|null, number|null][]).map(([label, pa, rate]) => (
            <tr key={label} className="border-t border-border">
              <td className="py-1.5 pr-3 text-xs text-fg-subtle">{label}</td>
              <td className="py-1.5 pr-3 text-right text-xs text-fg-subtle">{pa ?? '—'}</td>
              <td className="py-1.5 text-right text-xs">{dec(rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GameLogTable({ rows }: { rows: GameLogRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-fg-subtle">No recent game data.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-fg-muted min-w-max">
        <thead>
          <tr className="text-xs text-fg-subtle uppercase tracking-wide">
            <th className="pb-1.5 pr-3 text-left">Date</th>
            <th className="pb-1.5 pr-3 text-left">Matchup</th>
            <th className="pb-1.5 pr-3 text-right">PA</th>
            <th className="pb-1.5 pr-3 text-right">H</th>
            <th className="pb-1.5 pr-3 text-right">TB</th>
            <th className="pb-1.5 pr-3 text-right">HR</th>
            <th className="pb-1.5 pr-3 text-right">BB</th>
            <th className="pb-1.5 pr-3 text-right">K</th>
            <th className="pb-1.5 pr-3 text-right">AvgEV</th>
            <th className="pb-1.5 text-right">xBA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-t border-border ${r.hits > 0 ? 'bg-pos-muted' : ''}`}>
              <td className="py-1.5 pr-3 text-xs text-fg-subtle whitespace-nowrap">
                {r.game_date ? r.game_date.slice(5) : ''}
              </td>
              <td className="py-1.5 pr-3 text-xs text-fg-subtle whitespace-nowrap">
                {r.game_display ?? ''}
              </td>
              <td className="py-1.5 pr-3 text-right text-xs text-fg-subtle">{r.pa}</td>
              <td className={`py-1.5 pr-3 text-right text-xs ${hitColor(r.hits)}`}>{r.hits}</td>
              <td className="py-1.5 pr-3 text-right text-xs">{r.total_bases}</td>
              <td className={`py-1.5 pr-3 text-right text-xs ${r.home_runs > 0 ? 'text-warn' : ''}`}>{r.home_runs}</td>
              <td className="py-1.5 pr-3 text-right text-xs text-fg-subtle">{r.walks}</td>
              <td className="py-1.5 pr-3 text-right text-xs text-fg-subtle">{r.strikeouts}</td>
              <td className={`py-1.5 pr-3 text-right text-xs ${evColor(r.avg_ev)}`}>
                {r.avg_ev != null ? r.avg_ev.toFixed(1) : '—'}
              </td>
              <td className="py-1.5 text-right text-xs">{r.avg_xba != null ? r.avg_xba.toFixed(3) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BvpCard({ bvp, pitcherName, pitcherHand }: {
  bvp: Bvp | null;
  pitcherName: string | null;
  pitcherHand: string | null;
}) {
  const handLabel = pitcherHand === 'L' ? 'LHP' : pitcherHand === 'R' ? 'RHP' : '';
  return (
    <div>
      <h4 className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2">
        Career vs {pitcherName ?? 'Opp SP'}{handLabel ? ` (${handLabel})` : ''}
      </h4>
      {!bvp ? (
        <p className="text-xs text-fg-subtle">No career matchup data in loaded games.</p>
      ) : (
        <div className="grid grid-cols-4 gap-x-4 gap-y-1 text-sm">
          {([
            ['PA', bvp.plate_appearances],
            ['H', bvp.hits],
            ['HR', bvp.home_runs],
            ['BB', bvp.walks],
            ['K', bvp.strikeouts],
            ['TB', bvp.total_bases],
            ['AVG', bvp.batting_avg != null ? bvp.batting_avg.toFixed(3) : '—'],
            ['OBP', bvp.obp != null ? bvp.obp.toFixed(3) : '—'],
            ['SLG', bvp.slg != null ? bvp.slg.toFixed(3) : '—'],
            ['OPS', bvp.ops != null ? bvp.ops.toFixed(3) : '—'],
          ] as [string, ReactNode][]).map(([label, val]) => (
            <div key={label}>
              <span className="text-xs text-fg-subtle">{label} </span>
              <span className="text-xs text-fg-muted">{String(val)}</span>
            </div>
          ))}
          {bvp.last_faced_date && (
            <div className="col-span-4 text-xs text-fg-disabled mt-1">
              Last faced {String(bvp.last_faced_date).slice(0, 10)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PitcherStatsCard({ stats, pitcherName }: {
  stats: PitcherStats | null;
  pitcherName: string | null;
}) {
  if (!stats) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2">
        {pitcherName ?? 'Opp SP'} — Season Stats
      </h4>
      <div className="grid grid-cols-4 gap-x-4 gap-y-1 text-sm">
        {([
          ['ERA',   stats.era?.toFixed(2)],
          ['WHIP',  stats.whip?.toFixed(2)],
          ['K/9',   stats.k_per_9?.toFixed(1)],
          ['BB/9',  stats.bb_per_9?.toFixed(1)],
          ['H/9',   stats.h_per_9?.toFixed(1)],
          ['HR/9',  stats.hr_per_9?.toFixed(2)],
          ['BAA',   stats.obp_against?.toFixed(3)],
          ['OPS ag', stats.ops_against?.toFixed(3)],
          ['IP',    stats.innings_pitched?.toFixed(1)],
          ['GS',    stats.games_started],
        ] as [string, ReactNode][]).map(([label, val]) => (
          <div key={label}>
            <span className="text-xs text-fg-subtle">{label} </span>
            <span className="text-xs text-fg-muted">{val ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TierLinesSection({ tierLines }: { tierLines: TierLine[] }) {
  if (tierLines.length === 0) {
    return (
      <p className="text-xs text-fg-subtle">
        No tier lines yet. Run mlb-grading.yml to generate.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {tierLines.map((tl) => (
        <div key={tl.market_key}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-fg-muted">
              {MARKET_LABEL[tl.market_key] ?? tl.market_key}
            </span>
            <span className={`text-xs font-semibold ${gradeColor(tl.composite_grade)}`}>
              {tl.composite_grade.toFixed(0)}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            {([
              ['Safe',     tl.safe_line,     tl.safe_prob,     tl.safe_price,     'text-brand'],
              ['Value',    tl.value_line,    tl.value_prob,    tl.value_price,    'text-pos'],
              ['Hi Risk',  tl.highrisk_line, tl.highrisk_prob, tl.highrisk_price, 'text-warn'],
              ['Lotto',    tl.lotto_line,    tl.lotto_prob,    tl.lotto_price,    'text-info'],
            ] as [string, number|null, number|null, number|null, string][]).map(
              ([label, line, prob, price, cls]) =>
                line != null && (
                  <div key={label} className="bg-surface rounded px-2 py-1.5">
                    <div className={`font-semibold ${cls}`}>{label}</div>
                    <div className="text-fg-muted font-medium">{line}+</div>
                    <div className="text-fg-subtle">{prob != null ? pct(prob) : '—'}</div>
                    <div className="text-fg-subtle">{priceLabel(price)}</div>
                  </div>
                )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Main component ---

export default function MlbPlayerView({ game }: { game: MlbGame }) {
  const [batters, setBatters] = useState<BatterOption[]>([]);
  const [selectedBatter, setSelectedBatter] = useState<BatterOption | null>(null);
  const [data, setData] = useState<PlayerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load batter roster for this game (from batting_stats if Final, else projected)
  useEffect(() => {
    setBatters([]);
    setSelectedBatter(null);
    setData(null);

    async function loadBatters() {
      try {
        const res = await fetch(`/api/mlb-bvp?gamePk=${game.gameId}`);
        if (!res.ok) return;
        const d = await res.json();
        // Use awayLineup + homeLineup from the BvP route (it already resolves starters)
        const away = (d.awayLineup ?? []).map((b: any) => ({
          player_id: b.player_id,
          player_name: b.player_name,
          batting_order: b.batting_order ?? 0,
          side: 'A',
          position: b.position ?? '',
        }));
        const home = (d.homeLineup ?? []).map((b: any) => ({
          player_id: b.player_id,
          player_name: b.player_name,
          batting_order: b.batting_order ?? 0,
          side: 'H',
          position: b.position ?? '',
        }));
        const all = [...away, ...home].sort((a, b) => a.batting_order - b.batting_order);
        setBatters(all);
        if (all.length > 0) setSelectedBatter(all[0]);
      } catch {
        // silently fail — user can still type a player ID
      }
    }
    loadBatters();
  }, [game.gameId]);

  // Load player data when batter selection changes
  useEffect(() => {
    if (!selectedBatter) return;
    setData(null);
    setError(null);
    setLoading(true);

    fetch(`/api/mlb-player?gamePk=${game.gameId}&playerId=${selectedBatter.player_id}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [selectedBatter?.player_id, game.gameId]);

  return (
    <div className="py-4 space-y-6">
      {/* Batter selector */}
      <div className="flex flex-wrap gap-2">
        <div className="text-xs text-fg-subtle self-center mr-1">Batter:</div>
        {batters.length === 0 ? (
          <span className="text-xs text-fg-subtle">Loading lineup...</span>
        ) : (
          batters.map((b) => (
            <button
              key={b.player_id}
              onClick={() => setSelectedBatter(b)}
              className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                selectedBatter?.player_id === b.player_id
                  ? 'border-brand bg-brand-muted text-brand'
                  : 'border-border text-fg-subtle hover:border-border-strong hover:text-fg-muted'
              }`}
            >
              <span className="text-fg-disabled mr-1">
                {b.side === 'A' ? game.awayTeamAbbr : game.homeTeamAbbr}
              </span>
              {b.player_name}
            </button>
          ))
        )}
      </div>

      {loading && <div className="text-sm text-fg-subtle">Loading...</div>}
      {error && <div className="text-sm text-neg">Error: {error}</div>}

      {data && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-semibold text-fg">{data.playerName}</h2>
            {data.oppPitcherName && (
              <span className="text-sm text-fg-subtle">
                vs {data.oppPitcherName}
                {data.oppPitcherHand ? ` (${data.oppPitcherHand === 'L' ? 'LHP' : 'RHP'})` : ''}
              </span>
            )}
          </div>

          {/* Tier lines */}
          <section>
            <h3 className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-3">
              Prop Tiers
            </h3>
            <TierLinesSection tierLines={data.tierLines} />
          </section>

          {/* Trend stats */}
          {data.trendStats && (
            <section>
              <h3 className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-3">
                Rolling Windows
              </h3>
              <TrendStatsTable ts={data.trendStats} />
            </section>
          )}

          {/* Splits */}
          {data.trendStats && (
            <section>
              <h3 className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-3">
                Career Splits (all loaded data)
              </h3>
              <SplitsTable ts={data.trendStats} />
            </section>
          )}

          {/* Pitcher matchup */}
          <section className="space-y-4">
            <BvpCard
              bvp={data.bvp}
              pitcherName={data.oppPitcherName}
              pitcherHand={data.oppPitcherHand}
            />
            <PitcherStatsCard
              stats={data.pitcherStats}
              pitcherName={data.oppPitcherName}
            />
          </section>

          {/* Game log */}
          <section>
            <h3 className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-3">
              Recent Game Log (last 30)
            </h3>
            <GameLogTable rows={data.gameLog} />
          </section>
        </div>
      )}
    </div>
  );
}
