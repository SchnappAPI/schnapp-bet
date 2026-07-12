// web/components/mlb/MlbFilterProvider.tsx
"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { SlateGame } from "@/app/api/mlb/research/slate/route";
import type { CanonicalMarket, GameSel } from "@/lib/mlbFilters";
import { todayCT } from "@/lib/mlbLive";

export type MlbFilterContextValue = {
  date: string;
  setDate: (d: string) => void;
  market: CanonicalMarket;
  setMarket: (m: CanonicalMarket) => void;
  game: GameSel;
  setGame: (g: GameSel) => void;
  slateGames: SlateGame[];
  slateLoading: boolean;
};

const MlbFilterContext = createContext<MlbFilterContextValue | null>(null);

const MARKET_KEY = "sb.mlb.market";

function readStoredMarket(): CanonicalMarket {
  if (typeof window === "undefined") return "HR";
  try {
    const v = window.localStorage.getItem(MARKET_KEY);
    if (v === "HR" || v === "HRR" || v === "HITS") return v;
  } catch {
    /* localStorage unavailable (privacy mode) — fall through */
  }
  return "HR";
}

export function MlbFilterProvider({ children }: { children: React.ReactNode }) {
  const [date, setDate] = useState<string>(() => todayCT());
  const [market, setMarketState] = useState<CanonicalMarket>("HR");
  const [game, setGame] = useState<GameSel>(null);
  const [slateGames, setSlateGames] = useState<SlateGame[]>([]);
  const [slateLoading, setSlateLoading] = useState(false);

  // Hydrate market from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    setMarketState(readStoredMarket());
  }, []);

  const setMarket = (m: CanonicalMarket) => {
    setMarketState(m);
    try {
      window.localStorage.setItem(MARKET_KEY, m);
    } catch {
      /* ignore */
    }
  };

  // Fetch the slate for the current date (drives the game dropdown) and
  // revalidate the selected game against it.
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    setSlateLoading(true);
    fetch(`/api/mlb/research/slate?date=${date}`)
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((d: { games?: SlateGame[] }) => {
        if (id !== reqId.current) return; // stale response
        const games = d.games ?? [];
        setSlateGames(games);
        setGame((cur) =>
          cur && games.some((g) => g.gamePk === cur.gamePk) ? cur : null,
        );
      })
      .catch(() => {
        if (id !== reqId.current) return;
        setSlateGames([]);
        setGame(null);
      })
      .finally(() => {
        if (id === reqId.current) setSlateLoading(false);
      });
  }, [date]);

  const value: MlbFilterContextValue = {
    date,
    setDate,
    market,
    setMarket,
    game,
    setGame,
    slateGames,
    slateLoading,
  };

  return (
    <MlbFilterContext.Provider value={value}>
      {children}
    </MlbFilterContext.Provider>
  );
}

export function useMlbFilters(): MlbFilterContextValue {
  const ctx = useContext(MlbFilterContext);
  if (!ctx) {
    throw new Error("useMlbFilters must be used within <MlbFilterProvider>");
  }
  return ctx;
}
