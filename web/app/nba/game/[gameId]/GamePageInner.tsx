"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useAuth } from "@/lib/auth-context";
import GameStrip, { type Game } from "@/components/GameStrip";
import LiveBoxScore from "@/components/LiveBoxScore";
import GameBoxScore from "@/components/nba/GameBoxScore";
import RosterTable from "@/components/RosterTable";
import MatchupGrid from "@/components/MatchupGrid";
import TrendsGrid from "@/components/TrendsGrid";
import StatsTable from "@/components/StatsTable";
import PropsSection from "@/components/nba/PropsSection";
import SupplementalSection from "@/components/nba/SupplementalSection";
import PreviousMatchupsCard from "@/components/nba/PreviousMatchupsCard";

interface GameMeta {
  gameId: string;
  gameDate: string;
  gameStatus: number | null;
  gameStatusText: string | null;
  homeTeamId: number;
  homeTeamAbbr: string;
  homeTeamName: string;
  homeScore: number | null;
  awayTeamId: number;
  awayTeamAbbr: string;
  awayTeamName: string;
  awayScore: number | null;
}

type GameState = "pregame" | "live" | "final" | "postponed";

function classifyStatus(g: GameMeta): GameState {
  const status = g.gameStatus ?? 0;
  const text = (g.gameStatusText ?? "").toLowerCase();
  if (text.includes("ppd") || text.includes("postpon")) return "postponed";
  if (status === 3) return "final";
  if (status === 2) return "live";
  return "pregame";
}

function defaultAnchor(state: GameState): string {
  if (state === "live") return "live";
  if (state === "pregame") return "lineups";
  return "box";
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export default function GamePageInner({ gameId }: { gameId: string }) {
  const router = useRouter();
  const { mode } = useAuth();
  const isDemo = mode === "demo";

  const { data, error, isLoading } = useSWR<{ game: GameMeta }>(
    `/api/game/${gameId}`,
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: false,
      dedupingInterval: 15_000,
    },
  );

  const game = data?.game ?? null;
  const state: GameState = game ? classifyStatus(game) : "pregame";
  const gameDate = game?.gameDate ?? "";

  // Initial anchor scroll once game state is known.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (!game || didInitialScroll.current) return;
    didInitialScroll.current = true;
    const target = window.location.hash
      ? window.location.hash.slice(1)
      : defaultAnchor(state);
    requestAnimationFrame(() => {
      const el = document.getElementById(target);
      if (!el) return;
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - 132,
        behavior: "auto",
      });
    });
  }, [game, state]);

  if (isLoading) {
    return <div className="p-4 text-sm text-fg-subtle">Loading game...</div>;
  }
  if (error || !game) {
    return (
      <div className="p-4 text-sm text-neg">
        Error loading game:{" "}
        {(error as Error | undefined)?.message ?? "not found"}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <StickyHeader
        game={game}
        state={state}
        gameDate={gameDate}
        isDemo={isDemo}
        onPickDate={(d) => {
          if (isDemo) return;
          // Date change navigates back to index for that date.
          router.push(`/nba?date=${d}`);
        }}
        onPickGame={(g) => router.push(`/nba/game/${g.gameId}`)}
      />

      <main className="flex-1 px-4 pb-12">
        <Section id="lineups" label="Lineups" state={state}>
          <RosterTable gameId={gameId} selectedDate={gameDate} />
        </Section>

        {state === "live" && (
          <Section id="live" label="Live" state={state}>
            <LiveBoxScore gameId={gameId} selectedDate={gameDate} />
          </Section>
        )}

        <Section
          id="box"
          label="Box score"
          state={state}
          extra={<LineupStatusPill gameId={gameId} state={state} />}
        >
          <GameBoxScore
            gameId={gameId}
            homeTeamId={game.homeTeamId}
            homeTeamAbbr={game.homeTeamAbbr}
            awayTeamId={game.awayTeamId}
            awayTeamAbbr={game.awayTeamAbbr}
            state={state}
          />
        </Section>

        <Section id="matchups" label="Matchups" state={state}>
          <div className="p-4">
            <MatchupGrid
              gameId={gameId}
              homeTeamAbbr={game.homeTeamAbbr}
              awayTeamAbbr={game.awayTeamAbbr}
              selectedDate={gameDate}
            />
          </div>
        </Section>

        <Section id="trends" label="Trends" state={state}>
          <div className="p-4">
            <TrendsGrid
              gameId={gameId}
              homeTeamAbbr={game.homeTeamAbbr}
              awayTeamAbbr={game.awayTeamAbbr}
              selectedDate={gameDate}
            />
          </div>
        </Section>

        <Section id="props" label="Props" state={state}>
          <PropsSection gameId={gameId} selectedDate={gameDate} />
        </Section>

        <Section id="stats" label="Stats" state={state}>
          <div className="p-4">
            <StatsTable
              gameId={gameId}
              homeTeamId={game.homeTeamId}
              awayTeamId={game.awayTeamId}
              homeTeamAbbr={game.homeTeamAbbr}
              awayTeamAbbr={game.awayTeamAbbr}
              selectedDate={gameDate}
            />
          </div>
        </Section>

        {state === "pregame" && (
          <Section id="supplemental" label="Supplemental" state={state}>
            <SupplementalSection gameId={gameId} selectedDate={gameDate} />
          </Section>
        )}

        <Section id="prev" label="Previous matchups" state={state}>
          <PreviousMatchupsCard gameId={gameId} limit={8} />
        </Section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky header: GameStrip + scoreboard + anchor nav
// ---------------------------------------------------------------------------

function StickyHeader({
  game,
  state,
  gameDate,
  isDemo,
  onPickDate,
  onPickGame,
}: {
  game: GameMeta;
  state: GameState;
  gameDate: string;
  isDemo: boolean;
  onPickDate: (d: string) => void;
  onPickGame: (g: Game) => void;
}) {
  const { data } = useSWR<{ games: Game[] }>(
    gameDate ? `/api/games?sport=nba&date=${gameDate}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  const games = data?.games ?? [];

  return (
    <div className="sticky top-0 z-40 border-b border-border bg-canvas/95 backdrop-blur">
      <div className="px-4 py-2 flex items-center gap-3 border-b border-border-subtle">
        <Link
          href="/nba"
          className="text-xs text-fg-subtle hover:text-fg font-mono uppercase tracking-wider"
        >
          /nba
        </Link>
        <div className="flex items-center gap-1 ml-auto">
          {!isDemo && (
            <button
              onClick={() => onPickDate(shiftDate(gameDate, -1))}
              className="px-2 py-1 text-fg-subtle hover:text-fg-muted text-base leading-none"
              aria-label="Previous day"
            >
              &#8249;
            </button>
          )}
          <input
            type="date"
            value={gameDate}
            disabled={isDemo}
            onChange={(e) => onPickDate(e.target.value)}
            className={`text-sm bg-surface border border-border rounded px-2 py-1 text-fg-muted focus:outline-none focus:border-border-strong ${
              isDemo ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
            }`}
          />
          {!isDemo && (
            <button
              onClick={() => onPickDate(shiftDate(gameDate, 1))}
              className="px-2 py-1 text-fg-subtle hover:text-fg-muted text-base leading-none"
              aria-label="Next day"
            >
              &#8250;
            </button>
          )}
        </div>
      </div>

      {games.length > 0 && (
        <GameStrip
          games={games}
          activeGameId={game.gameId}
          onSelect={(id) => {
            const g = games.find((gg) => gg.gameId === id);
            if (g) onPickGame(g);
          }}
        />
      )}

      <ThinScoreboard game={game} state={state} />
      <AnchorNav state={state} />
    </div>
  );
}

function ThinScoreboard({ game, state }: { game: GameMeta; state: GameState }) {
  const tint =
    state === "live"
      ? "bg-neg-muted"
      : state === "pregame"
        ? "bg-brand-muted"
        : "bg-surface";

  return (
    <header className={`border-b border-border ${tint}`}>
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-4 py-2">
        <TeamLine
          abbr={game.awayTeamAbbr}
          score={game.awayScore}
          showScore={state !== "pregame"}
        />
        <StatusBadge state={state} statusText={game.gameStatusText} />
        <TeamLine
          abbr={game.homeTeamAbbr}
          score={game.homeScore}
          showScore={state !== "pregame"}
          alignRight
        />
      </div>
    </header>
  );
}

function TeamLine({
  abbr,
  score,
  showScore,
  alignRight = false,
}: {
  abbr: string;
  score: number | null;
  showScore: boolean;
  alignRight?: boolean;
}) {
  return (
    <div
      className={`flex flex-1 items-center gap-3 ${alignRight ? "flex-row-reverse text-right" : ""}`}
    >
      <span className="text-base font-semibold text-fg">{abbr}</span>
      {showScore && (
        <span className="text-xl tabular-nums text-fg">{score ?? "-"}</span>
      )}
    </div>
  );
}

function StatusBadge({
  state,
  statusText,
}: {
  state: GameState;
  statusText: string | null;
}) {
  const label =
    state === "live"
      ? (statusText ?? "LIVE")
      : state === "final"
        ? "FINAL"
        : state === "postponed"
          ? "PPD"
          : (statusText ?? "Pregame");

  const cls =
    state === "live"
      ? "text-neg border-neg"
      : state === "final"
        ? "text-fg-subtle border-border"
        : state === "postponed"
          ? "text-warn border-warn"
          : "text-brand border-brand";

  return (
    <div
      className={`flex flex-col items-center rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}
    >
      {state === "live" && (
        <span className="mb-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-neg" />
      )}
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky anchor nav
// ---------------------------------------------------------------------------

function AnchorNav({ state }: { state: GameState }) {
  const [active, setActive] = useState<string>(defaultAnchor(state));

  useEffect(() => {
    const ids = anchorIds(state);
    function onScroll() {
      let cur = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - 140 <= 0) cur = id;
      }
      setActive(cur);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [state]);

  const items = anchorItems(state);

  return (
    <nav className="border-t border-border-subtle">
      <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
        {items.map((it) => (
          <Link
            key={it.id}
            href={`#${it.id}`}
            scroll={false}
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(it.id);
              if (el)
                window.scrollTo({
                  top: el.getBoundingClientRect().top + window.scrollY - 132,
                  behavior: "smooth",
                });
              history.replaceState(null, "", `#${it.id}`);
            }}
            className={[
              "whitespace-nowrap px-3 py-2 text-[11px] font-mono uppercase tracking-wider transition-colors border-b-2",
              active === it.id
                ? "border-brand text-fg"
                : "border-transparent text-fg-subtle hover:text-fg",
            ].join(" ")}
          >
            {it.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function anchorIds(state: GameState): string[] {
  const ids: string[] = ["lineups"];
  if (state === "live") ids.push("live");
  ids.push("box", "matchups", "trends", "props", "stats");
  if (state === "pregame") ids.push("supplemental");
  ids.push("prev");
  return ids;
}

function anchorItems(state: GameState): { id: string; label: string }[] {
  const list: { id: string; label: string }[] = [
    { id: "lineups", label: "Lineups" },
  ];
  if (state === "live") list.push({ id: "live", label: "Live" });
  list.push(
    { id: "box", label: "Box score" },
    { id: "matchups", label: "Matchups" },
    { id: "trends", label: "Trends" },
    { id: "props", label: "Props" },
    { id: "stats", label: "Stats" },
  );
  if (state === "pregame")
    list.push({ id: "supplemental", label: "Supplemental" });
  list.push({ id: "prev", label: "Prev. matchups" });
  return list;
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  id,
  label,
  state,
  extra,
  children,
}: {
  id: string;
  label: string;
  state: GameState;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-5xl scroll-mt-32 py-6">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          {label}
        </h2>
        {id === "box" && <StatePill state={state} />}
        {extra}
      </div>
      <div className="rounded border border-border bg-canvas">{children}</div>
    </section>
  );
}

function StatePill({ state }: { state: GameState }) {
  const map: Record<GameState, { label: string; cls: string }> = {
    pregame: { label: "pregame", cls: "text-brand border-brand" },
    live: { label: "live", cls: "text-neg border-neg" },
    final: { label: "final", cls: "text-fg-subtle border-border" },
    postponed: { label: "postponed", cls: "text-warn border-warn" },
  };
  const { label, cls } = map[state];
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}

function LineupStatusPill({
  gameId,
  state,
}: {
  gameId: string;
  state: GameState;
}) {
  const { data } = useSWR<{
    overall: "confirmed" | "probable" | "locked" | "unknown";
    home: "confirmed" | "probable" | "locked" | "unknown";
    away: "confirmed" | "probable" | "locked" | "unknown";
    latest_updated_at: string | null;
  }>(`/api/game/${gameId}/lineup-status`, fetcher, {
    refreshInterval: state === "pregame" ? 120_000 : 0,
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });

  if (state === "live") {
    return (
      <span className="rounded border border-neg px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neg">
        live · this game
      </span>
    );
  }
  if (state !== "pregame") return null;
  if (!data || data.overall === "unknown") return null;

  const label =
    data.overall === "confirmed"
      ? "starters confirmed"
      : data.overall === "probable"
        ? "starters probable"
        : "lineups locked";

  const cls =
    data.overall === "confirmed"
      ? "text-pos border-pos"
      : data.overall === "probable"
        ? "text-warn border-warn"
        : "text-fg-subtle border-border";

  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}
      title={
        data.latest_updated_at ? `Updated ${data.latest_updated_at}` : undefined
      }
    >
      {label}
    </span>
  );
}
