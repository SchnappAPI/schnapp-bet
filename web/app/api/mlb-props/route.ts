import { NextRequest } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import { getPool } from "@/lib/db";

// Odds-free batter-prop projections board (/mlb/props). Reads the latest
// as-of slice of mlb.batter_prop_projections (written nightly by
// etl/mlb_prop_projections.py, model prop-v1) and returns every batter's
// probability for each market, joined to name + current team. The board ranks
// and tiers client-side. NO odds anywhere — pure model output.

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
  asOfDate: string | null;
  rows: PropRow[];
}

// Latest as-of slice, joined to player name + most-recent team. Numeric
// columns cast to FLOAT so they land as JSON numbers, not driver decimals.
const SQL = `
WITH la AS (
  SELECT MAX(as_of_date) AS d FROM mlb.batter_prop_projections
),
team AS (
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
JOIN la ON pr.as_of_date = la.d
LEFT JOIN mlb.players p ON p.player_id = pr.batter_id
LEFT JOIN team tm ON tm.player_id = pr.batter_id
LEFT JOIN mlb.teams t ON t.team_id = tm.team_id
ORDER BY pr.market, pr.prob DESC
`;

export async function GET(req: NextRequest) {
  try {
    const pool = await getPool();

    const dRes = await pool
      .request()
      .query(
        "SELECT CONVERT(VARCHAR(10), MAX(as_of_date), 120) AS d FROM mlb.batter_prop_projections",
      );
    const asOfDate: string | null = dRes.recordset[0]?.d ?? null;
    if (!asOfDate) {
      return jsonWithEtag(req, {
        asOfDate: null,
        rows: [],
      } satisfies PropsResponse);
    }

    const res = await pool.request().query(SQL);
    return jsonWithEtag(req, {
      asOfDate,
      rows: res.recordset as PropRow[],
    } satisfies PropsResponse);
  } catch (err) {
    return apiError(err, "api/mlb-props");
  }
}
