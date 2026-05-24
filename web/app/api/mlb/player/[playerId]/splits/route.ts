import { NextRequest, NextResponse } from "next/server";
import mssql from "mssql";
import { getPool } from "@/lib/db";

interface GameRow {
  gamePk: number;
  gameDate: string;
  side: string;
  oppAbbr: string | null;
  oppPitcherHand: string | null;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  recencyRank: number;
}

export interface MlbSplitRow {
  splitKey: string;
  label: string;
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
  gamePks: number[];
}

export interface MlbSplitGroup {
  groupKey: string;
  label: string;
  rows: MlbSplitRow[];
}

function aggregate(rows: GameRow[], key: string, label: string): MlbSplitRow {
  const gp = rows.length;
  if (gp === 0) {
    return {
      splitKey: key,
      label,
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
      gamePks: [],
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
    splitKey: key,
    label,
    gp,
    ab,
    h,
    hr,
    rbi,
    bb,
    k,
    avg: ab > 0 ? h / ab : null,
    obp: ab + bb > 0 ? (h + bb) / (ab + bb) : null,
    slg: ab > 0 ? tb / ab : null,
    gamePks: rows.map((r) => r.gamePk),
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

    const logRes = await pool.request().input("playerId", mssql.Int, playerId)
      .query<Omit<GameRow, "recencyRank">>(`
        WITH game_batting AS (
          SELECT
            bs.game_pk                                    AS gamePk,
            CONVERT(VARCHAR(10), g.game_date, 120)        AS gameDate,
            MAX(bs.side)                                  AS side,
            SUM(COALESCE(bs.at_bats, 0))                  AS ab,
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

    let allRows: GameRow[] = logRes.recordset.map((r, i) => ({
      ...r,
      recencyRank: i + 1,
    }));

    // Apply active filters before grouping (mirrors NBA splits behavior)
    if (fHa === "home") allRows = allRows.filter((r) => r.side === "H");
    else if (fHa === "away") allRows = allRows.filter((r) => r.side === "A");
    if (fPitcherHand)
      allRows = allRows.filter((r) => r.oppPitcherHand === fPitcherHand);

    // Re-rank after filters
    allRows = allRows.map((r, i) => ({ ...r, recencyRank: i + 1 }));

    let rows = allRows;
    if (fRange === "l5") rows = rows.filter((r) => r.recencyRank <= 5);
    else if (fRange === "l10") rows = rows.filter((r) => r.recencyRank <= 10);
    else if (fRange === "l20") rows = rows.filter((r) => r.recencyRank <= 20);

    const groups: MlbSplitGroup[] = [];

    groups.push({
      groupKey: "all",
      label: "All",
      rows: [aggregate(rows, "all", "All splits")],
    });

    groups.push({
      groupKey: "location",
      label: "Location",
      rows: [
        aggregate(
          rows.filter((r) => r.side === "H"),
          "home",
          "Home",
        ),
        aggregate(
          rows.filter((r) => r.side === "A"),
          "away",
          "Away",
        ),
      ],
    });

    const hasHandData = rows.some((r) => r.oppPitcherHand != null);
    if (hasHandData) {
      groups.push({
        groupKey: "pitcher_hand",
        label: "Pitcher hand",
        rows: [
          aggregate(
            rows.filter((r) => r.oppPitcherHand === "L"),
            "vs_lhp",
            "vs LHP",
          ),
          aggregate(
            rows.filter((r) => r.oppPitcherHand === "R"),
            "vs_rhp",
            "vs RHP",
          ),
        ],
      });
    }

    groups.push({
      groupKey: "recent",
      label: "Recent form",
      rows: [
        aggregate(
          allRows.filter((r) => r.recencyRank <= 5),
          "l5",
          "Last 5",
        ),
        aggregate(
          allRows.filter((r) => r.recencyRank <= 10),
          "l10",
          "Last 10",
        ),
        aggregate(
          allRows.filter((r) => r.recencyRank <= 20),
          "l20",
          "Last 20",
        ),
      ],
    });

    return NextResponse.json({
      playerId,
      total_games: rows.length,
      groups,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
