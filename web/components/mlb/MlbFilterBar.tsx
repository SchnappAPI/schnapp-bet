// web/components/mlb/MlbFilterBar.tsx
"use client";

import { usePathname } from "next/navigation";
import { useMlbFilters } from "./MlbFilterProvider";
import {
  MLB_MARKETS,
  applicabilityForPath,
  fmtSlateDate,
  gameSelFromSlate,
  shiftDate,
} from "@/lib/mlbFilters";

export default function MlbFilterBar() {
  const { date, setDate, market, setMarket, game, setGame, slateGames } =
    useMlbFilters();
  const pathname = usePathname() ?? "/mlb";
  const applies = applicabilityForPath(pathname);

  const dim = (on: boolean) =>
    on ? "" : "opacity-40 pointer-events-none select-none";

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2 text-sm">
      {/* GAME */}
      <div className={`flex items-center gap-1.5 ${dim(applies.game)}`}>
        <span className="text-fg-muted">Game</span>
        <select
          className="rounded border border-border bg-inset px-2 py-1"
          value={game?.gamePk ?? ""}
          disabled={!applies.game}
          onChange={(e) => {
            const pk = e.target.value ? Number(e.target.value) : null;
            const g = pk ? slateGames.find((s) => s.gamePk === pk) : null;
            setGame(g ? gameSelFromSlate(g) : null);
          }}
        >
          <option value="">All games</option>
          {slateGames.map((g) => {
            const away = g.awayTeamAbbr ?? "AWY";
            const home = g.homeTeamAbbr ?? "HOM";
            return (
              <option key={g.gamePk} value={g.gamePk}>
                {away} @ {home}
              </option>
            );
          })}
        </select>
      </div>

      {/* MARKET */}
      <div className={`flex items-center gap-1 ${dim(applies.market)}`}>
        <span className="text-fg-muted">Market</span>
        {MLB_MARKETS.map((m) => (
          <button
            key={m.key}
            type="button"
            disabled={!applies.market}
            onClick={() => setMarket(m.key)}
            className={`rounded px-2 py-1 ${
              market === m.key
                ? "bg-brand text-canvas"
                : "border border-border bg-inset"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* DATE */}
      <div className={`flex items-center gap-1 ${dim(applies.date)}`}>
        <button
          type="button"
          disabled={!applies.date}
          onClick={() => setDate(shiftDate(date, -1))}
          className="rounded border border-border bg-inset px-2 py-1"
          aria-label="Previous day"
        >
          ‹
        </button>
        <span className="min-w-[3.5rem] text-center tabular-nums">
          {fmtSlateDate(date)}
        </span>
        <button
          type="button"
          disabled={!applies.date}
          onClick={() => setDate(shiftDate(date, 1))}
          className="rounded border border-border bg-inset px-2 py-1"
          aria-label="Next day"
        >
          ›
        </button>
      </div>
    </div>
  );
}
