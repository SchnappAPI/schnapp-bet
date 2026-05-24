"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import BoxScoreTable from "@/components/BoxScoreTable";
import LiveBoxScore from "@/components/LiveBoxScore";

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

export default function GamePageInner({ gameId }: { gameId: string }) {
  const { data, error, isLoading } = useSWR<{ game: GameMeta }>(
    `/api/game/${gameId}`,
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: false,
      dedupingInterval: 15_000,
    },
  );

  if (isLoading) {
    return <div className="p-4 text-sm text-fg-subtle">Loading game...</div>;
  }
  if (error || !data?.game) {
    return (
      <div className="p-4 text-sm text-neg">
        Error loading game:{" "}
        {(error as Error | undefined)?.message ?? "not found"}
      </div>
    );
  }

  const game = data.game;
  const state = classifyStatus(game);

  return (
    <div className="flex min-h-screen flex-col">
      <Scoreboard game={game} state={state} />
      <AnchorNav state={state} />

      <main className="flex-1 px-4 pb-12">
        <Section id="box" label="Box score" state={state}>
          {state === "live" ? (
            <LiveBoxScore gameId={gameId} selectedDate={game.gameDate} />
          ) : (
            <BoxScoreTable gameId={gameId} selectedDate={game.gameDate} />
          )}
        </Section>

        {state !== "pregame" && (
          <Section id="pbp" label="Play-by-play" state={state}>
            <div className="px-4 py-6 text-sm text-fg-disabled">
              Play-by-play coming soon.
            </div>
          </Section>
        )}

        <Section id="team" label="Team stats" state={state}>
          <TeamStatsPlaceholder game={game} state={state} />
        </Section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

function Scoreboard({ game, state }: { game: GameMeta; state: GameState }) {
  const tint =
    state === "live"
      ? "bg-neg-muted"
      : state === "pregame"
        ? "bg-brand-muted"
        : "bg-surface";

  return (
    <header className={`border-b border-border ${tint}`}>
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-4 py-4">
        <TeamScore
          abbr={game.awayTeamAbbr}
          name={game.awayTeamName}
          score={game.awayScore}
          showScore={state !== "pregame"}
        />
        <StatusBadge state={state} statusText={game.gameStatusText} />
        <TeamScore
          abbr={game.homeTeamAbbr}
          name={game.homeTeamName}
          score={game.homeScore}
          showScore={state !== "pregame"}
          alignRight
        />
      </div>
    </header>
  );
}

function TeamScore({
  abbr,
  name,
  score,
  showScore,
  alignRight = false,
}: {
  abbr: string;
  name: string;
  score: number | null;
  showScore: boolean;
  alignRight?: boolean;
}) {
  return (
    <div
      className={`flex flex-1 items-center gap-3 ${alignRight ? "flex-row-reverse text-right" : ""}`}
    >
      <div className={alignRight ? "text-right" : ""}>
        <div className="text-h2 font-semibold text-fg">{abbr}</div>
        <div className="text-xs text-fg-disabled">{name}</div>
      </div>
      {showScore && (
        <div className="text-display tabular-nums text-fg">{score ?? "-"}</div>
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
      className={`flex flex-col items-center rounded border px-3 py-1 text-xs font-medium uppercase tracking-wider ${cls}`}
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
  const [active, setActive] = useState<string>("box");

  useEffect(() => {
    function onScroll() {
      const ids = ["box", "pbp", "team"];
      let cur = "box";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - 120 <= 0) cur = id;
      }
      setActive(cur);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const items: { id: string; label: string }[] = [
    { id: "box", label: "Box score" },
    ...(state !== "pregame" ? [{ id: "pbp", label: "Play-by-play" }] : []),
    { id: "team", label: "Team stats" },
  ];

  return (
    <nav className="sticky top-0 z-30 border-b border-border bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl gap-1 px-4">
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
                  top: el.getBoundingClientRect().top + window.scrollY - 64,
                  behavior: "smooth",
                });
            }}
            className={[
              "px-3 py-2 text-xs font-medium uppercase tracking-wider transition-colors",
              active === it.id
                ? "border-b-2 border-brand text-fg"
                : "border-b-2 border-transparent text-fg-subtle hover:text-fg",
            ].join(" ")}
          >
            {it.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function Section({
  id,
  label,
  state,
  children,
}: {
  id: string;
  label: string;
  state: GameState;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-5xl scroll-mt-20 py-6">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          {label}
        </h2>
        {id === "box" && <StatePill state={state} />}
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

// ---------------------------------------------------------------------------
// Team stats placeholder
// ---------------------------------------------------------------------------

function TeamStatsPlaceholder({
  game,
  state,
}: {
  game: GameMeta;
  state: GameState;
}) {
  if (state === "pregame") {
    return (
      <div className="px-4 py-6 text-sm text-fg-disabled">
        Team stats available once the game tips.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
      {[
        { label: "Final score", away: game.awayScore, home: game.homeScore },
        { label: "FG%", away: null, home: null },
        { label: "3P%", away: null, home: null },
        { label: "FT%", away: null, home: null },
        { label: "REB", away: null, home: null },
        { label: "AST", away: null, home: null },
        { label: "TOV", away: null, home: null },
        { label: "Pts in paint", away: null, home: null },
      ].map((kpi) => (
        <div
          key={kpi.label}
          className="rounded border border-border bg-surface p-3"
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-disabled">
            {kpi.label}
          </div>
          <div className="flex items-baseline justify-between gap-2 text-data tabular-nums">
            <span className="text-fg-subtle">{game.awayTeamAbbr}</span>
            <span className="text-fg">{kpi.away ?? "-"}</span>
            <span className="text-fg-disabled">·</span>
            <span className="text-fg">{kpi.home ?? "-"}</span>
            <span className="text-fg-subtle">{game.homeTeamAbbr}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
