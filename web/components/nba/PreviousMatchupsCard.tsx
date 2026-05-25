"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

interface H2HGame {
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

interface Props {
  gameId: string;
  limit?: number;
}

function statusLabel(g: H2HGame): string {
  if (g.gameStatus === 3) return g.gameStatusText?.toUpperCase() ?? "FINAL";
  if (g.gameStatus === 2) return "LIVE";
  return g.gameStatusText ?? "Scheduled";
}

function statusCls(g: H2HGame): string {
  if (g.gameStatus === 2) return "text-neg border-neg";
  if (g.gameStatus === 3) return "text-fg-subtle border-border";
  return "text-brand border-brand";
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function winnerSide(g: H2HGame): "home" | "away" | null {
  if (g.homeScore == null || g.awayScore == null) return null;
  if (g.homeScore > g.awayScore) return "home";
  if (g.awayScore > g.homeScore) return "away";
  return null;
}

export default function PreviousMatchupsCard({ gameId, limit = 8 }: Props) {
  const { data, error, isLoading } = useSWR<{ games: H2HGame[] }>(
    `/api/game/${gameId}/h2h?limit=${limit}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    },
  );

  if (isLoading) {
    return (
      <div className="px-4 py-6 text-sm text-fg-disabled">
        Loading prior matchups...
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 py-6 text-sm text-neg">
        Error: {(error as Error).message}
      </div>
    );
  }

  const games = data?.games ?? [];
  if (games.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-fg-disabled">
        No prior matchups between these teams.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {games.map((g) => {
        const winner = winnerSide(g);
        return (
          <Link
            key={g.gameId}
            href={`/nba/game/${g.gameId}`}
            className="group flex flex-col gap-2 rounded border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-surface-hover"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-fg-disabled">
                {formatDate(g.gameDate)}
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${statusCls(g)}`}
              >
                {statusLabel(g)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-sm font-medium ${
                  winner === "away" ? "text-fg" : "text-fg-subtle"
                }`}
              >
                {g.awayTeamAbbr}
              </span>
              <span
                className={`text-data tabular-nums ${
                  winner === "away" ? "text-fg" : "text-fg-subtle"
                }`}
              >
                {g.awayScore ?? "-"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-sm font-medium ${
                  winner === "home" ? "text-fg" : "text-fg-subtle"
                }`}
              >
                {g.homeTeamAbbr}
              </span>
              <span
                className={`text-data tabular-nums ${
                  winner === "home" ? "text-fg" : "text-fg-subtle"
                }`}
              >
                {g.homeScore ?? "-"}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
