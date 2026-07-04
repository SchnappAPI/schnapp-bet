import { NextRequest, NextResponse } from "next/server";
import { apiError } from '@/lib/apiError';
import mssql from "mssql";
import { getPool } from "@/lib/db";

interface DbRow {
  gamePk: number;
  gameDate: string;
  side: string;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  oppAbbr: string | null;
  oppPitcherHand: string | null;
}

export interface MlbLogRow {
  gamePk: number;
  gameDate: string;
  side: string;
  oppAbbr: string | null;
  oppPitcherHand: string | null;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
}

export interface UpcomingGame {
  gamePk: number;
  gameDate: string;
  gameDateTime: string | null;
  side: string;
  oppAbbr: string | null;
  oppPitcherId: number | null;
  oppPitcherName: string | null;
  oppPitcherHand: string | null;
}

export interface BvpLine {
  pa: number | null;
  ab: number | null;
  h: number | null;
  doubles: number | null;
  triples: number | null;
  hr: number | null;
  rbi: number | null;
  bb: number | null;
  k: number | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  lastFaced: string | null;
}

export interface MlbLogAverages {
  gp: number;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
}

function computeAverages(rows: MlbLogRow[]): MlbLogAverages {
  const gp = rows.length;
  if (gp === 0) {
    return {
      gp: 0,
      ab: 0,
      h: 0,
      hr: 0,
      rbi: 0,
      bb: 0,
      k: 0,
      avg: null,
      obp: null,
      slg: null,
    };
  }
  let ab = 0,
    h = 0,
    doubles = 0,
    triples = 0,
    hr = 0,
    rbi = 0,
    bb = 0,
    k = 0;
  for (const r of rows) {
    ab += r.ab;
    h += r.h;
    doubles += r.doubles;
    triples += r.triples;
    hr += r.hr;
    rbi += r.rbi;
    bb += r.bb;
    k += r.k;
  }
  const singles = h - doubles - triples - hr;
  const tb = singles + 2 * doubles + 3 * triples + 4 * hr;
  return {
    gp,
    ab: Math.round((ab / gp) * 10) / 10,
    h: Math.round((h / gp) * 10) / 10,
    hr: Math.round((hr / gp) * 10) / 10,
    rbi: Math.round((rbi / gp) * 10) / 10,
    bb: Math.round((bb / gp) * 10) / 10,
    k: Math.round((k / gp) * 10) / 10,
    avg: ab > 0 ? h / ab : null,
    obp: ab + bb > 0 ? (h + bb) / (ab + bb) : null,
    slg: ab > 0 ? tb / ab : null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId: playerIdStr } = await params;
  const playerId = parseInt(playerIdStr, 10);
  if (isNaN(playerId)) {
    return NextResponse.json({ error: "invalid playerId" }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;
  const fRange = sp.get("range") ?? "season";
  const fHa = sp.get("ha")?.toLowerCase() ?? null;
  const fPitcherHand = sp.get("pitcherHand")?.toUpperCase() ?? null;

  try {
    const pool = await getPool();

    // Player metadata
    const metaRes = await pool.request().input("playerId", mssql.Int, playerId)
      .query(`
        SELECT TOP 1
          p.player_name AS playerName,
          t.team_abbreviation AS teamAbbr,
          t.full_name AS teamName,
          t.team_id AS teamId,
          bs.position
        FROM mlb.players p
        LEFT JOIN (
          SELECT TOP 1 bs2.player_id, bs2.position,
            CASE WHEN bs2.side = 'A' THEN g2.away_team_id ELSE g2.home_team_id END AS team_id
          FROM mlb.batting_stats bs2
          JOIN mlb.games g2 ON g2.game_pk = bs2.game_pk
          WHERE bs2.player_id = @playerId
          ORDER BY g2.game_date DESC, g2.game_pk DESC
        ) bs ON bs.player_id = p.player_id
        LEFT JOIN mlb.teams t ON t.team_id = bs.team_id
        WHERE p.player_id = @playerId
      `);
    const meta = metaRes.recordset[0] ?? null;

    // Per-game batting log
    const logRes = await pool.request().input("playerId", mssql.Int, playerId)
      .query<DbRow>(`
        WITH game_batting AS (
          SELECT
            bs.game_pk AS gamePk,
            CONVERT(VARCHAR(10), g.game_date, 120)       AS gameDate,
            MAX(bs.side)                                  AS side,
            SUM(COALESCE(bs.at_bats, 0))                  AS ab,
            SUM(COALESCE(bs.runs, 0))                     AS r,
            SUM(COALESCE(bs.hits, 0))                     AS h,
            SUM(COALESCE(bs.doubles, 0))                  AS doubles,
            SUM(COALESCE(bs.triples, 0))                  AS triples,
            SUM(COALESCE(bs.home_runs, 0))                AS hr,
            SUM(COALESCE(bs.rbi, 0))                      AS rbi,
            SUM(COALESCE(bs.walks, 0))                    AS bb,
            SUM(COALESCE(bs.strikeouts, 0))               AS k,
            CASE WHEN MAX(bs.side) = 'A'
                 THEN MAX(ht.team_abbreviation)
                 ELSE MAX(at.team_abbreviation) END        AS oppAbbr,
            CASE WHEN MAX(bs.side) = 'H'
                 THEN MAX(g.away_pitcher_hand)
                 ELSE MAX(g.home_pitcher_hand) END         AS oppPitcherHand
          FROM mlb.batting_stats bs
          JOIN mlb.games g ON g.game_pk = bs.game_pk
          JOIN mlb.teams at ON at.team_id = g.away_team_id
          JOIN mlb.teams ht ON ht.team_id = g.home_team_id
          WHERE bs.player_id = @playerId
          GROUP BY bs.game_pk, g.game_date
        )
        SELECT * FROM game_batting
        ORDER BY gameDate DESC, gamePk DESC
      `);

    let rows: MlbLogRow[] = logRes.recordset.map((r) => ({
      gamePk: r.gamePk,
      gameDate: r.gameDate,
      side: r.side,
      oppAbbr: r.oppAbbr,
      oppPitcherHand: r.oppPitcherHand,
      ab: r.ab,
      r: r.r,
      h: r.h,
      doubles: r.doubles,
      triples: r.triples,
      hr: r.hr,
      rbi: r.rbi,
      bb: r.bb,
      k: r.k,
    }));

    // Apply filters
    if (fHa === "home") rows = rows.filter((r) => r.side === "H");
    else if (fHa === "away") rows = rows.filter((r) => r.side === "A");
    if (fPitcherHand)
      rows = rows.filter((r) => r.oppPitcherHand === fPitcherHand);

    // Assign recency rank after ha/hand filters so range slices correctly
    const ranked = rows.map((r, i) => ({ ...r, recencyRank: i + 1 }));
    if (fRange === "l5") rows = ranked.filter((r) => r.recencyRank <= 5);
    else if (fRange === "l10") rows = ranked.filter((r) => r.recencyRank <= 10);
    else if (fRange === "l20") rows = ranked.filter((r) => r.recencyRank <= 20);
    else rows = ranked;

    // Upcoming game for the player's team, with the opposing probable SP.
    let upcoming: UpcomingGame | null = null;
    let bvp: BvpLine | null = null;
    if (meta?.teamId != null) {
      const upRes = await pool
        .request()
        .input("teamId", mssql.Int, meta.teamId)
        .query<UpcomingGame>(`
          SELECT TOP 1
            g.game_pk AS gamePk,
            CONVERT(VARCHAR(10), g.game_date, 120) AS gameDate,
            g.game_datetime AS gameDateTime,
            CASE WHEN g.home_team_id = @teamId THEN 'H' ELSE 'A' END AS side,
            CASE WHEN g.home_team_id = @teamId
                 THEN at.team_abbreviation
                 ELSE ht.team_abbreviation END AS oppAbbr,
            CASE WHEN g.home_team_id = @teamId
                 THEN g.away_pitcher_id ELSE g.home_pitcher_id END AS oppPitcherId,
            CASE WHEN g.home_team_id = @teamId
                 THEN g.away_pitcher_name ELSE g.home_pitcher_name END AS oppPitcherName,
            CASE WHEN g.home_team_id = @teamId
                 THEN g.away_pitcher_hand ELSE g.home_pitcher_hand END AS oppPitcherHand
          FROM mlb.games g
          JOIN mlb.teams at ON at.team_id = g.away_team_id
          JOIN mlb.teams ht ON ht.team_id = g.home_team_id
          WHERE (g.home_team_id = @teamId OR g.away_team_id = @teamId)
            AND (g.game_status IS NULL OR g.game_status <> 'F')
            AND g.game_date >= CAST(DATEADD(HOUR, -6, GETUTCDATE()) AS DATE)
          ORDER BY g.game_date ASC, g.game_datetime ASC
        `);
      upcoming = upRes.recordset[0] ?? null;

      // Career batter-vs-pitcher line against that probable, if any history.
      if (upcoming?.oppPitcherId != null) {
        const bvpRes = await pool
          .request()
          .input("playerId", mssql.Int, playerId)
          .input("pitcherId", mssql.Int, upcoming.oppPitcherId)
          .query<BvpLine>(`
            SELECT plate_appearances AS pa,
                   at_bats AS ab,
                   hits AS h,
                   doubles,
                   triples,
                   home_runs AS hr,
                   rbi,
                   walks AS bb,
                   strikeouts AS k,
                   batting_avg AS avg,
                   obp,
                   slg,
                   ops,
                   CONVERT(VARCHAR(10), last_faced_date, 120) AS lastFaced
            FROM mlb.career_batter_vs_pitcher
            WHERE batter_id = @playerId AND pitcher_id = @pitcherId
          `);
        bvp = bvpRes.recordset[0] ?? null;
      }
    }

    return NextResponse.json({
      playerId,
      playerName: meta?.playerName ?? null,
      teamAbbr: meta?.teamAbbr ?? null,
      teamName: meta?.teamName ?? null,
      position: meta?.position ?? null,
      rows,
      averages: computeAverages(rows),
      upcoming,
      bvp,
    });
  } catch (err) {
    return apiError(err, 'api/mlb/player/[playerId]/log');
  }
}
