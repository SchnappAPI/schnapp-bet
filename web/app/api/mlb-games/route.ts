import { NextRequest, NextResponse } from "next/server";
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { fetchMlbLiveOverlay, todayCT } from "@/lib/mlbLive";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayCT();

  const pool = await getPool();
  const result = await pool
    .request()
    .input("date", mssql.VarChar, date)
    .query(
      `SELECT
         g.game_pk           AS gameId,
         CONVERT(VARCHAR(10), g.game_date, 120) AS gameDate,
         g.game_status       AS gameStatus,
         g.game_display      AS gameDisplay,
         g.away_team_id      AS awayTeamId,
         g.home_team_id      AS homeTeamId,
         at.team_abbreviation AS awayTeamAbbr,
         ht.team_abbreviation AS homeTeamAbbr,
         at.full_name        AS awayTeamName,
         ht.full_name        AS homeTeamName,
         g.away_team_score   AS awayScore,
         g.home_team_score   AS homeScore,
         g.game_datetime     AS gameDateTime,
         g.away_pitcher_name AS awayPitcher,
         g.home_pitcher_name AS homePitcher,
         g.away_pitcher_hand AS awayPitcherHand,
         g.home_pitcher_hand AS homePitcherHand
       FROM mlb.games g
       JOIN mlb.teams at ON at.team_id = g.away_team_id
       JOIN mlb.teams ht ON ht.team_id = g.home_team_id
       WHERE CONVERT(VARCHAR(10), g.game_date, 120) = @date
       ORDER BY g.game_datetime, g.game_pk`,
    );

  // Schedule source. mlb.games is a nightly-loaded cache that lags the live
  // slate: it can hold zero rows for today until the nightly runs, and never
  // holds a future date. The schedule is knowable in advance from statsapi,
  // so for today and future dates we (a) ENRICH in-progress DB rows with live
  // scores/status and (b) SEED any game on the statsapi slate the DB has not
  // cached yet — otherwise the page renders "No games scheduled" over a live
  // slate. Past dates stay DB-only: an empty past date genuinely has no data.
  let games: Record<string, unknown>[] = [...result.recordset];
  if (date >= todayCT()) {
    const overlay = await fetchMlbLiveOverlay(date);
    if (overlay.size > 0) {
      // (a) Enrich existing DB rows. The DB stays authoritative for identity
      // and pitchers (incl. pitch hand); the overlay only moves live fields.
      games = games.map((g) => {
        const o = overlay.get(g.gameId as number);
        if (!o) return g;
        return {
          ...g,
          gameStatus: o.gameStatus,
          awayScore: o.awayScore ?? g.awayScore,
          homeScore: o.homeScore ?? g.homeScore,
          liveLabel: o.liveLabel,
        };
      });

      // (b) Seed games the DB is missing (today before the nightly load, or a
      // future date not yet cached). statsapi carries no team abbreviation, so
      // resolve id -> abbr/name from mlb.teams. Pitch hand is unknown pregame.
      const dbPks = new Set(games.map((g) => g.gameId as number));
      const missing = [...overlay.values()].filter((o) => !dbPks.has(o.gamePk));
      if (missing.length > 0) {
        const teamsRes = await pool.request().query<{
          team_id: number;
          team_abbreviation: string;
          full_name: string;
        }>(`SELECT team_id, team_abbreviation, full_name FROM mlb.teams`);
        const teamsById = new Map<number, { abbr: string; name: string }>();
        for (const t of teamsRes.recordset) {
          teamsById.set(t.team_id, {
            abbr: t.team_abbreviation,
            name: t.full_name,
          });
        }
        for (const o of missing) {
          const away =
            o.awayTeamId != null ? teamsById.get(o.awayTeamId) : undefined;
          const home =
            o.homeTeamId != null ? teamsById.get(o.homeTeamId) : undefined;
          const awayAbbr = away?.abbr ?? "";
          const homeAbbr = home?.abbr ?? "";
          games.push({
            gameId: o.gamePk,
            gameDate: date,
            gameStatus: o.gameStatus,
            gameDisplay: awayAbbr && homeAbbr ? `${awayAbbr}@${homeAbbr}` : "",
            awayTeamId: o.awayTeamId,
            homeTeamId: o.homeTeamId,
            awayTeamAbbr: awayAbbr,
            homeTeamAbbr: homeAbbr,
            awayTeamName: away?.name ?? o.awayTeamName ?? "",
            homeTeamName: home?.name ?? o.homeTeamName ?? "",
            awayScore: o.awayScore,
            homeScore: o.homeScore,
            gameDateTime: o.gameDateTime,
            awayPitcher: o.awayPitcher,
            homePitcher: o.homePitcher,
            awayPitcherHand: null,
            homePitcherHand: null,
            liveLabel: o.liveLabel,
          });
        }
        // Preserve the DB ORDER BY (game_datetime, game_pk) across seeds. DB
        // rows arrive as Date objects, seeded rows as ISO strings — normalize
        // both to an epoch ms so the comparison never coerces a Date via
        // toString() (which is not lexically ISO-ordered).
        const epoch = (v: unknown): number => {
          if (v == null) return 0;
          const t = (v instanceof Date ? v : new Date(v as string)).getTime();
          return Number.isNaN(t) ? 0 : t;
        };
        games.sort((a, b) => {
          const at = epoch(a.gameDateTime);
          const bt = epoch(b.gameDateTime);
          if (at !== bt) return at - bt;
          return (a.gameId as number) - (b.gameId as number);
        });
      }
    }
  }

  return NextResponse.json({ date, games });
}
