'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MlbGameTabs from './MlbGameTabs';
import MlbVsView from './MlbVsView';
import MlbEvView from './MlbEvView';
import MlbPlayerView from './MlbPlayerView';
import MlbPitcherView from './MlbPitcherView';
import MlbProjView from './MlbProjView';

interface MlbGame {
  gameId: number;
  gameDate: string;
  gameStatus: string | null;
  gameDisplay: string;
  awayTeamId: number;
  homeTeamId: number;
  awayTeamAbbr: string;
  homeTeamAbbr: string;
  awayTeamName: string;
  homeTeamName: string;
  awayScore: number | null;
  homeScore: number | null;
  gameDateTime: string | null;
  awayPitcher: string | null;
  homePitcher: string | null;
}

type ViewKey = 'game' | 'vs' | 'ev' | 'proj' | 'player' | 'pitcher';

const VIEWS: { key: ViewKey; label: string; enabled: boolean }[] = [
  { key: 'game',    label: 'Game',    enabled: true  },
  { key: 'vs',      label: 'VS',      enabled: true  },
  { key: 'ev',      label: 'EV',      enabled: true  },
  { key: 'proj',    label: 'Proj',    enabled: true  },
  { key: 'player',  label: 'Player',  enabled: true  },
  { key: 'pitcher', label: 'Pitcher', enabled: true  },
];

function parseView(raw: string | null): ViewKey {
  if (!raw) return 'game';
  const match = VIEWS.find((v) => v.key === raw);
  return match && match.enabled ? (raw as ViewKey) : 'game';
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatGameTime(isoStr: string | null): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' CT';
  } catch {
    return '';
  }
}

function statusLabel(game: MlbGame): string {
  if (game.gameStatus === 'F' || game.gameStatus === 'Final') return 'Final';
  if (game.gameStatus && game.gameStatus !== 'Preview') return game.gameStatus;
  return formatGameTime(game.gameDateTime);
}

// Build a URL that preserves existing params and overrides only the ones
// passed in. The page has three URL params (date, gameId, view) and any
// navigation needs to keep the other two intact.
function buildUrl(current: URLSearchParams, patch: Record<string, string | null>): string {
  const next = new URLSearchParams(current.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return qs.length > 0 ? `/mlb?${qs}` : '/mlb';
}

export default function MlbPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlDate = searchParams.get('date');
  const [selectedDate, setSelectedDate] = useState<string>(urlDate ?? todayLocal());
  const [games, setGames] = useState<MlbGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isExplicitSelection = useRef(false);

  const activeGameId = searchParams.get('gameId');
  const activeGame = games.find((g) => String(g.gameId) === activeGameId) ?? null;
  const activeView = parseView(searchParams.get('view'));

  async function loadGames() {
    setLoading(true);
    setError(null);
    setGames([]);
    try {
      const res = await fetch(`/api/mlb-games?date=${selectedDate}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const sorted: MlbGame[] = (data.games ?? []).sort((a: MlbGame, b: MlbGame) => {
        const aTime = a.gameDateTime ?? '';
        const bTime = b.gameDateTime ?? '';
        return aTime.localeCompare(bTime);
      });
      setGames(sorted);

      const currentId = searchParams.get('gameId');
      const currentValid = sorted.find((g) => String(g.gameId) === currentId);
      if (!currentValid && sorted.length > 0 && !isExplicitSelection.current) {
        const pick = sorted.find((g) => g.gameStatus !== 'F') ?? sorted[0];
        router.replace(buildUrl(searchParams, {
          gameId: String(pick.gameId),
          date: selectedDate,
        }));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadGames(); }, [selectedDate]);

  function handleSelectGame(gameId: number) {
    isExplicitSelection.current = true;
    router.replace(buildUrl(searchParams, {
      gameId: String(gameId),
      date: selectedDate,
    }));
  }

  function applyDate(newDate: string) {
    isExplicitSelection.current = false;
    setSelectedDate(newDate);
    // Drop gameId when changing dates; the loader will pick the first
    // non-Final game from the new slate. View stays.
    router.replace(buildUrl(searchParams, {
      date: newDate,
      gameId: null,
    }));
  }

  function handleSelectView(v: ViewKey) {
    router.replace(buildUrl(searchParams, { view: v }));
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-fg-subtle uppercase tracking-wider">MLB</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => applyDate(shiftDate(selectedDate, -1))}
            className="px-2 py-1 text-fg-subtle hover:text-fg-muted text-base leading-none"
            aria-label="Previous day"
          >
            &#8249;
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => applyDate(e.target.value)}
            className="text-sm bg-surface border border-border rounded px-2 py-1 text-fg-muted focus:outline-none focus:border-border-strong cursor-pointer"
          />
          <button
            onClick={() => applyDate(shiftDate(selectedDate, 1))}
            className="px-2 py-1 text-fg-subtle hover:text-fg-muted text-base leading-none"
            aria-label="Next day"
          >
            &#8250;
          </button>
        </div>
        <div className="w-20" />
      </div>

      {/* View switcher */}
      <div className="flex overflow-x-auto border-b border-border bg-canvas">
        {VIEWS.map((v) => {
          const isActive = v.key === activeView;
          const baseCls = 'flex-shrink-0 px-4 py-2 text-sm font-medium transition-colors';
          if (!v.enabled) {
            return (
              <span
                key={v.key}
                className={`${baseCls} text-fg-disabled cursor-not-allowed`}
                title="Coming soon"
              >
                {v.label}
              </span>
            );
          }
          return (
            <button
              key={v.key}
              onClick={() => handleSelectView(v.key)}
              className={`${baseCls} ${
                isActive
                  ? 'text-fg border-b-2 border-brand -mb-px'
                  : 'text-fg-subtle hover:text-fg-muted'
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {/* Game strip */}
      {loading && <div className="px-4 py-3 text-sm text-fg-subtle">Loading...</div>}
      {error && <div className="px-4 py-3 text-sm text-neg">Error: {error}</div>}
      {!loading && !error && games.length > 0 && (
        <div className="flex overflow-x-auto border-b border-border bg-canvas">
          {games.map((g) => {
            const isActive = String(g.gameId) === activeGameId;
            const isFinal = g.gameStatus === 'F' || g.gameStatus === 'Final';
            return (
              <button
                key={g.gameId}
                onClick={() => handleSelectGame(g.gameId)}
                className={`flex-shrink-0 px-4 py-2 text-left border-r border-border transition-colors ${
                  isActive ? 'bg-surface-hover' : 'hover:bg-surface'
                }`}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className={isFinal && g.awayScore != null && g.homeScore != null && g.awayScore > g.homeScore ? 'font-semibold text-fg' : 'text-fg-subtle'}>
                    {g.awayTeamAbbr}
                  </span>
                  {isFinal && g.awayScore != null && (
                    <span className={g.awayScore > (g.homeScore ?? 0) ? 'font-semibold text-fg text-xs' : 'text-fg-subtle text-xs'}>{g.awayScore}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm mt-0.5">
                  <span className={isFinal && g.awayScore != null && g.homeScore != null && g.homeScore > g.awayScore ? 'font-semibold text-fg' : 'text-fg-subtle'}>
                    {g.homeTeamAbbr}
                  </span>
                  {isFinal && g.homeScore != null && (
                    <span className={g.homeScore > (g.awayScore ?? 0) ? 'font-semibold text-fg text-xs' : 'text-fg-subtle text-xs'}>{g.homeScore}</span>
                  )}
                </div>
                <div className="text-xs text-fg-subtle mt-1">{statusLabel(g)}</div>
              </button>
            );
          })}
        </div>
      )}
      {!loading && !error && games.length === 0 && (
        <div className="px-4 py-6 text-sm text-fg-subtle">No games scheduled for this date.</div>
      )}

      {/* View body */}
      <div className="flex-1 px-4">
        {activeGame ? (
          activeView === 'game' ? (
            <MlbGameTabs game={activeGame} />
          ) : activeView === 'vs' ? (
            <MlbVsView game={activeGame} />
          ) : activeView === 'ev' ? (
            <MlbEvView game={activeGame} />
          ) : activeView === 'player' ? (
            <MlbPlayerView game={activeGame} />
          ) : activeView === 'pitcher' ? (
            <MlbPitcherView game={activeGame} />
          ) : activeView === 'proj' ? (
            <MlbProjView game={activeGame} />
          ) : (
            <div className="py-6 text-sm text-fg-subtle">Coming soon.</div>
          )
        ) : (
          !loading && games.length > 0 && (
            <div className="py-6 text-sm text-fg-subtle">Select a game above.</div>
          )
        )}
      </div>
    </div>
  );
}
