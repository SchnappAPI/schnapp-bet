'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import type { ColumnDef } from '@tanstack/react-table';
import { fetcher } from '@/lib/fetcher';
import { DataTable } from '@/lib/ui/DataTable';

// ---- API response types -------------------------------------------------

type SeasonType = 'REG' | 'POST';

interface NflGame {
  gameId: string;
  season: number;
  gameType: string;
  week: number;
  gameDate: string | null;
  weekday: string | null;
  gametime: string | null; // 'HH:MM' Eastern
  awayTeam: string;
  awayScore: number | null;
  homeTeam: string;
  homeScore: number | null;
  spreadLine: number | null; // positive = home favored
  totalLine: number | null;
  awayMoneyline: number | null;
  homeMoneyline: number | null;
  overtime: number | null;
}

interface NflGamesResponse {
  season: number;
  seasonType: SeasonType;
  week: number | null;
  seasons: number[];
  weeks: number[];
  games: NflGame[];
}

interface NflStatRow {
  playerId: string;
  playerName: string | null;
  position: string | null;
  team: string | null;
  opponent: string | null;
  completions: number | null;
  attempts: number | null;
  passYds: number | null;
  passTd: number | null;
  passInt: number | null;
  carries: number | null;
  rushYds: number | null;
  rushTd: number | null;
  targets: number | null;
  receptions: number | null;
  recYds: number | null;
  recTd: number | null;
  fantasyPoints: number | null;
  fantasyPointsPpr: number | null;
}

interface NflStatsResponse {
  season: number | null;
  seasonType: SeasonType;
  week: number | null;
  rows: NflStatRow[];
}

// ---- Formatting helpers ---------------------------------------------------

const PLAYOFF_WEEK_LABELS: Record<number, string> = {
  19: 'WC',
  20: 'DIV',
  21: 'CON',
  22: 'SB',
};

function weekLabel(week: number, seasonType: SeasonType): string {
  if (seasonType === 'POST') return PLAYOFF_WEEK_LABELS[week] ?? `W${week}`;
  return `Week ${week}`;
}

// '13:00' (Eastern, from nflverse) -> '1:00 PM ET'
function formatKick(gametime: string | null): string {
  if (!gametime) return '';
  const [hStr, mStr] = gametime.split(':');
  const h = parseInt(hStr, 10);
  if (isNaN(h)) return gametime;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr ?? '00'} ${suffix} ET`;
}

// '2026-09-13' + 'Sunday' -> 'Sunday 9/13'
function dayLabel(game: NflGame): string {
  if (!game.gameDate) return game.weekday ?? 'TBD';
  const [, m, d] = game.gameDate.split('-').map(Number);
  const md = m && d ? `${m}/${d}` : game.gameDate;
  return game.weekday ? `${game.weekday} ${md}` : md;
}

function fmtSpread(game: NflGame): string {
  if (game.spreadLine == null) return '';
  if (game.spreadLine === 0) return 'PK';
  return game.spreadLine > 0
    ? `${game.homeTeam} -${game.spreadLine}`
    : `${game.awayTeam} -${Math.abs(game.spreadLine)}`;
}

function isFinal(game: NflGame): boolean {
  return game.awayScore != null && game.homeScore != null;
}

// ---- Game card ------------------------------------------------------------

function GameCard({ game }: { game: NflGame }) {
  const final = isFinal(game);
  const awayWin = final && game.awayScore! > game.homeScore!;
  const homeWin = final && game.homeScore! > game.awayScore!;

  return (
    <div className="flex items-start justify-between gap-4 rounded border border-border bg-surface px-3 py-2">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-mono ${awayWin ? 'font-semibold text-fg' : 'text-fg-subtle'}`}>
            {game.awayTeam}
          </span>
          {game.awayScore != null && (
            <span className={`text-sm tabular-nums ${awayWin ? 'font-semibold text-fg' : 'text-fg-subtle'}`}>
              {game.awayScore}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-mono ${homeWin ? 'font-semibold text-fg' : 'text-fg-subtle'}`}>
            {game.homeTeam}
          </span>
          {game.homeScore != null && (
            <span className={`text-sm tabular-nums ${homeWin ? 'font-semibold text-fg' : 'text-fg-subtle'}`}>
              {game.homeScore}
            </span>
          )}
        </div>
      </div>
      <div className="text-right flex-none">
        {final ? (
          <div className="text-xs text-fg-subtle">
            Final{game.overtime ? ' (OT)' : ''}
          </div>
        ) : (
          <>
            <div className="text-xs text-fg-subtle">{formatKick(game.gametime)}</div>
            <div className="mt-1 font-mono text-[11px] text-fg-disabled tabular-nums">
              {fmtSpread(game)}
              {game.spreadLine != null && game.totalLine != null && ' · '}
              {game.totalLine != null && `O/U ${game.totalLine}`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Player stats table -----------------------------------------------------

type PosTab = 'ALL' | 'QB' | 'RB' | 'WR/TE';
const POS_TABS: PosTab[] = ['ALL', 'QB', 'RB', 'WR/TE'];

function matchesTab(pos: string | null, tab: PosTab): boolean {
  if (tab === 'ALL') return true;
  const p = (pos ?? '').toUpperCase();
  if (tab === 'QB') return p === 'QB';
  if (tab === 'RB') return p === 'RB' || p === 'FB';
  return p === 'WR' || p === 'TE';
}

function num(v: number | null): string {
  return v == null ? '0' : String(v);
}

function fpts(v: number | null): string {
  return v == null ? '—' : v.toFixed(1);
}

function buildColumns(tab: PosTab): ColumnDef<NflStatRow, unknown>[] {
  const player: ColumnDef<NflStatRow, unknown> = {
    accessorKey: 'playerName',
    header: 'Player',
    size: 170,
    cell: ({ row }) => (
      <span className="truncate font-medium text-fg">{row.original.playerName ?? row.original.playerId}</span>
    ),
  };
  const team: ColumnDef<NflStatRow, unknown> = {
    accessorKey: 'team',
    header: 'Team',
    size: 56,
    cell: ({ row }) => <span className="text-sport-nfl">{row.original.team ?? ''}</span>,
  };
  const pos: ColumnDef<NflStatRow, unknown> = {
    accessorKey: 'position',
    header: 'Pos',
    size: 44,
  };
  const opp: ColumnDef<NflStatRow, unknown> = {
    accessorKey: 'opponent',
    header: 'Opp',
    size: 52,
    cell: ({ row }) => <span className="text-fg-subtle">{row.original.opponent ?? ''}</span>,
  };
  const cmpAtt: ColumnDef<NflStatRow, unknown> = {
    id: 'cmpAtt',
    header: 'Cmp/Att',
    size: 72,
    cell: ({ row }) => `${num(row.original.completions)}/${num(row.original.attempts)}`,
  };
  const passing: ColumnDef<NflStatRow, unknown>[] = [
    { accessorKey: 'passYds', header: 'PaYds', size: 60, cell: ({ row }) => num(row.original.passYds) },
    { accessorKey: 'passTd', header: 'PaTD', size: 52, cell: ({ row }) => num(row.original.passTd) },
    { accessorKey: 'passInt', header: 'Int', size: 44, cell: ({ row }) => num(row.original.passInt) },
  ];
  const rushing: ColumnDef<NflStatRow, unknown>[] = [
    { accessorKey: 'carries', header: 'Car', size: 44, cell: ({ row }) => num(row.original.carries) },
    { accessorKey: 'rushYds', header: 'RuYds', size: 60, cell: ({ row }) => num(row.original.rushYds) },
    { accessorKey: 'rushTd', header: 'RuTD', size: 52, cell: ({ row }) => num(row.original.rushTd) },
  ];
  const receiving: ColumnDef<NflStatRow, unknown>[] = [
    { accessorKey: 'targets', header: 'Tgt', size: 44, cell: ({ row }) => num(row.original.targets) },
    { accessorKey: 'receptions', header: 'Rec', size: 44, cell: ({ row }) => num(row.original.receptions) },
    { accessorKey: 'recYds', header: 'ReYds', size: 60, cell: ({ row }) => num(row.original.recYds) },
    { accessorKey: 'recTd', header: 'ReTD', size: 52, cell: ({ row }) => num(row.original.recTd) },
  ];
  const fantasy: ColumnDef<NflStatRow, unknown> = {
    accessorKey: 'fantasyPointsPpr',
    header: 'FPts',
    size: 56,
    cell: ({ row }) => fpts(row.original.fantasyPointsPpr),
  };

  if (tab === 'QB') return [player, team, opp, cmpAtt, ...passing, ...rushing, fantasy];
  if (tab === 'RB') return [player, team, opp, ...rushing, ...receiving, fantasy];
  if (tab === 'WR/TE') return [player, team, pos, opp, ...receiving, ...rushing.slice(1), fantasy];
  return [player, team, pos, opp, cmpAtt, ...passing, ...rushing, ...receiving, fantasy];
}

// ---- Page -------------------------------------------------------------------

export default function NflPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL is the source of truth for the selection. Missing params mean
  // "auto": the games API resolves the latest season and the current/next
  // week server-side, and the response backfills the picker display.
  const urlSeason = searchParams.get('season');
  const urlWeek = searchParams.get('week');
  const urlType = searchParams.get('type');
  const selType: SeasonType = urlType?.toUpperCase() === 'POST' ? 'POST' : 'REG';

  const gamesQs = new URLSearchParams();
  if (urlSeason) gamesQs.set('season', urlSeason);
  if (urlWeek) gamesQs.set('week', urlWeek);
  if (urlType) gamesQs.set('season_type', selType);
  const gamesQsStr = gamesQs.toString();
  const gamesKey = `/api/nfl/games${gamesQsStr ? `?${gamesQsStr}` : ''}`;

  const {
    data: gamesData,
    error: gamesError,
    isLoading: gamesLoading,
  } = useSWR<NflGamesResponse>(gamesKey, fetcher, { revalidateOnFocus: false });

  // Resolved selection (explicit URL value, else server default).
  const season = urlSeason ? parseInt(urlSeason, 10) : gamesData?.season;
  const week = urlWeek ? parseInt(urlWeek, 10) : (gamesData?.week ?? undefined);
  const seasonType: SeasonType = urlType ? selType : (gamesData?.seasonType ?? 'REG');

  const statsKey =
    season != null && week != null
      ? `/api/nfl/player-stats?season=${season}&week=${week}&season_type=${seasonType}`
      : null;
  const {
    data: statsData,
    error: statsError,
    isLoading: statsLoading,
  } = useSWR<NflStatsResponse>(statsKey, fetcher, { revalidateOnFocus: false });

  const [posTab, setPosTab] = useState<PosTab>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('');

  function applySelection(next: { season?: number; week?: number; type?: SeasonType }) {
    const params = new URLSearchParams(searchParams.toString());
    const s = next.season ?? season;
    const t = next.type ?? seasonType;
    if (s != null) params.set('season', String(s));
    params.set('type', t);
    // Changing season or season type invalidates the week — drop it and let
    // the API pick the right default for the new slate.
    if (next.week != null && next.season == null && next.type == null) {
      params.set('week', String(next.week));
    } else {
      params.delete('week');
    }
    setTeamFilter('');
    router.replace(`/nfl?${params.toString()}`);
  }

  const weeks = gamesData?.weeks ?? [];
  const weekIdx = week != null ? weeks.indexOf(week) : -1;

  const games = gamesData?.games ?? [];
  const gamesByDay = useMemo(() => {
    const groups: { label: string; games: NflGame[] }[] = [];
    for (const g of games) {
      const label = dayLabel(g);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.games.push(g);
      else groups.push({ label, games: [g] });
    }
    return groups;
  }, [games]);

  const allRows = statsData?.rows ?? [];
  const teams = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.team).filter((t): t is string => !!t))).sort(),
    [allRows],
  );
  const rows = useMemo(
    () =>
      allRows.filter(
        (r) => matchesTab(r.position, posTab) && (!teamFilter || r.team === teamFilter),
      ),
    [allRows, posTab, teamFilter],
  );
  const columns = useMemo(() => buildColumns(posTab), [posTab]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header — season / type / week picker */}
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-sport-nfl">
          NFL
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <select
            value={season ?? ''}
            onChange={(e) => applySelection({ season: parseInt(e.target.value, 10) })}
            className="text-sm bg-surface border border-border rounded px-2 py-1 text-fg-muted focus:outline-none focus:border-border-strong cursor-pointer"
            aria-label="Season"
          >
            {(gamesData?.seasons ?? (season != null ? [season] : [])).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="flex items-center rounded border border-border overflow-hidden">
            {(['REG', 'POST'] as SeasonType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => applySelection({ type: t })}
                className={`px-3 py-1 text-xs font-mono uppercase tracking-wide transition-colors ${
                  seasonType === t
                    ? 'bg-sport-nfl/15 text-sport-nfl'
                    : 'text-fg-subtle hover:text-fg'
                }`}
              >
                {t === 'REG' ? 'Regular' : 'Playoffs'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => weekIdx > 0 && applySelection({ week: weeks[weekIdx - 1] })}
              disabled={weekIdx <= 0}
              className="px-2 py-1 text-fg-subtle hover:text-fg-muted disabled:opacity-30 text-base leading-none"
              aria-label="Previous week"
            >
              &#8249;
            </button>
            <select
              value={week ?? ''}
              onChange={(e) => applySelection({ week: parseInt(e.target.value, 10) })}
              className="text-sm bg-surface border border-border rounded px-2 py-1 text-fg-muted focus:outline-none focus:border-border-strong cursor-pointer"
              aria-label="Week"
            >
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {weekLabel(w, seasonType)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                weekIdx >= 0 && weekIdx < weeks.length - 1 && applySelection({ week: weeks[weekIdx + 1] })
              }
              disabled={weekIdx < 0 || weekIdx >= weeks.length - 1}
              className="px-2 py-1 text-fg-subtle hover:text-fg-muted disabled:opacity-30 text-base leading-none"
              aria-label="Next week"
            >
              &#8250;
            </button>
          </div>
        </div>
      </div>

      {/* Games — week slate */}
      <div className="px-4 py-4">
        {gamesLoading && <div className="text-sm text-fg-subtle">Loading...</div>}
        {gamesError && <div className="text-sm text-neg">Error loading games.</div>}
        {!gamesLoading && !gamesError && games.length === 0 && (
          <div className="text-sm text-fg-subtle">No games for this week.</div>
        )}
        {games.length > 0 && (
          <div className="flex flex-col gap-4">
            {gamesByDay.map((group) => (
              <div key={group.label}>
                <div className="pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
                  {group.label}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.games.map((g) => (
                    <GameCard key={g.gameId} game={g} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Player stats */}
      <div className="px-4 pb-6 flex-1">
        <div className="flex flex-wrap items-center gap-3 border-b border-border pb-0 mb-3">
          <div className="flex items-end gap-4">
            {POS_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setPosTab(tab)}
                className={`relative -mb-px py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
                  posTab === tab
                    ? 'text-sport-nfl border-b-2 border-sport-nfl'
                    : 'text-fg-subtle hover:text-fg border-b-2 border-transparent'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="ml-auto pb-1.5">
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="text-xs bg-surface border border-border rounded px-2 py-1 text-fg-muted focus:outline-none focus:border-border-strong cursor-pointer"
              aria-label="Team filter"
            >
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {statsLoading && <div className="text-sm text-fg-subtle">Loading stats...</div>}
        {statsError && <div className="text-sm text-neg">Error loading player stats.</div>}
        {!statsLoading && !statsError && statsKey != null && (
          <DataTable<NflStatRow>
            columns={columns}
            data={rows}
            className="max-h-[65vh]"
            emptyMessage={
              week != null && weeks.length > 0
                ? 'No player stats for this week yet.'
                : 'No player stats.'
            }
          />
        )}
      </div>
    </div>
  );
}
