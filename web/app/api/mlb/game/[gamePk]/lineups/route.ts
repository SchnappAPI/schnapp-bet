import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import mssql from "mssql";
import { getPool } from "@/lib/db";

// Lineups for one game, pregame-first. Confirmed lineups come from
// mlb.daily_lineups (written intraday by mlb_lineup_poll.py); when a team's
// lineup has not posted yet we derive a "projected" nine at read time from
// recent batting orders (same heuristic family as compute_mlb_projections).
//
// Each batter ships with their current-season per-game rows tagged with the
// opposing starter's hand, so every client toggle (L5/L10/L20 x overall /
// vs-hand) is a pure slice — one round trip per game, no refetch.

export interface LineupBatterGame {
  gamePk: number;
  gameDate: string;
  oppStarterHand: string | null;
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  tb: number;
}

export interface LineupBatter {
  playerId: number;
  playerName: string | null;
  batSide: string | null;
  position: string | null;
  battingOrder: number;
  games: LineupBatterGame[];
}

export interface LineupPitcher {
  playerId: number;
  name: string | null;
  hand: string | null;
  season: {
    era: number | null;
    whip: number | null;
    inningsPitched: number | null;
    strikeouts: number | null;
    kPer9: number | null;
    wins: number | null;
    losses: number | null;
    gamesStarted: number | null;
    avgAgainst: number | null;
    opsAgainst: number | null;
  } | null;
}

export interface TeamLineup {
  teamId: number;
  teamAbbr: string;
  lineupStatus: "confirmed" | "projected" | "unavailable";
  pitcher: LineupPitcher | null;
  batters: LineupBatter[];
}

interface GameRow {
  gamePk: number;
  gameDate: string;
  gameStatus: string | null;
  awayTeamId: number;
  awayTeamAbbr: string;
  homeTeamId: number;
  homeTeamAbbr: string;
  awayPitcherId: number | null;
  awayPitcherName: string | null;
  awayPitcherHand: string | null;
  homePitcherId: number | null;
  homePitcherName: string | null;
  homePitcherHand: string | null;
}

interface LineupRow {
  teamId: number;
  playerId: number;
  battingOrder: number;
  position: string | null;
}

async function fetchProjectedNine(
  pool: mssql.ConnectionPool,
  teamId: number,
  gameDate: string,
): Promise<LineupRow[]> {
  // Players who started (hundreds batting_order) in the team's last 10
  // games, regulars-first, ordered by their typical slot.
  const res = await pool
    .request()
    .input("teamId", mssql.Int, teamId)
    .input("gameDate", mssql.VarChar, gameDate)
    .query<LineupRow & { appearances: number }>(`
      WITH team_games AS (
        SELECT DISTINCT TOP (10) bs.game_pk, bs.game_date
        FROM mlb.batting_stats bs
        WHERE bs.team_id = @teamId AND bs.game_date < @gameDate
        ORDER BY bs.game_date DESC
      ),
      pool AS (
        SELECT bs.player_id AS playerId,
               COUNT(*) AS appearances,
               MIN(bs.batting_order) AS bestOrder,
               MAX(bs.position) AS position
        FROM mlb.batting_stats bs
        JOIN team_games tg ON tg.game_pk = bs.game_pk
        WHERE bs.team_id = @teamId
          AND bs.batting_order IS NOT NULL
          AND bs.batting_order % 100 = 0
        GROUP BY bs.player_id
      )
      SELECT TOP 9
        @teamId AS teamId,
        playerId,
        position,
        appearances,
        ROW_NUMBER() OVER (
          ORDER BY CASE WHEN appearances >= 5 THEN 0 ELSE 1 END,
                   bestOrder ASC, appearances DESC
        ) AS battingOrder
      FROM pool
      ORDER BY battingOrder
    `);
  return res.recordset;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gamePk: string }> },
) {
  const { gamePk: gamePkStr } = await params;
  const gamePk = parseInt(gamePkStr, 10);
  if (isNaN(gamePk)) {
    return NextResponse.json({ error: "invalid gamePk" }, { status: 400 });
  }

  try {
    const pool = await getPool();

    const gameRes = await pool.request().input("gamePk", mssql.Int, gamePk)
      .query<GameRow>(`
        SELECT
          g.game_pk            AS gamePk,
          CONVERT(VARCHAR(10), g.game_date, 120) AS gameDate,
          g.game_status        AS gameStatus,
          at.team_id           AS awayTeamId,
          at.team_abbreviation AS awayTeamAbbr,
          ht.team_id           AS homeTeamId,
          ht.team_abbreviation AS homeTeamAbbr,
          g.away_pitcher_id    AS awayPitcherId,
          g.away_pitcher_name  AS awayPitcherName,
          g.away_pitcher_hand  AS awayPitcherHand,
          g.home_pitcher_id    AS homePitcherId,
          g.home_pitcher_name  AS homePitcherName,
          g.home_pitcher_hand  AS homePitcherHand
        FROM mlb.games g
        JOIN mlb.teams at ON at.team_id = g.away_team_id
        JOIN mlb.teams ht ON ht.team_id = g.home_team_id
        WHERE g.game_pk = @gamePk
      `);
    const game = gameRes.recordset[0];
    if (!game) {
      return NextResponse.json({ error: "game not found" }, { status: 404 });
    }

    // Confirmed lineups written by the intraday poller, if posted.
    const confirmedRes = await pool
      .request()
      .input("gamePk", mssql.Int, gamePk)
      .query<LineupRow>(`
        SELECT team_id AS teamId, player_id AS playerId,
               batting_order AS battingOrder, position
        FROM mlb.daily_lineups
        WHERE game_pk = @gamePk
        ORDER BY team_id, batting_order
      `);
    const confirmedByTeam = new Map<number, LineupRow[]>();
    for (const row of confirmedRes.recordset) {
      const list = confirmedByTeam.get(row.teamId) ?? [];
      list.push(row);
      confirmedByTeam.set(row.teamId, list);
    }

    const teams: {
      teamId: number;
      teamAbbr: string;
      pitcherId: number | null;
      pitcherName: string | null;
      pitcherHand: string | null;
      rows: LineupRow[];
      lineupStatus: "confirmed" | "projected" | "unavailable";
    }[] = [];

    for (const side of ["away", "home"] as const) {
      const teamId = side === "away" ? game.awayTeamId : game.homeTeamId;
      const teamAbbr =
        side === "away" ? game.awayTeamAbbr : game.homeTeamAbbr;
      const confirmed = confirmedByTeam.get(teamId) ?? [];
      let rows = confirmed;
      let lineupStatus: "confirmed" | "projected" | "unavailable" =
        "confirmed";
      if (rows.length === 0) {
        rows = await fetchProjectedNine(pool, teamId, game.gameDate);
        lineupStatus = rows.length > 0 ? "projected" : "unavailable";
      }
      teams.push({
        teamId,
        teamAbbr,
        pitcherId: side === "away" ? game.awayPitcherId : game.homePitcherId,
        pitcherName:
          side === "away" ? game.awayPitcherName : game.homePitcherName,
        pitcherHand:
          side === "away" ? game.awayPitcherHand : game.homePitcherHand,
        rows,
        lineupStatus,
      });
    }

    const batterIds = [
      ...new Set(teams.flatMap((t) => t.rows.map((r) => r.playerId))),
    ];

    // Batter metadata + current-season game rows, one IN-list query each.
    const metaByPlayer = new Map<
      number,
      { playerName: string | null; batSide: string | null }
    >();
    const gamesByPlayer = new Map<number, LineupBatterGame[]>();

    if (batterIds.length > 0) {
      const metaReq = pool.request();
      const gamesReq = pool.request();
      const placeholders = batterIds.map((id, i) => {
        metaReq.input(`p${i}`, mssql.Int, id);
        gamesReq.input(`p${i}`, mssql.Int, id);
        return `@p${i}`;
      });
      const inList = placeholders.join(", ");

      const metaRes = await metaReq.query<{
        playerId: number;
        playerName: string | null;
        batSide: string | null;
      }>(`
        SELECT player_id AS playerId, player_name AS playerName,
               bat_side AS batSide
        FROM mlb.players
        WHERE player_id IN (${inList})
      `);
      for (const m of metaRes.recordset) {
        metaByPlayer.set(m.playerId, {
          playerName: m.playerName,
          batSide: m.batSide,
        });
      }

      gamesReq.input("gameDate", mssql.VarChar, game.gameDate);
      gamesReq.input("gamePk", mssql.Int, gamePk);
      const gamesRes = await gamesReq.query<
        LineupBatterGame & { playerId: number }
      >(`
        SELECT
          bs.player_id AS playerId,
          bs.game_pk   AS gamePk,
          CONVERT(VARCHAR(10), g.game_date, 120) AS gameDate,
          CASE WHEN MAX(bs.side) = 'H'
               THEN MAX(g.away_pitcher_hand)
               ELSE MAX(g.home_pitcher_hand) END AS oppStarterHand,
          SUM(COALESCE(bs.plate_appearances, 0)) AS pa,
          SUM(COALESCE(bs.at_bats, 0))           AS ab,
          SUM(COALESCE(bs.hits, 0))              AS h,
          SUM(COALESCE(bs.doubles, 0))           AS doubles,
          SUM(COALESCE(bs.triples, 0))           AS triples,
          SUM(COALESCE(bs.home_runs, 0))         AS hr,
          SUM(COALESCE(bs.rbi, 0))               AS rbi,
          SUM(COALESCE(bs.walks, 0))             AS bb,
          SUM(COALESCE(bs.strikeouts, 0))        AS k,
          SUM(COALESCE(bs.total_bases, 0))       AS tb
        FROM mlb.batting_stats bs
        JOIN mlb.games g ON g.game_pk = bs.game_pk
        WHERE bs.player_id IN (${inList})
          AND bs.game_pk <> @gamePk
          AND g.game_date >= DATEFROMPARTS(YEAR(CAST(@gameDate AS DATE)), 1, 1)
          AND g.game_date <= @gameDate
        GROUP BY bs.player_id, bs.game_pk, g.game_date
        ORDER BY bs.player_id, g.game_date DESC, bs.game_pk DESC
      `);
      for (const row of gamesRes.recordset) {
        const { playerId, ...rest } = row;
        const list = gamesByPlayer.get(playerId) ?? [];
        list.push(rest);
        gamesByPlayer.set(playerId, list);
      }
    }

    // Pitcher season lines for both probables.
    const pitcherIds = teams
      .map((t) => t.pitcherId)
      .filter((id): id is number => id !== null);
    const seasonByPitcher = new Map<number, LineupPitcher["season"]>();
    if (pitcherIds.length > 0) {
      const pReq = pool.request();
      const pIn = pitcherIds
        .map((id, i) => {
          pReq.input(`sp${i}`, mssql.Int, id);
          return `@sp${i}`;
        })
        .join(", ");
      const pRes = await pReq.query<{
        playerId: number;
        era: number | null;
        whip: number | null;
        inningsPitched: number | null;
        strikeouts: number | null;
        kPer9: number | null;
        wins: number | null;
        losses: number | null;
        gamesStarted: number | null;
        avgAgainst: number | null;
        opsAgainst: number | null;
      }>(`
        SELECT player_id AS playerId,
               era,
               whip,
               innings_pitched     AS inningsPitched,
               strikeouts,
               k_per_9             AS kPer9,
               wins,
               losses,
               games_started       AS gamesStarted,
               batting_avg_against AS avgAgainst,
               ops_against         AS opsAgainst
        FROM mlb.pitcher_season_stats
        WHERE player_id IN (${pIn})
      `);
      for (const p of pRes.recordset) {
        const { playerId, ...season } = p;
        seasonByPitcher.set(playerId, season);
      }
    }

    const toTeamLineup = (t: (typeof teams)[number]): TeamLineup => ({
      teamId: t.teamId,
      teamAbbr: t.teamAbbr,
      lineupStatus: t.lineupStatus,
      pitcher:
        t.pitcherId !== null || t.pitcherName !== null
          ? {
              playerId: t.pitcherId ?? 0,
              name: t.pitcherName,
              hand: t.pitcherHand,
              season:
                t.pitcherId !== null
                  ? (seasonByPitcher.get(t.pitcherId) ?? null)
                  : null,
            }
          : null,
      batters: t.rows.map((r) => ({
        playerId: r.playerId,
        playerName: metaByPlayer.get(r.playerId)?.playerName ?? null,
        batSide: metaByPlayer.get(r.playerId)?.batSide ?? null,
        position: r.position,
        battingOrder: r.battingOrder,
        games: gamesByPlayer.get(r.playerId) ?? [],
      })),
    });

    return jsonWithEtag(req, {
      gamePk,
      gameDate: game.gameDate,
      gameStatus: game.gameStatus,
      away: toTeamLineup(teams[0]),
      home: toTeamLineup(teams[1]),
    });
  } catch (err) {
    return apiError(err, "api/mlb/game/[gamePk]/lineups");
  }
}
