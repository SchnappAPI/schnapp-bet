import { NextRequest } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import { getPool } from "@/lib/db";
import mssql from "mssql";

// Odds-free batter-prop projections board (/mlb/props). Reads one as-of slice
// of mlb.batter_prop_projections (written nightly by
// etl/mlb_prop_projections.py, model prop-v1) and returns every batter's
// probability for each market, joined to name + current team. Accepts an
// optional ?date=YYYY-MM-DD to page through history; defaults to the latest
// slice. availableDates bounds the board's prev/next nav. The board ranks and
// tiers client-side. NO odds anywhere — pure model output.

export type PropMarket = "HR" | "HRR" | "HITS";

export interface PropRow {
  batterId: number;
  batterName: string | null;
  teamAbbr: string | null;
  market: PropMarket;
  prob: number; // 0..1
  baseRate: number; // league mean for the market
  lift: number; // prob / baseRate (x vs average)
  tier: string; // Elite | Strong | AboveAvg | Average | Fade
  priorGames: number;
  recentBarrelsPg: number | null; // trailing-20g barrels/game (HR form input)
}

export interface PropsResponse {
  asOfDate: string | null; // the resolved slice being shown
  availableDates: string[]; // ascending list of as-of dates that have rows
  rows: PropRow[];
}

// One slice, joined to player name + most-recent team. Numeric columns cast to
// FLOAT so they land as JSON numbers, not driver decimals.
const SQL = `
WITH team AS (
  SELECT player_id, team_id FROM (
    SELECT player_id, team_id,
      ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY game_date DESC) AS rn
    FROM mlb.batting_stats
  ) z WHERE rn = 1
)
SELECT
  pr.batter_id                    AS batterId,
  p.player_name                   AS batterName,
  t.team_abbreviation             AS teamAbbr,
  pr.market                       AS market,
  CAST(pr.prob AS FLOAT)          AS prob,
  CAST(pr.base_rate AS FLOAT)     AS baseRate,
  CAST(pr.lift AS FLOAT)          AS lift,
  pr.tier                         AS tier,
  pr.prior_games                  AS priorGames,
  CAST(pr.recent_barrels_pg AS FLOAT) AS recentBarrelsPg
FROM mlb.batter_prop_projections pr
LEFT JOIN mlb.players p ON p.player_id = pr.batter_id
LEFT JOIN team tm ON tm.player_id = pr.batter_id
LEFT JOIN mlb.teams t ON t.team_id = tm.team_id
WHERE pr.as_of_date = @d
ORDER BY pr.market, pr.prob DESC
`;

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get("date");
  try {
    const pool = await getPool();

    const datesRes = await pool
      .request()
      .query(
        "SELECT DISTINCT CONVERT(VARCHAR(10), as_of_date, 120) AS d FROM mlb.batter_prop_projections ORDER BY d",
      );
    const availableDates: string[] = datesRes.recordset.map(
      (r: { d: string }) => r.d,
    );
    if (availableDates.length === 0) {
      return jsonWithEtag(req, {
        asOfDate: null,
        availableDates: [],
        rows: [],
      } satisfies PropsResponse);
    }

    // Resolve the requested date if valid and present, else the latest slice.
    const asOfDate =
      dateParam &&
      /^\d{4}-\d{2}-\d{2}$/.test(dateParam) &&
      availableDates.includes(dateParam)
        ? dateParam
        : availableDates[availableDates.length - 1];

    const res = await pool
      .request()
      .input("d", mssql.VarChar, asOfDate)
      .query(SQL);

    return jsonWithEtag(req, {
      asOfDate,
      availableDates,
      rows: res.recordset as PropRow[],
    } satisfies PropsResponse);
  } catch (err) {
    return apiError(err, "api/mlb-props");
  }
}
