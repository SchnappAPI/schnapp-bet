"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

// ---- Response types --------------------------------------------------------
// Subset of /api/games/today's payload — HomeHub only needs the per-sport
// game count + live count for its two cards.
type Game = {
  id: string;
  status: "scheduled" | "live" | "final" | "postponed";
};

type GamesTodayResponse = {
  date: string;
  updated_at: string;
  sports: Record<"nba" | "mlb" | "nfl", { count: number; games: Game[] }>;
};

// ---- Component -------------------------------------------------------------
export interface HomeHubProps {
  // Server-rendered initial data. May be null if the server-side fetch failed;
  // SWR falls back to its normal loading flow in that case.
  initial?: {
    games: GamesTodayResponse | null;
  };
}

export default function HomeHub({ initial }: HomeHubProps = {}) {
  // One SWR fetch — /api/games/today drives both sport cards. Polling
  // cadence on the home page is 60s (count-only); the sport pages run at
  // 30s for live game freshness per `.claude/rules/web.md`.
  const { data: games } = useSWR<GamesTodayResponse>(
    "/api/games/today",
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
      dedupingInterval: 30_000,
      fallbackData: initial?.games ?? undefined,
    },
  );

  const nba = games?.sports.nba ?? { count: 0, games: [] };
  const mlb = games?.sports.mlb ?? { count: 0, games: [] };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader date={games?.date} updatedAt={games?.updated_at} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SportCard
          href="/nba"
          label="NBA"
          accentClass="text-sport-nba"
          count={nba.count}
          liveCount={countLive(nba.games)}
        />
        <SportCard
          href="/mlb"
          label="MLB"
          accentClass="text-sport-mlb"
          count={mlb.count}
          liveCount={countLive(mlb.games)}
        />
      </div>
    </div>
  );
}

// ---- Pieces ---------------------------------------------------------------

function PageHeader({
  date,
  updatedAt,
}: {
  date?: string;
  updatedAt?: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border-subtle pb-2">
      <h1 className="font-mono text-micro uppercase tracking-[0.18em] text-fg-subtle">
        Today {date ? `· ${formatHeaderDate(date)}` : ""}
      </h1>
      {updatedAt && (
        <span className="font-mono text-micro text-fg-disabled">
          {formatUpdatedAgo(updatedAt)}
        </span>
      )}
    </div>
  );
}

interface SportCardProps {
  href: string;
  label: string;
  accentClass: string;
  count: number;
  liveCount: number;
}

function SportCard({
  href,
  label,
  accentClass,
  count,
  liveCount,
}: SportCardProps) {
  return (
    <Link
      href={href}
      className="group block rounded-md border border-border bg-raised p-5 transition-colors hover:border-border-strong hover:bg-surface-hover"
    >
      <div className="flex items-baseline justify-between">
        <span
          className={`font-mono text-3xl font-semibold tracking-tight ${accentClass}`}
        >
          {label}
        </span>
        {liveCount > 0 && (
          <span className="font-mono text-micro uppercase tracking-[0.14em] text-live">
            ● {liveCount} live
          </span>
        )}
      </div>
      <div className="mt-3 font-mono text-sm text-fg-subtle">
        {count > 0
          ? `${count} game${count === 1 ? "" : "s"} today`
          : "No games today"}
      </div>
      <div className="mt-4 font-mono text-micro uppercase tracking-[0.14em] text-fg-disabled group-hover:text-brand">
        Games &amp; Players →
      </div>
    </Link>
  );
}

// ---- Helpers --------------------------------------------------------------

function countLive(games: Game[]): number {
  let n = 0;
  for (const g of games) if (g.status === "live") n++;
  return n;
}

function formatHeaderDate(iso: string): string {
  // Expecting YYYY-MM-DD; if a full timestamp slips through, take the date half.
  const date = iso.slice(0, 10);
  const [, m, d] = date.split("-");
  if (!m || !d) return date;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mi = parseInt(m, 10) - 1;
  if (mi < 0 || mi > 11) return date;
  return `${months[mi]} ${parseInt(d, 10)}`;
}

function formatUpdatedAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}
