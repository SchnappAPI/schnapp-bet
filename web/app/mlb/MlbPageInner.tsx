"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { openCommandPalette } from "@/lib/ui/CommandPalette";
import { isFinalStatus, isLiveStatus } from "./gameStatus";
import MlbLeadersRails from "./MlbLeadersRails";
import { useMlbFilters } from "@/components/mlb/MlbFilterProvider";

type MlbTab = "games" | "players";
type RoleFilter = "all" | "batters" | "pitchers";
const RECENT_MLB_PLAYERS_KEY = "schnapp_recent_mlb_players";
const RECENT_MLB_PLAYERS_MAX = 8;

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
  awayPitcherHand: string | null;
  homePitcherHand: string | null;
  liveLabel?: string | null;
}

interface RecentMlbPlayer {
  id: number;
  name: string;
  teamAbbr?: string;
  position?: string;
}

function loadRecentMlbPlayers(): RecentMlbPlayer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_MLB_PLAYERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_MLB_PLAYERS_MAX) : [];
  } catch {
    return [];
  }
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatGameTime(isoStr: string | null): string {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    return (
      d.toLocaleTimeString("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }) + " CT"
    );
  } catch {
    return "";
  }
}

function statusLabel(game: MlbGame): string {
  if (isFinalStatus(game.gameStatus)) return "Final";
  if (isLiveStatus(game.gameStatus)) return game.liveLabel ?? game.gameStatus!;
  return formatGameTime(game.gameDateTime);
}

// ---- Game card ---------------------------------------------------------------

function GameCard({
  game,
  highlighted,
}: {
  game: MlbGame;
  highlighted?: boolean;
}) {
  const isFinal = isFinalStatus(game.gameStatus);
  const isLive = isLiveStatus(game.gameStatus);
  const awayWin =
    isFinal &&
    game.awayScore != null &&
    game.homeScore != null &&
    game.awayScore > game.homeScore;
  const homeWin =
    isFinal &&
    game.awayScore != null &&
    game.homeScore != null &&
    game.homeScore > game.awayScore;

  return (
    <Link
      id={`game-${game.gameId}`}
      href={`/mlb/game/${game.gameId}`}
      className={`flex items-start justify-between gap-4 border-b border-border px-4 py-3 hover:bg-surface transition-colors${
        highlighted ? " ring-2 ring-brand ring-inset" : ""
      }`}
    >
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm ${awayWin ? "font-semibold text-fg" : "text-fg-subtle"}`}
          >
            {game.awayTeamAbbr}
          </span>
          {game.awayScore != null && (
            <span
              className={`text-sm tabular-nums ${awayWin ? "font-semibold text-fg" : "text-fg-subtle"}`}
            >
              {game.awayScore}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm ${homeWin ? "font-semibold text-fg" : "text-fg-subtle"}`}
          >
            {game.homeTeamAbbr}
          </span>
          {game.homeScore != null && (
            <span
              className={`text-sm tabular-nums ${homeWin ? "font-semibold text-fg" : "text-fg-subtle"}`}
            >
              {game.homeScore}
            </span>
          )}
        </div>
      </div>
      <div className="text-right flex-none">
        <div
          className={`text-xs ${isLive ? "text-pos font-medium" : "text-fg-subtle"}`}
        >
          {statusLabel(game)}
        </div>
        {(game.awayPitcher || game.homePitcher) && (
          <div className="text-xs text-fg-disabled mt-1 space-y-0.5">
            {game.awayPitcher && (
              <div>
                {game.awayTeamAbbr}: {game.awayPitcher}
                {game.awayPitcherHand ? ` (${game.awayPitcherHand})` : ""}
              </div>
            )}
            {game.homePitcher && (
              <div>
                {game.homeTeamAbbr}: {game.homePitcher}
                {game.homePitcherHand ? ` (${game.homePitcherHand})` : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

function GameGroup({
  label,
  games,
  selectedGameId,
}: {
  label: string;
  games: MlbGame[];
  selectedGameId?: number | null;
}) {
  if (games.length === 0) return null;
  return (
    <div>
      <div className="px-4 pt-4 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
        {label}
      </div>
      {games.map((g) => (
        <GameCard
          key={g.gameId}
          game={g}
          highlighted={selectedGameId != null && g.gameId === selectedGameId}
        />
      ))}
    </div>
  );
}

// ---- Players panel -----------------------------------------------------------

function MlbPlayersPanel({
  recent,
  roleFilter,
  onRoleFilter,
}: {
  recent: RecentMlbPlayer[];
  roleFilter: RoleFilter;
  onRoleFilter: (r: RoleFilter) => void;
}) {
  const filteredRecent = recent.filter((p) => {
    if (roleFilter === "all") return true;
    if (!p.position) return true;
    const pos = p.position.toUpperCase();
    if (roleFilter === "pitchers")
      return pos === "P" || pos === "SP" || pos === "RP";
    if (roleFilter === "batters")
      return pos !== "P" && pos !== "SP" && pos !== "RP";
    return true;
  });

  return (
    <div className="flex flex-col gap-6 px-4 py-5 max-w-2xl">
      <div className="flex items-center gap-2">
        {(["all", "batters", "pitchers"] as RoleFilter[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onRoleFilter(r)}
            className={`px-3 py-1 text-xs font-medium rounded border transition-colors capitalize ${
              roleFilter === r
                ? "bg-brand text-canvas border-brand"
                : "border-border text-fg-subtle hover:border-border-strong hover:text-fg"
            }`}
          >
            {r === "all" ? "All" : r === "batters" ? "Batters" : "Pitchers"}
          </button>
        ))}
      </div>

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
        {filteredRecent.length === 0 ? (
          <div className="rounded border border-border-subtle bg-raised px-3 py-3 text-sm text-fg-disabled">
            No recent players yet. Search above to view a player log.
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle rounded border border-border-subtle bg-raised">
            {filteredRecent.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/mlb/player/${p.id}`}
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
    </div>
  );
}

// ---- Page -------------------------------------------------------------------

export default function MlbPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { date, game } = useMlbFilters();

  const [games, setGames] = useState<MlbGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeTab: MlbTab =
    searchParams.get("tab") === "players" ? "players" : "games";
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [recentPlayers, setRecentPlayers] = useState<RecentMlbPlayer[]>([]);

  useEffect(() => {
    setRecentPlayers(loadRecentMlbPlayers());
  }, [activeTab]);

  function setTab(next: MlbTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "games") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `/mlb?${qs}` : "/mlb");
  }

  async function loadGames(silent = false) {
    if (!silent) {
      setLoading(true);
      setError(null);
      setGames([]);
    }
    try {
      const res = await fetch(`/api/mlb-games?date=${date}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const sorted: MlbGame[] = (data.games ?? []).sort(
        (a: MlbGame, b: MlbGame) => {
          const aTime = a.gameDateTime ?? "";
          const bTime = b.gameDateTime ?? "";
          return aTime.localeCompare(bTime);
        },
      );
      setGames(sorted);
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Live repoll: while viewing today with games still to finish, refresh
  // silently every 30s so scores/status track the overlay.
  const hasUnfinished = games.some((g) => !isFinalStatus(g.gameStatus));
  useEffect(() => {
    if (date !== todayLocal() || !hasUnfinished) return;
    const id = setInterval(() => loadGames(true), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, hasUnfinished]);

  // When the shared bar's game selector changes, scroll the matching card
  // into view and highlight it (see GameGroup/GameCard `highlighted` prop).
  useEffect(() => {
    if (!game) return;
    const el = document.getElementById(`game-${game.gamePk}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [game]);

  const liveGames = games.filter((g) => isLiveStatus(g.gameStatus));
  const scheduledGames = games.filter(
    (g) => !isFinalStatus(g.gameStatus) && !isLiveStatus(g.gameStatus),
  );
  const finalGames = games.filter((g) => isFinalStatus(g.gameStatus));

  return (
    <div className="flex flex-col min-h-screen">
      {/* Tab strip */}
      <div className="flex items-end gap-4 border-b border-border px-4">
        {(["games", "players"] as MlbTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setTab(tab)}
            className={`relative -mb-px py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
              activeTab === tab
                ? "text-brand border-b-2 border-brand"
                : "text-fg-subtle hover:text-fg border-b-2 border-transparent"
            }`}
          >
            {tab === "games" ? "Games" : "Players"}
          </button>
        ))}
      </div>

      {activeTab === "players" && (
        <MlbPlayersPanel
          recent={recentPlayers}
          roleFilter={roleFilter}
          onRoleFilter={setRoleFilter}
        />
      )}

      {activeTab === "games" && (
        <div className="flex-1">
          {loading && (
            <div className="px-4 py-3 text-sm text-fg-subtle">Loading...</div>
          )}
          {error && (
            <div className="px-4 py-3 text-sm text-neg">Error: {error}</div>
          )}
          {!loading && !error && games.length === 0 && (
            <div className="px-4 py-6 text-sm text-fg-subtle">
              No games scheduled for this date.
            </div>
          )}
          {!loading && !error && games.length > 0 && (
            <>
              <GameGroup
                label="Live"
                games={liveGames}
                selectedGameId={game?.gamePk}
              />
              <GameGroup
                label="Scheduled"
                games={scheduledGames}
                selectedGameId={game?.gamePk}
              />
              <GameGroup
                label="Final"
                games={finalGames}
                selectedGameId={game?.gamePk}
              />
            </>
          )}
          <MlbLeadersRails date={date} />
        </div>
      )}
    </div>
  );
}
