"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import LiveBoxScore from "@/components/LiveBoxScore";
import GameBoxScore from "@/components/nba/GameBoxScore";

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
        <Section
          id="box"
          label="Box score"
          state={state}
          extra={<LineupStatusPill gameId={gameId} state={state} />}
        >
          {state === "live" ? (
            <LiveBoxScore gameId={gameId} selectedDate={game.gameDate} />
          ) : (
            <GameBoxScore
              gameId={gameId}
              homeTeamId={game.homeTeamId}
              homeTeamAbbr={game.homeTeamAbbr}
              awayTeamId={game.awayTeamId}
              awayTeamAbbr={game.awayTeamAbbr}
              state={state}
            />
          )}
        </Section>

        {state !== "pregame" && (
          <Section id="pbp" label="Play-by-play" state={state}>
            <div className="px-4 py-6 text-sm text-fg-disabled">
              {state === "live"
                ? "Live play-by-play feed not yet wired."
                : "Play-by-play archive not available for this game."}
            </div>
          </Section>
        )}

        <Section id="team" label="Team stats" state={state}>
          <TeamStatsPlaceholder game={game} state={state} gameId={gameId} />
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
    <section id={id} className="mx-auto max-w-5xl scroll-mt-20 py-6">
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
// Team stats
// ---------------------------------------------------------------------------

interface BoxRow {
  playerId: number;
  teamId: number;
  period: string;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
  min: number | null;
  fg3m: number | null;
  fg3a: number | null;
  fgm: number | null;
  fga: number | null;
  ftm: number | null;
  fta: number | null;
}

interface TeamTotals {
  pts: number;
  reb: number;
  ast: number;
  tov: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
}

function aggregateTeam(rows: BoxRow[], teamId: number): TeamTotals {
  const t: TeamTotals = {
    pts: 0,
    reb: 0,
    ast: 0,
    tov: 0,
    stl: 0,
    blk: 0,
    fgm: 0,
    fga: 0,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
  };
  for (const r of rows) {
    if (r.teamId !== teamId) continue;
    t.pts += r.pts ?? 0;
    t.reb += r.reb ?? 0;
    t.ast += r.ast ?? 0;
    t.tov += r.tov ?? 0;
    t.stl += r.stl ?? 0;
    t.blk += r.blk ?? 0;
    t.fgm += r.fgm ?? 0;
    t.fga += r.fga ?? 0;
    t.fg3m += r.fg3m ?? 0;
    t.fg3a += r.fg3a ?? 0;
    t.ftm += r.ftm ?? 0;
    t.fta += r.fta ?? 0;
  }
  return t;
}

function pct(num: number, denom: number): string {
  if (denom <= 0) return "-";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function TeamStatsPlaceholder({
  game,
  state,
  gameId,
}: {
  game: GameMeta;
  state: GameState;
  gameId: string;
}) {
  const { data, isLoading } = useSWR<{ rows: BoxRow[] }>(
    state === "pregame" ? null : `/api/boxscore?gameId=${gameId}`,
    fetcher,
    {
      refreshInterval: state === "live" ? 30_000 : 0,
      revalidateOnFocus: false,
      dedupingInterval: 15_000,
    },
  );

  if (state === "pregame") {
    return (
      <div className="px-4 py-6 text-sm text-fg-disabled">
        Team stats available once the game tips.
      </div>
    );
  }

  const rows = data?.rows ?? [];

  if (isLoading && rows.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-fg-disabled">
        Loading team stats...
      </div>
    );
  }

  const home = aggregateTeam(rows, game.homeTeamId);
  const away = aggregateTeam(rows, game.awayTeamId);

  const kpis: { label: string; away: string; home: string }[] = [
    {
      label: "Final score",
      away: String(game.awayScore ?? "-"),
      home: String(game.homeScore ?? "-"),
    },
    {
      label: "FG%",
      away: `${away.fgm}/${away.fga} · ${pct(away.fgm, away.fga)}`,
      home: `${home.fgm}/${home.fga} · ${pct(home.fgm, home.fga)}`,
    },
    {
      label: "3P%",
      away: `${away.fg3m}/${away.fg3a} · ${pct(away.fg3m, away.fg3a)}`,
      home: `${home.fg3m}/${home.fg3a} · ${pct(home.fg3m, home.fg3a)}`,
    },
    {
      label: "FT%",
      away: `${away.ftm}/${away.fta} · ${pct(away.ftm, away.fta)}`,
      home: `${home.ftm}/${home.fta} · ${pct(home.ftm, home.fta)}`,
    },
    { label: "REB", away: String(away.reb), home: String(home.reb) },
    { label: "AST", away: String(away.ast), home: String(home.ast) },
    { label: "TOV", away: String(away.tov), home: String(home.tov) },
    {
      label: "STL · BLK",
      away: `${away.stl} · ${away.blk}`,
      home: `${home.stl} · ${home.blk}`,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="rounded border border-border bg-surface p-3"
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-disabled">
            {kpi.label}
          </div>
          <div className="space-y-0.5 text-data tabular-nums">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-fg-subtle">{game.awayTeamAbbr}</span>
              <span className="text-fg">{kpi.away}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-fg-subtle">{game.homeTeamAbbr}</span>
              <span className="text-fg">{kpi.home}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
