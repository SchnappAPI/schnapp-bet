"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

interface BoxRow {
  playerId: number;
  playerName: string;
  teamId: number;
  period: string;
  starterStatus: string | null;
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

interface PlayerTotals {
  playerId: number;
  playerName: string;
  teamId: number;
  starter: boolean;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  min: number;
  fg3m: number;
  fg3a: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
}

export interface GameBoxScoreProps {
  gameId: string;
  homeTeamId: number;
  homeTeamAbbr: string;
  awayTeamId: number;
  awayTeamAbbr: string;
  state: "pregame" | "live" | "final" | "postponed";
}

function aggregate(rows: BoxRow[]): PlayerTotals[] {
  const m = new Map<number, PlayerTotals>();
  for (const r of rows) {
    let t = m.get(r.playerId);
    if (!t) {
      t = {
        playerId: r.playerId,
        playerName: r.playerName,
        teamId: r.teamId,
        starter: r.starterStatus === "Starter",
        pts: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        tov: 0,
        min: 0,
        fg3m: 0,
        fg3a: 0,
        fgm: 0,
        fga: 0,
        ftm: 0,
        fta: 0,
      };
      m.set(r.playerId, t);
    }
    if (r.starterStatus === "Starter") t.starter = true;
    t.pts += r.pts ?? 0;
    t.reb += r.reb ?? 0;
    t.ast += r.ast ?? 0;
    t.stl += r.stl ?? 0;
    t.blk += r.blk ?? 0;
    t.tov += r.tov ?? 0;
    t.min += r.min ?? 0;
    t.fg3m += r.fg3m ?? 0;
    t.fg3a += r.fg3a ?? 0;
    t.fgm += r.fgm ?? 0;
    t.fga += r.fga ?? 0;
    t.ftm += r.ftm ?? 0;
    t.fta += r.fta ?? 0;
  }
  return Array.from(m.values());
}

function fmtMin(min: number): string {
  if (min <= 0) return "-";
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function avg(n: number, dp = 1): string {
  if (!Number.isFinite(n) || n === 0) return "-";
  return n.toFixed(dp);
}

export default function GameBoxScore({
  gameId,
  homeTeamId,
  homeTeamAbbr,
  awayTeamId,
  awayTeamAbbr,
  state,
}: GameBoxScoreProps) {
  const { data, error, isLoading } = useSWR<{ rows: BoxRow[] }>(
    `/api/boxscore?gameId=${gameId}`,
    fetcher,
    {
      refreshInterval: state === "live" ? 30_000 : 0,
      revalidateOnFocus: false,
      dedupingInterval: 15_000,
    },
  );

  if (isLoading && !data) {
    return (
      <div className="px-4 py-6 text-sm text-fg-disabled">Loading box…</div>
    );
  }
  if (error) {
    return (
      <div className="px-4 py-6 text-sm text-neg">
        Error: {(error as Error).message}
      </div>
    );
  }
  if (!data || data.rows.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-fg-disabled">
        Box score not available yet.
      </div>
    );
  }

  const totals = aggregate(data.rows);
  const home = totals.filter((p) => p.teamId === homeTeamId);
  const away = totals.filter((p) => p.teamId === awayTeamId);

  return (
    <div className="grid grid-cols-1 gap-4 p-2 md:grid-cols-2">
      <TeamPanel abbr={awayTeamAbbr} players={away} />
      <TeamPanel abbr={homeTeamAbbr} players={home} />
    </div>
  );
}

function TeamPanel({
  abbr,
  players,
}: {
  abbr: string;
  players: PlayerTotals[];
}) {
  const starters = players
    .filter((p) => p.starter)
    .sort((a, b) => b.min - a.min);
  const bench = players.filter((p) => !p.starter).sort((a, b) => b.min - a.min);

  const teamTotal = players.reduce(
    (acc, p) => ({
      min: acc.min + p.min,
      pts: acc.pts + p.pts,
      fg3m: acc.fg3m + p.fg3m,
      reb: acc.reb + p.reb,
      ast: acc.ast + p.ast,
    }),
    { min: 0, pts: 0, fg3m: 0, reb: 0, ast: 0 },
  );

  return (
    <div className="overflow-hidden rounded border border-border">
      <div className="border-b border-border bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-fg">
        {abbr}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-fg-disabled">
              <th className="text-left px-3 py-1.5 font-medium">Player</th>
              <Th label="MIN" />
              <Th label="PTS" />
              <Th label="3PM" />
              <Th label="REB" />
              <Th label="AST" />
              <Th label="PRA" />
              <Th label="PR" />
              <Th label="PA" />
              <Th label="RA" />
            </tr>
          </thead>
          <tbody>
            <GroupHeader label="Starters" />
            {starters.length === 0 ? (
              <EmptyRow label="No starter data" />
            ) : (
              starters.map((p) => <PlayerRow key={p.playerId} p={p} />)
            )}
            <GroupHeader label="Bench" />
            {bench.length === 0 ? (
              <EmptyRow label="No bench data" />
            ) : (
              bench.map((p) => <PlayerRow key={p.playerId} p={p} />)
            )}
            {players.length > 0 && (
              <tr className="border-t border-border bg-surface font-semibold text-fg">
                <td className="px-3 py-1.5">Team</td>
                <td className="px-2 py-1.5 text-right">
                  {fmtMin(teamTotal.min)}
                </td>
                <td className="px-2 py-1.5 text-right">{teamTotal.pts}</td>
                <td className="px-2 py-1.5 text-right">{teamTotal.fg3m}</td>
                <td className="px-2 py-1.5 text-right">{teamTotal.reb}</td>
                <td className="px-2 py-1.5 text-right">{teamTotal.ast}</td>
                <td className="px-2 py-1.5 text-right">
                  {teamTotal.pts + teamTotal.reb + teamTotal.ast}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {teamTotal.pts + teamTotal.reb}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {teamTotal.pts + teamTotal.ast}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {teamTotal.reb + teamTotal.ast}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ label }: { label: string }) {
  return <th className="px-2 py-1.5 text-right font-medium">{label}</th>;
}

function GroupHeader({ label }: { label: string }) {
  return (
    <tr className="bg-surface text-fg-disabled">
      <td
        colSpan={10}
        className="px-3 py-1 text-[10px] uppercase tracking-wider"
      >
        {label}
      </td>
    </tr>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={10} className="px-3 py-1.5 text-fg-disabled italic">
        {label}
      </td>
    </tr>
  );
}

function PlayerRow({ p }: { p: PlayerTotals }) {
  const pra = p.pts + p.reb + p.ast;
  const pr = p.pts + p.reb;
  const pa = p.pts + p.ast;
  const ra = p.reb + p.ast;
  const minStr = fmtMin(p.min);
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-1 text-fg">
        {p.starter && <span className="mr-1 text-brand">*</span>}
        <a href={`/nba/player/${p.playerId}`} className="hover:underline">
          {p.playerName}
        </a>
      </td>
      <td className="px-2 py-1 text-right text-fg-muted">{minStr}</td>
      <td className="px-2 py-1 text-right text-fg-muted">{avg(p.pts, 0)}</td>
      <td className="px-2 py-1 text-right text-fg-muted">{avg(p.fg3m, 0)}</td>
      <td className="px-2 py-1 text-right text-fg-muted">{avg(p.reb, 0)}</td>
      <td className="px-2 py-1 text-right text-fg-muted">{avg(p.ast, 0)}</td>
      <td className="px-2 py-1 text-right text-fg-muted">{avg(pra, 0)}</td>
      <td className="px-2 py-1 text-right text-fg-muted">{avg(pr, 0)}</td>
      <td className="px-2 py-1 text-right text-fg-muted">{avg(pa, 0)}</td>
      <td className="px-2 py-1 text-right text-fg-muted">{avg(ra, 0)}</td>
    </tr>
  );
}
