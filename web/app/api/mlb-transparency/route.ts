import { NextRequest } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import { getPool } from "@/lib/db";
import { todayCT } from "@/lib/mlbLive";
import mssql from "mssql";

// Transparency (/mlb/transparency). Per-day settled performance of the
// odds-free props board (mlb.batter_prop_projections), graded against the
// realized outcome on each as-of date with the SAME market definitions the
// engine uses (HR from at-bats; HRR h+r+rbi>=2 / HITS hits>=1 from the deduped
// batting line). Works despite the dead odds key — this board never used odds.
// Answers "is it working": did higher tiers hit more than lower tiers, day over
// day. Complements the weekly model-side grade_calibration_history.

export interface TierDay {
  date: string;
  market: "HR" | "HRR" | "HITS";
  tier: string; // Elite | Strong | AboveAvg | Average | Fade
  nProj: number;
  nPlayed: number;
  nHit: number;
  hitRate: number | null; // nHit / nPlayed
}

export interface TransparencyResponse {
  rows: TierDay[]; // per (date, market, tier)
}

// Realized outcome per batter per date, then grade each projection. Bounded to
// dates that actually have projections + are strictly past + whose box scores
// are loaded (games final that day). Grouped server-side.
const SQL = `
WITH proj_dates AS (
  SELECT DISTINCT as_of_date FROM mlb.batter_prop_projections
  WHERE as_of_date < @today
),
pab_d AS (
  SELECT batter_id, CAST(game_date AS DATE) AS d,
    MAX(CASE WHEN result_event_type = 'home_run' THEN 1 ELSE 0 END) AS hr
  FROM mlb.player_at_bats
  WHERE CAST(game_date AS DATE) IN (SELECT as_of_date FROM proj_dates)
  GROUP BY batter_id, CAST(game_date AS DATE)
),
bs_d AS (
  SELECT batter_id, d, MAX(hrr) AS hrr, MAX(hit) AS hit FROM (
    SELECT player_id AS batter_id, CAST(game_date AS DATE) AS d,
      CASE WHEN (hits + runs + rbi) >= 2 THEN 1 ELSE 0 END AS hrr,
      CASE WHEN hits >= 1 THEN 1 ELSE 0 END AS hit,
      ROW_NUMBER() OVER (PARTITION BY game_pk, player_id ORDER BY plate_appearances DESC) AS rn
    FROM mlb.batting_stats
    WHERE CAST(game_date AS DATE) IN (SELECT as_of_date FROM proj_dates)
      AND (at_bats > 0 OR plate_appearances > 0)
  ) z WHERE rn = 1 GROUP BY batter_id, d
),
outcome AS (
  SELECT COALESCE(p.batter_id, b.batter_id) AS batter_id,
    COALESCE(p.d, b.d) AS d,
    ISNULL(p.hr, 0) AS hr, ISNULL(b.hrr, 0) AS hrr, ISNULL(b.hit, 0) AS hit
  FROM pab_d p FULL OUTER JOIN bs_d b ON p.batter_id = b.batter_id AND p.d = b.d
)
SELECT
  CONVERT(VARCHAR(10), pr.as_of_date, 120) AS date,
  pr.market AS market,
  pr.tier   AS tier,
  COUNT(*)  AS nProj,
  SUM(CASE WHEN o.batter_id IS NULL THEN 0 ELSE 1 END) AS nPlayed,
  SUM(CASE WHEN o.batter_id IS NULL THEN 0 ELSE
      CASE pr.market WHEN 'HR' THEN o.hr WHEN 'HRR' THEN o.hrr WHEN 'HITS' THEN o.hit END
  END) AS nHit
FROM mlb.batter_prop_projections pr
LEFT JOIN outcome o ON o.batter_id = pr.batter_id AND o.d = pr.as_of_date
WHERE pr.as_of_date < @today
GROUP BY pr.as_of_date, pr.market, pr.tier
HAVING SUM(CASE WHEN o.batter_id IS NULL THEN 0 ELSE 1 END) > 0
ORDER BY pr.as_of_date DESC, pr.market, pr.tier
`;

interface RawRow {
  date: string;
  market: "HR" | "HRR" | "HITS";
  tier: string;
  nProj: number;
  nPlayed: number;
  nHit: number;
}

export async function GET(req: NextRequest) {
  try {
    const pool = await getPool();
    const res = await pool
      .request()
      .input("today", mssql.VarChar, todayCT())
      .query(SQL);

    const rows: TierDay[] = (res.recordset as RawRow[]).map((r) => ({
      date: r.date,
      market: r.market,
      tier: r.tier,
      nProj: r.nProj,
      nPlayed: r.nPlayed,
      nHit: r.nHit,
      hitRate: r.nPlayed > 0 ? r.nHit / r.nPlayed : null,
    }));

    return jsonWithEtag(req, { rows } satisfies TransparencyResponse);
  } catch (err) {
    return apiError(err, "api/mlb-transparency");
  }
}
