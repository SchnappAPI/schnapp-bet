'use client';

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { formatMarket } from '@/lib/formatMarket';
import { getSignals, type Signal as SignalDef } from '@/lib/signals';
import { Chip } from '@/lib/ui/Chip';
import { SignalGlyph, type Signal as SignalCode } from '@/lib/ui/SignalGlyph';
import { Sparkline } from '@/lib/ui/Sparkline';
import { Tooltip } from '@/lib/ui/Tooltip';
import { cn } from '@/lib/ui/cn';

// ---- Response shape (subset we read) --------------------------------------
interface GradeRowApi {
  gradeId: number;
  gradeDate: string;
  playerId: number;
  playerName: string;
  marketKey: string;
  lineValue: number;
  outcomeName: string;
  overPrice: number | null;
  hitRate60: number | null;
  hitRate20: number | null;
  sampleSize60: number | null;
  sampleSize20: number | null;
  weightedHitRate: number | null;
  grade: number | null;
  compositeGrade: number | null;
  trendGrade: number | null;
  momentumGrade: number | null;
  matchupGrade: number | null;
  regressionGrade: number | null;
  hitRateOpp: number | null;
  sampleSizeOpp: number | null;
  oppTeamAbbr: string | null;
  position: string | null;
  gameId: string | null;
  homeTeamAbbr: string | null;
  awayTeamAbbr: string | null;
  outcome: string | null;
  link: string | null;
  evPct: number | null;
}

interface GradesResponse {
  rows: GradeRowApi[];
  params: { sport: string; date: string; gameId: string | null };
  updated_at: string;
}

// Each table row carries the original API row plus pre-computed signals.
interface TableRow extends GradeRowApi {
  signals: SignalCode[];
  effectiveGrade: number;
  team: string | null;
}

// ---- Component ------------------------------------------------------------
export interface PropMatrixV2Props {
  date?: string;
  className?: string;
}

export default function PropMatrixV2({ date, className }: PropMatrixV2Props) {
  const dateParam = date ? `&date=${date}` : '';
  const { data, error, isLoading } = useSWR<GradesResponse>(
    `/api/grades?sport=nba${dateParam}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false, dedupingInterval: 30_000 }
  );

  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Pre-compute per-row signals + effectiveGrade + team. Memoized — signal
  // derivation is pure but non-trivial across thousands of rows.
  const rows: TableRow[] = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.map((r) => ({
      ...r,
      team: r.homeTeamAbbr && r.awayTeamAbbr
        ? (r.position ? r.homeTeamAbbr : r.awayTeamAbbr) // placeholder — we don't know which side from the API
        : (r.homeTeamAbbr ?? r.awayTeamAbbr ?? null),
      signals: deriveSignalCodes(r),
      effectiveGrade: r.evPct ?? r.compositeGrade ?? r.grade ?? 0,
    }));
  }, [data]);

  if (error) {
    return <div className={cn('rounded-md border border-border bg-surface p-4 text-body text-neg', className)}>
      Failed to load grades. {error instanceof Error ? error.message : ''}
    </div>;
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Header date={data?.params.date} updatedAt={data?.updated_at} rowCount={rows.length} loading={isLoading} />
      {mobile ? <CardList rows={rows} /> : <Table rows={rows} />}
    </div>
  );
}

// ---- Header strip ---------------------------------------------------------
function Header({
  date, updatedAt, rowCount, loading,
}: { date?: string; updatedAt?: string; rowCount: number; loading: boolean }) {
  const updated = updatedAt ? formatRelative(updatedAt) : null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
      <Chip tone="sport-nba" size="sm">NBA</Chip>
      <span className="font-mono text-micro uppercase text-fg-muted">At-a-Glance</span>
      {date && (
        <span className="font-mono text-data tabular-nums text-fg-muted">{date}</span>
      )}
      <div className="flex-1" />
      <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
        {loading ? 'loading…' : `${rowCount.toLocaleString()} rows`}
      </span>
      {updated && (
        <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
          updated {updated}
        </span>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  } catch {
    return iso;
  }
}

// ---- Table (TanStack + virtualization) ------------------------------------
function Table({ rows }: { rows: TableRow[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'effectiveGrade', desc: true }]);

  const columns = useMemo<ColumnDef<TableRow>[]>(() => [
    {
      id: 'player',
      accessorFn: (r) => r.playerName,
      header: 'Player',
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/nba/player/${row.original.playerId}`}
            className="truncate font-mono text-data text-fg hover:text-brand"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {row.original.playerName}
          </Link>
          {row.original.position && (
            <span className="font-mono text-[10px] uppercase text-fg-subtle">{row.original.position}</span>
          )}
        </div>
      ),
      size: 160,
    },
    {
      id: 'matchup',
      accessorFn: (r) => `${r.awayTeamAbbr ?? ''}-${r.homeTeamAbbr ?? ''}`,
      header: 'Matchup',
      cell: ({ row }) => (
        <span className="font-mono text-data text-fg-muted tabular-nums">
          {row.original.awayTeamAbbr ?? '—'}
          <span className="text-fg-subtle px-1">@</span>
          {row.original.homeTeamAbbr ?? '—'}
        </span>
      ),
      size: 90,
    },
    {
      id: 'market',
      accessorFn: (r) => r.marketKey,
      header: 'Market',
      cell: ({ row }) => {
        const { label, alt } = formatMarket(row.original.marketKey);
        return (
          <span className="flex items-center gap-1">
            <span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">{label}</span>
            {alt && (
              <span className="font-mono text-[9px] uppercase tracking-wider text-fg-disabled px-1 border border-border-subtle rounded-sm leading-none">
                alt
              </span>
            )}
          </span>
        );
      },
      size: 100,
    },
    {
      id: 'side',
      accessorFn: (r) => r.outcomeName,
      header: 'Side',
      cell: ({ row }) => (
        <span className="font-mono text-data uppercase text-fg-muted">{row.original.outcomeName}</span>
      ),
      size: 60,
    },
    {
      id: 'line',
      accessorFn: (r) => r.lineValue,
      header: 'Line',
      cell: ({ row }) => (
        <span className="font-mono text-data tabular-nums text-fg">{row.original.lineValue}</span>
      ),
      size: 60,
    },
    {
      id: 'odds',
      accessorFn: (r) => r.overPrice,
      header: 'Odds',
      cell: ({ row }) => {
        const odds = row.original.overPrice;
        if (odds === null) return <span className="text-fg-disabled">—</span>;
        return (
          <span className="font-mono text-data tabular-nums text-fg-muted">
            {odds > 0 ? `+${odds}` : odds}
          </span>
        );
      },
      size: 70,
    },
    {
      id: 'effectiveGrade',
      accessorFn: (r) => r.effectiveGrade,
      header: 'Grade',
      cell: ({ row }) => {
        const g = row.original.compositeGrade ?? row.original.grade;
        if (g === null) return <span className="text-fg-disabled">—</span>;
        const tone = g >= 75 ? 'text-pos' : g >= 60 ? 'text-fg' : g >= 40 ? 'text-fg-muted' : 'text-fg-subtle';
        return <span className={cn('font-mono text-data tabular-nums', tone)}>{g.toFixed(0)}</span>;
      },
      size: 70,
    },
    {
      id: 'evPct',
      accessorFn: (r) => r.evPct,
      header: 'EV%',
      cell: ({ row }) => {
        const ev = row.original.evPct;
        if (ev === null) return <span className="text-fg-disabled">—</span>;
        const tone = ev >= 0 ? 'text-pos' : 'text-neg';
        return <span className={cn('font-mono text-data tabular-nums', tone)}>{ev >= 0 ? '+' : ''}{ev.toFixed(1)}%</span>;
      },
      size: 80,
    },
    {
      id: 'hitRate60',
      accessorFn: (r) => r.hitRate60,
      header: 'HR60',
      cell: ({ row }) => {
        const hr = row.original.hitRate60;
        if (hr === null) return <span className="text-fg-disabled">—</span>;
        return <span className="font-mono text-data tabular-nums text-fg-muted">{(hr * 100).toFixed(0)}%</span>;
      },
      size: 70,
    },
    {
      id: 'sample60',
      accessorFn: (r) => r.sampleSize60,
      header: 'N',
      cell: ({ row }) => (
        <span className="font-mono text-data tabular-nums text-fg-subtle">{row.original.sampleSize60 ?? '—'}</span>
      ),
      size: 50,
    },
    {
      id: 'signals',
      accessorFn: (r) => r.signals.length,
      header: 'Signals',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex items-center gap-1">
          {row.original.signals.length === 0 && <span className="text-fg-disabled">—</span>}
          {row.original.signals.map((s) => (
            <SignalGlyph key={s} signal={s} />
          ))}
        </span>
      ),
      size: 110,
    },
    {
      id: 'fd',
      accessorFn: (r) => r.link ?? '',
      header: 'FD',
      enableSorting: false,
      cell: ({ row }) => {
        if (!row.original.link) return <span className="text-fg-disabled">—</span>;
        return (
          <a
            href={row.original.link}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] uppercase tracking-wider text-brand hover:text-brand-hover"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            bet ↗
          </a>
        );
      },
      size: 60,
    },
  ], []);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const sortedRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  return (
    <div
      ref={containerRef}
      className="relative max-h-[calc(100vh-12rem)] w-full overflow-auto rounded-md border border-border bg-surface"
    >
      <table className="w-full border-separate font-mono text-data tabular-nums" style={{ borderSpacing: 0 }}>
        <thead className="sticky top-0 z-30 bg-raised">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header, i) => {
                const sort = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                return (
                  <th
                    key={header.id}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    className={cn(
                      'h-8 border-b border-border px-2 text-left text-micro uppercase text-fg-muted font-medium bg-raised whitespace-nowrap',
                      canSort && 'cursor-pointer hover:text-fg select-none',
                      i === 0 && 'sticky left-0 z-40 border-r border-border'
                    )}
                    style={{ width: header.column.getSize() }}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sort === 'asc' && <span className="text-brand">▲</span>}
                      {sort === 'desc' && <span className="text-brand">▼</span>}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody style={{ height: `${totalHeight}px`, position: 'relative' }}>
          {sortedRows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="h-12 text-center text-body text-fg-subtle">
                No grades for this date.
              </td>
            </tr>
          )}
          {virtualItems.map((vRow) => {
            const row = sortedRows[vRow.index];
            const outcomeBg =
              row.original.outcome === 'Won' ? 'bg-pos-muted' :
              row.original.outcome === 'Lost' ? 'bg-neg-muted' :
              '';
            return (
              <RowSparklineTooltip
                key={row.id}
                playerId={row.original.playerId}
                marketKey={row.original.marketKey}
                line={row.original.lineValue}
              >
                <tr
                  className={cn(
                    'absolute left-0 right-0 flex w-full border-b border-border-subtle hover:bg-surface-hover',
                    outcomeBg
                  )}
                  style={{
                    height: '28px',
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  {row.getVisibleCells().map((cell, i) => (
                    <td
                      key={cell.id}
                      className={cn(
                        'flex items-center px-2 text-fg whitespace-nowrap',
                        i === 0 && 'sticky left-0 z-10 bg-surface border-r border-border'
                      )}
                      style={{ width: cell.column.getSize(), flex: '0 0 auto' }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              </RowSparklineTooltip>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Mobile card list (< 768px) -------------------------------------------
function CardList({ rows }: { rows: TableRow[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.effectiveGrade ?? -Infinity) - (a.effectiveGrade ?? -Infinity)),
    [rows]
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-4 text-center text-body text-fg-subtle">
        No grades for this date.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((r) => <Card key={r.gradeId} row={r} />)}
    </div>
  );
}

function Card({ row }: { row: TableRow }) {
  const { label: marketLabel, alt } = formatMarket(row.marketKey);
  const grade = row.compositeGrade ?? row.grade;
  const ev = row.evPct;
  const evTone = ev === null ? 'text-fg-subtle' : ev >= 0 ? 'text-pos' : 'text-neg';
  const evDisplay =
    ev === null ? '—'
    : ev > 999 ? '>+999%'
    : ev < -999 ? '<-999%'
    : `${ev >= 0 ? '+' : ''}${ev.toFixed(1)}%`;
  const gradeTone =
    grade === null ? 'text-fg-disabled'
    : grade >= 75 ? 'text-pos'
    : grade >= 60 ? 'text-fg'
    : grade >= 40 ? 'text-fg-muted'
    : 'text-fg-subtle';

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3 hover:bg-surface-hover">
      {/* Row 1: player + position · matchup */}
      <div className="flex items-center gap-2">
        <Link
          href={`/nba/player/${row.playerId}`}
          className="truncate font-mono text-data text-fg hover:text-brand"
        >
          {row.playerName}
        </Link>
        {row.position && (
          <span className="font-mono text-[10px] uppercase text-fg-subtle">{row.position}</span>
        )}
        <div className="flex-1" />
        <span className="font-mono text-[11px] tabular-nums text-fg-muted">
          {row.awayTeamAbbr ?? '—'}
          <span className="text-fg-subtle px-1">@</span>
          {row.homeTeamAbbr ?? '—'}
        </span>
      </div>

      {/* Row 2: market · alt · side · line · odds · bet link */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">{marketLabel}</span>
        {alt && (
          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-disabled px-1 border border-border-subtle rounded-sm leading-none">
            alt
          </span>
        )}
        <span className="font-mono text-data uppercase text-fg-muted">{row.outcomeName}</span>
        <span className="font-mono text-data tabular-nums text-fg">{row.lineValue}</span>
        {row.overPrice !== null && (
          <span className="font-mono text-data tabular-nums text-fg-muted">
            {row.overPrice > 0 ? `+${row.overPrice}` : row.overPrice}
          </span>
        )}
        <div className="flex-1" />
        {row.link && (
          <a
            href={row.link}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] uppercase tracking-wider text-brand hover:text-brand-hover"
          >
            bet ↗
          </a>
        )}
      </div>

      {/* Row 3: grade · EV% · HR60 · N · signals */}
      <div className="flex items-center gap-3 border-t border-border-subtle pt-1.5">
        <span className="flex items-center gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">G</span>
          <span className={cn('font-mono text-data tabular-nums', gradeTone)}>
            {grade === null ? '—' : grade.toFixed(0)}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">EV</span>
          <span className={cn('font-mono text-data tabular-nums', evTone)}>{evDisplay}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">HR60</span>
          <span className="font-mono text-data tabular-nums text-fg-muted">
            {row.hitRate60 === null ? '—' : `${(row.hitRate60 * 100).toFixed(0)}%`}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">N</span>
          <span className="font-mono text-data tabular-nums text-fg-subtle">
            {row.sampleSize60 ?? '—'}
          </span>
        </span>
        <div className="flex-1" />
        <span className="flex items-center gap-1">
          {row.signals.map((s) => <SignalGlyph key={s} signal={s} />)}
        </span>
      </div>
    </div>
  );
}

// ---- Row hover tooltip: lazy-fetched 10-game sparkline --------------------
function RowSparklineTooltip({
  playerId,
  marketKey,
  line,
  children,
}: {
  playerId: number;
  marketKey: string;
  line: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const token = formatMarket(marketKey).label;
  const { data } = useSWR<{ points: Array<{ value: number | null }> }>(
    open ? `/api/player/${playerId}/history?market=${token}&n=10` : null,
    fetcher
  );
  const points = (data?.points ?? [])
    .map((r) => r.value)
    .filter((v): v is number => v != null);

  return (
    <Tooltip
      onOpenChange={setOpen}
      side="right"
      align="center"
      content={
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            Last {points.length || '…'} · {token} · line {line}
          </div>
          {!data ? (
            <div className="font-mono text-[11px] text-fg-subtle">loading…</div>
          ) : points.length === 0 ? (
            <div className="font-mono text-[11px] text-fg-subtle">no history</div>
          ) : (
            <Sparkline data={points} baseline={line} width={120} height={28} className="text-brand" />
          )}
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

// ---- Signal derivation (lib/signals.ts → SignalGlyph codes) ---------------
function deriveSignalCodes(r: GradeRowApi): SignalCode[] {
  // lib/signals.ts expects FullRowSignalInputs. The GradeRow shape we
  // receive matches that contract by field name — no remapping needed.
  const result: SignalDef[] = getSignals({
    trendGrade: r.trendGrade,
    regressionGrade: r.regressionGrade,
    momentumGrade: r.momentumGrade,
    overPrice: r.overPrice,
    hitRate60: r.hitRate60,
    hitRate20: r.hitRate20,
  });
  return result.map((s) => s.type as SignalCode);
}
