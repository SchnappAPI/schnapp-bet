'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const POLL_INTERVAL_MS = 30_000;

interface LivePlayer {
  playerId: number;
  playerName: string;
  teamId: number;
  teamAbbr: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  min: number;
  fg3m: number;
  fg3a: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  starter: boolean;
  oncourt: boolean;
  starterStatus: string | null;
}

interface LiveData {
  gameId: string;
  gameStatusText: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  homeScore: number;
  awayScore: number;
  players: LivePlayer[];
}

function fmtMin(min: number): string {
  if (min === 0) return '-';
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtShoot(made: number, att: number): string {
  return att === 0 ? '-' : `${made}-${att}`;
}

function ScoreHeader({ data }: { data: LiveData }) {
  const awayLeads = data.awayScore > data.homeScore;
  const homeLeads = data.homeScore > data.awayScore;

  return (
    <div className="flex items-center justify-center gap-6 py-3 mb-4 border border-border rounded-lg bg-surface">
      <div className="text-center min-w-[60px]">
        <div className="text-xs text-fg-subtle font-semibold uppercase tracking-wider mb-0.5">
          {data.awayTeamAbbr}
        </div>
        <div className={`text-3xl font-bold tabular-nums ${awayLeads ? 'text-fg' : 'text-fg-subtle'}`}>
          {data.awayScore}
        </div>
      </div>

      <div className="text-center">
        <div className="flex items-center gap-1.5 justify-center mb-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neg opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-neg" />
          </span>
          <span className="text-xs font-semibold text-neg uppercase tracking-wider">Live</span>
        </div>
        <div className="text-sm font-semibold text-fg-muted">{data.gameStatusText}</div>
      </div>

      <div className="text-center min-w-[60px]">
        <div className="text-xs text-fg-subtle font-semibold uppercase tracking-wider mb-0.5">
          {data.homeTeamAbbr}
        </div>
        <div className={`text-3xl font-bold tabular-nums ${homeLeads ? 'text-fg' : 'text-fg-subtle'}`}>
          {data.homeScore}
        </div>
      </div>
    </div>
  );
}

function TeamTable({
  players,
  teamAbbr,
  gameId,
  selectedDate,
}: {
  players: LivePlayer[];
  teamAbbr: string;
  gameId: string;
  selectedDate: string;
}) {
  const [benchOpen, setBenchOpen] = useState(false);
  const [dnpOpen, setDnpOpen]     = useState(false);

  const hasLineup = players.some((p) => p.starter !== undefined);

  const starters   = hasLineup ? players.filter((p) => p.starter && p.min > 0) : [];
  const benchPlayed = hasLineup
    ? players.filter((p) => !p.starter && p.min > 0)
    : players.filter((p) => p.min > 0).sort((a, b) => b.min - a.min);
  const dnp        = players.filter((p) => p.min === 0);

  const renderRow = (p: LivePlayer) => {
    const href = `/nba/player/${p.playerId}?gameId=${gameId}&tab=boxscore&date=${selectedDate}`;
    return (
      <tr key={p.playerId} className="border-b border-border">
        <td className="py-1 pr-3 whitespace-nowrap">
          <Link
            href={href}
            className={`hover:text-brand transition-colors ${p.starter ? 'text-fg font-medium' : 'text-fg-muted'}`}
          >
            {p.playerName}
            {p.oncourt && (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-pos align-middle" title="On court" />
            )}
          </Link>
        </td>
        <td className="py-1 px-2 text-right text-fg-muted">{fmtMin(p.min)}</td>
        <td className="py-1 px-2 text-right text-fg font-medium">{p.pts}</td>
        <td className="py-1 px-2 text-right text-fg-muted">{p.reb}</td>
        <td className="py-1 px-2 text-right text-fg-muted">{p.ast}</td>
        <td className="py-1 px-2 text-right text-fg-muted">{p.stl}</td>
        <td className="py-1 px-2 text-right text-fg-muted">{p.blk}</td>
        <td className="py-1 px-2 text-right text-fg-muted">{p.tov}</td>
        <td className="py-1 px-2 text-right text-fg-muted tabular-nums">{fmtShoot(p.fgm, p.fga)}</td>
        <td className="py-1 px-2 text-right text-fg-muted tabular-nums">{fmtShoot(p.fg3m, p.fg3a)}</td>
        <td className="py-1 pl-2 text-right text-fg-muted tabular-nums">{fmtShoot(p.ftm, p.fta)}</td>
      </tr>
    );
  };

  const collapsibleHeader = (
    label: string,
    count: number,
    open: boolean,
    toggle: () => void,
  ) => (
    <tr>
      <td colSpan={11} className="pt-2 pb-0.5">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 text-xs text-fg-disabled font-semibold uppercase tracking-wider hover:text-fg-subtle transition-colors"
        >
          <span>{open ? '\u25bc' : '\u25b6'}</span>
          <span>{label}</span>
          <span className="text-fg-disabled font-normal normal-case tracking-normal">({count})</span>
        </button>
      </td>
    </tr>
  );

  const starterHeader = () => (
    <tr>
      <td colSpan={11} className="pt-2 pb-0.5 text-xs text-fg-disabled font-semibold uppercase tracking-wider">
        Starters
      </td>
    </tr>
  );

  return (
    <div className="overflow-x-auto">
      <div className="text-xs text-fg-subtle font-semibold uppercase tracking-wider mb-1">{teamAbbr}</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-fg-subtle border-b border-border">
            <th className="text-left py-1 pr-3 font-medium">Player</th>
            <th className="text-right py-1 px-2 font-medium">MIN</th>
            <th className="text-right py-1 px-2 font-medium">PTS</th>
            <th className="text-right py-1 px-2 font-medium">REB</th>
            <th className="text-right py-1 px-2 font-medium">AST</th>
            <th className="text-right py-1 px-2 font-medium">STL</th>
            <th className="text-right py-1 px-2 font-medium">BLK</th>
            <th className="text-right py-1 px-2 font-medium">TOV</th>
            <th className="text-right py-1 px-2 font-medium">FG</th>
            <th className="text-right py-1 px-2 font-medium">3P</th>
            <th className="text-right py-1 pl-2 font-medium">FT</th>
          </tr>
        </thead>
        <tbody>
          {hasLineup ? (
            <>
              {starters.length > 0 && starterHeader()}
              {starters.map(renderRow)}
              {benchPlayed.length > 0 && collapsibleHeader('Bench', benchPlayed.length, benchOpen, () => setBenchOpen((v) => !v))}
              {benchOpen && benchPlayed.map(renderRow)}
            </>
          ) : (
            benchPlayed.map(renderRow)
          )}
          {dnp.length > 0 && collapsibleHeader('Not yet in', dnp.length, dnpOpen, () => setDnpOpen((v) => !v))}
          {dnpOpen && dnp.map(renderRow)}
        </tbody>
      </table>
    </div>
  );
}

export default function LiveBoxScore({
  gameId,
  selectedDate,
}: {
  gameId: string;
  selectedDate: string;
}) {
  const [data, setData]               = useState<LiveData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchLive() {
    try {
      const r = await fetch(`/api/live-boxscore?gameId=${gameId}`, { cache: 'no-store' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const json = await r.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }

  useEffect(() => {
    fetchLive();
    intervalRef.current = setInterval(fetchLive, POLL_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const refreshStr = lastRefresh.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const teams = data
    ? Array.from(new Map(data.players.map((p) => [p.teamAbbr, p.teamAbbr])).keys()).map((abbr) => ({
        abbr,
        players: data.players.filter((p) => p.teamAbbr === abbr),
      }))
    : [];

  return (
    <div>
      {data && <ScoreHeader data={data} />}

      <div className="text-xs text-fg-disabled mb-3">
        Updated {refreshStr} &middot; auto-refreshes every 30s
      </div>

      {loading && <div className="text-sm text-fg-subtle">Loading...</div>}
      {error && <div className="text-sm text-neg">{error}</div>}

      {!loading && !error && teams.length > 0 && (
        <div className="flex flex-col gap-6">
          {teams.map((t) => (
            <TeamTable
              key={t.abbr}
              players={t.players}
              teamAbbr={t.abbr}
              gameId={gameId}
              selectedDate={selectedDate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
