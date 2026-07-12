// web/lib/mlbFilters.ts
import type { SlateGame } from "@/app/api/mlb/research/slate/route";

export type CanonicalMarket = "HR" | "HRR" | "HITS";

export const MLB_MARKETS: { key: CanonicalMarket; label: string }[] = [
  { key: "HR", label: "HR" },
  { key: "HRR", label: "H+R+RBI" },
  { key: "HITS", label: "Hits" },
];

export type GameSel = {
  gamePk: number;
  awayAbbr: string;
  homeAbbr: string;
  label: string;
} | null;

export function gameSelFromSlate(g: SlateGame): NonNullable<GameSel> {
  const away = g.awayTeamAbbr ?? "AWY";
  const home = g.homeTeamAbbr ?? "HOM";
  return {
    gamePk: g.gamePk,
    awayAbbr: away,
    homeAbbr: home,
    label: `${away} @ ${home}`,
  };
}

// Add `days` to a YYYY-MM-DD date without timezone drift (UTC-noon anchor).
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// "2026-07-12" -> "Jul 12"
export function fmtSlateDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export type FilterApplicability = {
  game: boolean;
  market: boolean;
  date: boolean;
};

// Which of the three filters affect a given /mlb route. Disabled (not hidden)
// controls keep the bar visually stable across views.
export function applicabilityForPath(pathname: string): FilterApplicability {
  if (pathname.startsWith("/mlb/props"))
    return { game: true, market: true, date: true };
  if (pathname.startsWith("/mlb/streaks"))
    return { game: true, market: true, date: true };
  if (pathname.startsWith("/mlb/research"))
    return { game: true, market: false, date: true };
  if (pathname.startsWith("/mlb/transparency"))
    return { game: false, market: true, date: false };
  if (pathname.startsWith("/mlb/live"))
    return { game: true, market: false, date: false };
  if (pathname.startsWith("/mlb/grades"))
    return { game: true, market: true, date: true };
  if (pathname === "/mlb") return { game: true, market: false, date: true };
  return { game: true, market: true, date: true };
}
