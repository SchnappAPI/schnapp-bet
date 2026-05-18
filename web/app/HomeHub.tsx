'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { fetcher } from '@/lib/fetcher';
import { formatMarket } from '@/lib/formatMarket';
import { Chip } from '@/lib/ui/Chip';
import { PulseDot } from '@/lib/ui/PulseDot';
import { SignalGlyph, type Signal } from '@/lib/ui/SignalGlyph';
import { cn } from '@/lib/ui/cn';

// ---- Response types --------------------------------------------------------
type Game = {
  id: string;
  sport: 'nba' | 'mlb' | 'nfl';
  away: { abbr: string; name?: string };
  home: { abbr: string; name?: string };
  tipoff_iso?: string;
  status: 'scheduled' | 'live' | 'final' | 'postponed';
  live?: { period?: number | string; clock?: string; away_score?: number; home_score?: number };
  market?: { spread?: number; total?: number };
};

type GamesTodayResponse = {
  date: string;
  updated_at: string;
  sports: Record<'nba' | 'mlb' | 'nfl', { count: number; games: Game[] }>;
};

// API returns the full Signal objects from lib/signals.ts (with .type, .label, etc.).
// SignalGlyph wants just the string code, so we read .type at render time.
type ApiSignal = { type: Signal; label?: string };

type GradeRow = {
  player_id: number;
  player_name: string;
  team_abbr?: string;
  sport: 'nba' | 'mlb';
  market: string;
  line: number;
  side: 'over' | 'under';
  grade: number;
  ev_pct: number | null;
  signals: ApiSignal[];
  game_id: string | null;
};

// /api/grades/top now returns BOTH the top-N rows AND the dashboard-wide
// signal counts in one response. The legacy /api/grades/signals/today is
// retained but no longer hit from the Today Terminal.
type SignalCounts = { hot: number; cold: number; due: number; fade: number; streak: number; slump: number; longshot: number };
type GradesTopResponse = { rows: GradeRow[]; counts: SignalCounts; updated_at: string };

// ---- Component -------------------------------------------------------------
export interface HomeHubProps {
  // Server-rendered initial data. Each may be null if the server-side fetch
  // failed; SWR falls back to its normal loading flow in that case.
  initial?: {
    games: GamesTodayResponse | null;
    top: GradesTopResponse | null;
  };
}

export default function HomeHub({ initial }: HomeHubProps = {}) {
  // Two SWR fetches (was three): /api/grades/top now returns both the top
  // rows and the signal counts in one round-trip. SWR options:
  //   - fallbackData hydrates from server-rendered data, so first paint is
  //     fully populated and SWR doesn't refetch until the next interval tick.
  //   - revalidateOnFocus disabled — polling already keeps data fresh.
  //   - dedupingInterval = half the refresh cadence so render-driven extra
  //     triggers collapse into the next polling cycle.
  //   - refreshWhenHidden is false by SWR default — polling pauses when tab
  //     is in the background.
  const { data: games } = useSWR<GamesTodayResponse>('/api/games/today', fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false, dedupingInterval: 15_000,
      fallbackData: initial?.games ?? undefined });
  const { data: top }   = useSWR<GradesTopResponse>('/api/grades/top?n=10&sport=all', fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false, dedupingInterval: 30_000,
      fallbackData: initial?.top ?? undefined });

  const counts = top?.counts;
  const nbaCount = games?.sports.nba.count ?? null;
  const mlbCount = games?.sports.mlb.count ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4">
      <PageHeader />

      <KpiStrip
        nba={nbaCount}
        mlb={mlbCount}
        hot={counts?.hot}
        due={counts?.due}
        streak={counts?.streak}
        longshot={counts?.longshot}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Today's games">
          <GamesList games={games} />
        </Card>
        <Card title="Top grades">
          <TopGrades rows={top?.rows} />
        </Card>
      </div>

      <Card title="Signal activity · 24h">
        <SignalActivity counts={counts} />
      </Card>
    </div>
  );
}

// ---- Pieces ---------------------------------------------------------------
function PageHeader() {
  return (
    <div className="flex items-baseline justify-between border-b border-border-subtle pb-2">
      <h1 className="font-mono text-micro uppercase tracking-[0.18em] text-fg-subtle">Today</h1>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface">
      <header className="flex h-9 items-center border-b border-border-subtle px-3">
        <h2 className="font-mono text-micro uppercase tracking-[0.18em] text-fg-muted">{title}</h2>
      </header>
      <div>{children}</div>
    </section>
  );
}

function KpiStrip({
  nba, mlb, hot, due, streak, longshot,
}: {
  nba: number | null;
  mlb: number | null;
  hot?: number; due?: number; streak?: number; longshot?: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      <Kpi label="NBA"      value={fmt(nba)}      tone="sport-nba" />
      <Kpi label="MLB"      value={fmt(mlb)}      tone="sport-mlb" />
      <Kpi label="HOT"      value={fmt(hot)}      tone="warn"  glyph="HOT" />
      <Kpi label="DUE"      value={fmt(due)}      tone="brand" glyph="DUE" />
      <Kpi label="STREAK"   value={fmt(streak)}   tone="info"  glyph="STREAK" />
      <Kpi label="LONGSHOT" value={fmt(longshot)} tone="info"  glyph="LONGSHOT" />
    </div>
  );
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return String(n);
}

function Kpi({
  label, value, tone, glyph,
}: {
  label: string;
  value: string;
  tone: 'sport-nba' | 'sport-mlb' | 'sport-nfl' | 'warn' | 'brand' | 'info' | 'pos' | 'neg' | 'neutral';
  glyph?: Signal;
}) {
  const labelTone =
    tone === 'sport-nba' ? 'text-sport-nba' :
    tone === 'sport-mlb' ? 'text-sport-mlb' :
    tone === 'sport-nfl' ? 'text-sport-nfl' :
    tone === 'warn'      ? 'text-warn' :
    tone === 'brand'     ? 'text-brand' :
    tone === 'info'      ? 'text-info' :
    tone === 'pos'       ? 'text-pos' :
    tone === 'neg'       ? 'text-neg' :
    'text-fg-muted';

  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className={cn('flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider', labelTone)}>
        {glyph && <SignalGlyph signal={glyph} />}
        <span>{label}</span>
      </div>
      <div className="mt-1 font-mono text-data-lg tabular-nums text-fg">{value}</div>
    </div>
  );
}

function GamesList({ games }: { games?: GamesTodayResponse }) {
  if (!games) {
    return <Skeleton lines={4} />;
  }
  const all = [...games.sports.nba.games, ...games.sports.mlb.games];
  if (all.length === 0) {
    return <div className="px-3 py-4 text-body text-fg-subtle">No games today.</div>;
  }

  // Sort live first, then by tipoff
  all.sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1;
    if (b.status === 'live' && a.status !== 'live') return 1;
    return (a.tipoff_iso ?? '').localeCompare(b.tipoff_iso ?? '');
  });

  return (
    <ul className="divide-y divide-border-subtle">
      {all.map((g) => <GameRow key={`${g.sport}-${g.id}`} game={g} />)}
    </ul>
  );
}

function GameRow({ game }: { game: Game }) {
  const sportTone =
    game.sport === 'nba' ? 'sport-nba' as const :
    game.sport === 'mlb' ? 'sport-mlb' as const :
    'sport-nfl' as const;

  // Both sports deep-link via `?gameId=...&date=...`; NBA also pre-selects via NbaPageInner's auto-select logic.
  const href =
    game.sport === 'mlb'
      ? `/mlb?gameId=${encodeURIComponent(game.id)}&view=game${game.tipoff_iso ? `&date=${game.tipoff_iso.slice(0, 10)}` : ''}`
      : game.sport === 'nba'
        ? `/nba?gameId=${encodeURIComponent(game.id)}${game.tipoff_iso ? `&date=${game.tipoff_iso.slice(0, 10)}` : ''}`
        : null;

  const inner = (
    <>
      <Chip tone={sportTone} size="xs">{game.sport.toUpperCase()}</Chip>

      <div className="font-mono text-data text-fg">
        <span className="text-fg-muted">{game.away.abbr}</span>
        <span className="px-1 text-fg-subtle">@</span>
        <span className="text-fg-muted">{game.home.abbr}</span>
      </div>

      <div className="flex-1" />

      {game.status === 'live' ? (
        <span className="flex items-center gap-1.5 font-mono text-data text-fg">
          <PulseDot tone="live" />
          {game.live?.period && <span className="text-fg-subtle uppercase text-[10px]">Q{game.live.period}</span>}
          <span className="tabular-nums">{game.live?.away_score ?? 0}–{game.live?.home_score ?? 0}</span>
        </span>
      ) : game.status === 'final' ? (
        <span className="flex items-center gap-1.5 font-mono text-data text-fg-muted">
          <span className="text-[10px] uppercase tracking-wider text-fg-subtle">Final</span>
          <span className="tabular-nums">{game.live?.away_score ?? 0}–{game.live?.home_score ?? 0}</span>
        </span>
      ) : (
        <span className="flex items-center gap-2 font-mono text-data text-fg-muted">
          <span className="tabular-nums">{formatTime(game.tipoff_iso)}</span>
          {game.market?.spread !== undefined && (
            <span className="text-fg-subtle tabular-nums">
              {game.market.spread > 0 ? '+' : ''}{game.market.spread}
            </span>
          )}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <li>
        <Link
          href={href}
          className="flex items-center gap-3 px-3 py-2 hover:bg-surface-hover transition-colors duration-fast ease-precise"
        >
          {inner}
        </Link>
      </li>
    );
  }
  return <li className="flex items-center gap-3 px-3 py-2">{inner}</li>;
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '');
  } catch {
    return '—';
  }
}

function TopGrades({ rows }: { rows?: GradeRow[] }) {
  if (!rows) {
    return <Skeleton lines={6} />;
  }
  if (rows.length === 0) {
    return <div className="px-3 py-4 text-body text-fg-subtle">No grades available.</div>;
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {rows.map((r) => <GradeRowItem key={`${r.player_id}-${r.market}-${r.line}-${r.side}`} row={r} />)}
    </ul>
  );
}

function GradeRowItem({ row }: { row: GradeRow }) {
  const ev = row.ev_pct;
  const evTone = ev === null ? 'text-fg-subtle' : ev >= 0 ? 'text-pos' : 'text-neg';
  const playerHref = row.sport === 'nba' ? `/nba/player/${row.player_id}` : '#';
  const market = formatMarket(row.market);

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover">
      <Link href={playerHref} className="min-w-0 flex-1 truncate font-mono text-data text-fg hover:text-brand">
        {row.player_name}
      </Link>
      <span className="flex items-center gap-1 w-20 justify-end">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
          {market.label} {row.side === 'over' ? 'o' : 'u'}
        </span>
        {market.alt && (
          <span className="font-mono text-[8px] uppercase text-fg-disabled border border-border-subtle rounded-sm px-0.5 leading-none">
            alt
          </span>
        )}
      </span>
      <span className="font-mono text-data tabular-nums text-fg-muted w-10 text-right">{row.line}</span>
      <span className="font-mono text-data tabular-nums text-fg w-8 text-right">{row.grade}</span>
      <span className={cn('font-mono text-data tabular-nums w-14 text-right', evTone)}>
        {ev === null ? '—' : ev > 999 ? '>+999%' : ev < -999 ? '<-999%' : `${ev >= 0 ? '+' : ''}${ev.toFixed(1)}%`}
      </span>
      <span className="flex items-center gap-0.5 w-12 justify-end">
        {(row.signals ?? []).slice(0, 2).map((s) => (
          <SignalGlyph key={s.type} signal={s.type} />
        ))}
      </span>
    </li>
  );
}

function SignalActivity({ counts }: { counts?: SignalCounts }) {
  if (!counts) {
    return <div className="px-3 py-3"><Skeleton lines={1} /></div>;
  }
  const items: Array<[Signal, number]> = [
    ['HOT',      counts.hot],
    ['COLD',     counts.cold],
    ['DUE',      counts.due],
    ['FADE',     counts.fade],
    ['STREAK',   counts.streak],
    ['SLUMP',    counts.slump],
    ['LONGSHOT', counts.longshot],
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-3">
      {items.map(([sig, n]) => (
        <span key={sig} className="flex items-center gap-1.5 font-mono text-[11px]">
          <SignalGlyph signal={sig} showLabel />
          <span className="tabular-nums text-fg">{n}</span>
        </span>
      ))}
    </div>
  );
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-border-subtle" style={{ width: `${60 + (i * 8) % 30}%` }} />
      ))}
    </div>
  );
}
