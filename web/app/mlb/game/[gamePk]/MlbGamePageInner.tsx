"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MlbGameTabs from "../../MlbGameTabs";

interface GameData {
  gamePk: number;
  gameDate: string;
  gameStatus: string | null;
  awayTeamId: number;
  awayTeamAbbr: string;
  awayTeamName: string;
  homeTeamId: number;
  homeTeamAbbr: string;
  homeTeamName: string;
  awayScore: number | null;
  homeScore: number | null;
  awayPitcher: string | null;
  homePitcher: string | null;
}

function isFinalStatus(status: string | null): boolean {
  return status === "F" || status === "Final";
}

function isLiveStatus(status: string | null): boolean {
  return status != null && status !== "Preview" && !isFinalStatus(status);
}

export default function MlbGamePageInner({ gamePk }: { gamePk: string }) {
  const [game, setGame] = useState<GameData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/mlb/game/${gamePk}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setGame(data.game ?? null))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, [gamePk]);

  if (loading)
    return <div className="p-4 text-sm text-fg-subtle">Loading game...</div>;
  if (error || !game)
    return (
      <div className="p-4 text-sm text-neg">
        Error: {error ?? "Game not found"}
      </div>
    );

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

  const mlbGameForTabs = {
    gameId: game.gamePk,
    awayTeamId: game.awayTeamId,
    homeTeamId: game.homeTeamId,
    awayTeamAbbr: game.awayTeamAbbr,
    homeTeamAbbr: game.homeTeamAbbr,
    awayScore: game.awayScore,
    homeScore: game.homeScore,
    gameStatus: game.gameStatus,
    awayPitcher: game.awayPitcher,
    homePitcher: game.homePitcher,
  };

  return (
    <div className="flex flex-col min-h-screen">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <Link
          href={`/mlb?date=${game.gameDate}`}
          className="text-fg-subtle hover:text-fg-muted text-sm flex-none"
        >
          &#8592;
        </Link>

        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex flex-col gap-0.5">
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

          <div className="min-w-0">
            <div
              className={`text-xs ${isLive ? "text-pos font-medium" : "text-fg-subtle"}`}
            >
              {isFinal ? "Final" : isLive ? game.gameStatus : game.gameDate}
            </div>
            {(game.awayPitcher || game.homePitcher) && (
              <div className="text-xs text-fg-disabled mt-0.5 truncate">
                {game.awayPitcher && (
                  <span>
                    {game.awayTeamAbbr}: {game.awayPitcher}
                  </span>
                )}
                {game.awayPitcher && game.homePitcher && <span> · </span>}
                {game.homePitcher && (
                  <span>
                    {game.homeTeamAbbr}: {game.homePitcher}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <MlbGameTabs game={mlbGameForTabs} />
    </div>
  );
}
