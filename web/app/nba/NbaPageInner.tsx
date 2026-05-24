"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import GameStrip, { type Game } from "@/components/GameStrip";
import GameTabs from "@/components/GameTabs";
import { randomLoadingWord } from "@/lib/loadingWord";
import { useAuth } from "@/lib/auth-context";
import { openCommandPalette } from "@/lib/ui/CommandPalette";

type NbaTab = "games" | "players";
const RECENT_PLAYERS_KEY = "schnapp_recent_players";
const RECENT_PLAYERS_MAX = 8;

interface RecentPlayer {
  id: number;
  name: string;
  teamAbbr?: string;
  position?: string;
}

function loadRecentPlayers(): RecentPlayer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_PLAYERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_PLAYERS_MAX) : [];
  } catch {
    return [];
  }
}

// Convert an ET time string like "7:30 pm ET" to CT by subtracting 1 hour.
function convertEtToCt(text: string | null): string | null {
  if (!text) return text;
  const m = text.match(/^(\d{1,2}):(\d{2})\s*(am|pm)\s*ET$/i);
  if (!m) return text;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toLowerCase();
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  h -= 1;
  if (h < 0) h += 24;
  let displayAmPm = h >= 12 ? "pm" : "am";
  let displayH = h % 12;
  if (displayH === 0) displayH = 12;
  return `${displayH}:${min} ${displayAmPm} CT`;
}

function parseStartMinutes(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toLowerCase();
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return h * 60 + min;
}

function sortGames(games: Game[]): Game[] {
  return [...games].sort((a, b) => {
    const aUpcoming = a.gameStatus == null || a.gameStatus === 1;
    const bUpcoming = b.gameStatus == null || b.gameStatus === 1;
    if (aUpcoming && bUpcoming) {
      const tA = parseStartMinutes(a.gameStatusText);
      const tB = parseStartMinutes(b.gameStatusText);
      if (tA != null && tB != null) return tA - tB;
      if (tA != null) return -1;
      if (tB != null) return 1;
      return 0;
    }
    const bucket = (s: number | null) =>
      s == null || s === 1 ? 0 : s === 2 ? 1 : 2;
    return bucket(a.gameStatus) - bucket(b.gameStatus);
  });
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

async function fetchGames(date: string): Promise<Game[]> {
  const res = await fetch(`/api/games?sport=nba&date=${date}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: { games: Game[] } = await res.json();
  return data.games ?? [];
}

// Pick the best game to auto-select from a sorted list.
// Prefers: live (status 2) > pre-game (status 1) > finished (status 3).
function pickDefaultGame(sorted: Game[]): Game | undefined {
  return (
    sorted.find((g) => g.gameStatus === 2) ??
    sorted.find((g) => g.gameStatus == null || g.gameStatus === 1) ??
    sorted[0]
  );
}

export default function NbaPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mode, demoDates, logout } = useAuth();

  const isDemo = mode === "demo";
  const demoDate = demoDates.nba;

  const urlDate = searchParams.get("date");
  const defaultDate = isDemo && demoDate ? demoDate : todayLocal();
  const [selectedDate, setSelectedDate] = useState<string>(
    urlDate ?? defaultDate,
  );
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingWord] = useState(() => randomLoadingWord());
  const [error, setError] = useState<string | null>(null);

  // Set to true when the user explicitly taps a game or navigates dates.
  // Prevents auto-select from overriding an intentional selection.
  const isExplicitSelection = useRef<boolean>(false);

  const activeGameId = searchParams.get("gameId");
  const activeGame = games.find((g) => g.gameId === activeGameId) ?? null;
  const effectiveDate = isDemo && demoDate ? demoDate : selectedDate;

  // URL-synced tab. Default = games. The Players tab is a search-driven
  // landing — full /api/players/active-today wiring lands in Session 3.
  const activeTab: NbaTab =
    searchParams.get("tab") === "players" ? "players" : "games";
  const [recentPlayers, setRecentPlayers] = useState<RecentPlayer[]>([]);
  useEffect(() => {
    setRecentPlayers(loadRecentPlayers());
  }, [activeTab]);

  function setTab(next: NbaTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "games") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `/nba?${qs}` : "/nba");
  }

  async function loadGames() {
    setLoading(true);
    setError(null);
    setGames([]);

    try {
      const raw = await fetchGames(effectiveDate);

      const sorted = sortGames(
        raw.map((g) => ({
          ...g,
          gameStatusText:
            g.gameStatus == null || g.gameStatus === 1
              ? convertEtToCt(g.gameStatusText)
              : g.gameStatusText,
        })),
      );

      setGames(sorted);

      if (sorted.length === 0) return;

      const currentGameId = searchParams.get("gameId");
      const currentGame = sorted.find((g) => g.gameId === currentGameId);

      // Re-select when:
      // - No valid game is selected for this date
      // - Not an explicit user selection and the selected game is finished
      //   while upcoming/live games exist (avoids landing on a final when
      //   tonight's games are available)
      const hasUpcoming = sorted.some(
        (g) => g.gameStatus == null || g.gameStatus === 1 || g.gameStatus === 2,
      );
      const shouldReplace =
        !currentGame ||
        (!isExplicitSelection.current &&
          currentGame.gameStatus === 3 &&
          hasUpcoming);

      if (shouldReplace) {
        const pick = pickDefaultGame(sorted);
        if (pick)
          router.replace(`/nba?gameId=${pick.gameId}&date=${effectiveDate}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGames();
  }, [effectiveDate]);

  function handleSelectGame(gameId: string) {
    isExplicitSelection.current = true;
    const params = new URLSearchParams();
    params.set("gameId", gameId);
    params.set("date", effectiveDate);
    const currentTab = searchParams.get("tab");
    if (currentTab) params.set("tab", currentTab);
    router.replace(`/nba?${params.toString()}`);
  }

  function applyDate(newDate: string) {
    if (isDemo) return;
    isExplicitSelection.current = true;
    setSelectedDate(newDate);
    router.replace(`/nba?date=${newDate}`);
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    applyDate(e.target.value);
  }

  const gradesHref = `/nba/grades?date=${effectiveDate}`;

  return (
    <div className="flex flex-col min-h-screen">
      <div className="px-4 py-3 border-b border-border flex items-center justify-end gap-3">
        <div className="flex items-center gap-1">
          {!isDemo && (
            <button
              onClick={() => applyDate(shiftDate(selectedDate, -1))}
              className="px-2 py-1 text-fg-subtle hover:text-fg-muted text-base leading-none"
              aria-label="Previous day"
            >
              &#8249;
            </button>
          )}
          <input
            type="date"
            value={effectiveDate}
            onChange={handleDateChange}
            disabled={isDemo}
            className={`text-sm bg-surface border border-border rounded px-2 py-1 text-fg-muted
                       focus:outline-none focus:border-border-strong ${
                         isDemo
                           ? "opacity-50 cursor-not-allowed"
                           : "cursor-pointer"
                       }`}
          />
          {!isDemo && (
            <button
              onClick={() => applyDate(shiftDate(selectedDate, 1))}
              className="px-2 py-1 text-fg-subtle hover:text-fg-muted text-base leading-none"
              aria-label="Next day"
            >
              &#8250;
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {!isDemo && (
            <button
              onClick={logout}
              className="text-xs text-fg-disabled hover:text-fg-subtle transition-colors"
            >
              Log out
            </button>
          )}
        </div>
      </div>

      {/* Tab strip — URL-synced ?tab=games|players. Default = games. */}
      <div className="flex items-end gap-4 border-b border-border px-4">
        <button
          type="button"
          onClick={() => setTab("games")}
          className={`relative -mb-px py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
            activeTab === "games"
              ? "text-brand border-b-2 border-brand"
              : "text-fg-subtle hover:text-fg border-b-2 border-transparent"
          }`}
        >
          Games
        </button>
        <button
          type="button"
          onClick={() => setTab("players")}
          className={`relative -mb-px py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
            activeTab === "players"
              ? "text-brand border-b-2 border-brand"
              : "text-fg-subtle hover:text-fg border-b-2 border-transparent"
          }`}
        >
          Players
        </button>
      </div>

      {activeTab === "players" && <PlayersPanel recent={recentPlayers} />}

      {activeTab === "games" && (
        <>
          {loading && (
            <div className="px-4 py-3 text-sm text-fg-subtle">
              {loadingWord}...
            </div>
          )}
          {error && (
            <div className="px-4 py-3 text-sm text-neg">Error: {error}</div>
          )}
          {!loading && !error && (
            <GameStrip
              games={games}
              activeGameId={activeGameId}
              onSelect={handleSelectGame}
            />
          )}

          <div className="flex-1 px-4">
            {activeGame ? (
              <GameTabs
                gameId={activeGame.gameId}
                homeTeamId={activeGame.homeTeamId}
                awayTeamId={activeGame.awayTeamId}
                homeTeamAbbr={activeGame.homeTeamAbbr}
                awayTeamAbbr={activeGame.awayTeamAbbr}
                selectedDate={effectiveDate}
                gameStatus={activeGame.gameStatus}
              />
            ) : (
              !loading &&
              games.length === 0 && (
                <div className="py-6 text-sm text-fg-subtle">
                  No games scheduled for this date.
                </div>
              )
            )}
            {!loading && games.length > 0 && !activeGame && (
              <div className="py-6 text-sm text-fg-subtle">
                Select a game above.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Players panel --------------------------------------------------------
// Search-driven landing. Search opens the existing command palette
// (web/lib/ui/CommandPalette) which already calls /api/search. The
// "Playing today" list lands in Session 3 with /api/players/active-today.

function PlayersPanel({ recent }: { recent: RecentPlayer[] }) {
  return (
    <div className="flex flex-col gap-6 px-4 py-5 max-w-2xl">
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-2">
          Search
        </div>
        <button
          type="button"
          onClick={openCommandPalette}
          className="w-full rounded border border-border bg-surface px-3 py-3 text-left text-sm text-fg-subtle hover:bg-surface-hover hover:border-border-strong transition-colors"
        >
          Search players, games…{" "}
          <span className="ml-2 text-fg-disabled font-mono text-[11px]">
            ⌘K
          </span>
        </button>
      </section>

      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-2">
          Recent
        </div>
        {recent.length === 0 ? (
          <div className="rounded border border-border-subtle bg-raised px-3 py-3 text-sm text-fg-disabled">
            No recent players yet. Search above to view a player log.
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle rounded border border-border-subtle bg-raised">
            {recent.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/nba/player/${p.id}`}
                  className="block px-3 py-2 text-sm text-fg hover:bg-surface-hover transition-colors"
                >
                  <span className="font-medium">{p.name}</span>
                  {(p.teamAbbr || p.position) && (
                    <span className="ml-2 font-mono text-[11px] text-fg-subtle">
                      {p.teamAbbr ?? ""}
                      {p.teamAbbr && p.position ? " · " : ""}
                      {p.position ?? ""}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-2">
          Playing today
        </div>
        <div className="rounded border border-border-subtle bg-raised px-3 py-3 text-sm text-fg-disabled">
          Active-today list lands in the next iteration.
        </div>
      </section>
    </div>
  );
}
