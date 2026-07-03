import { NextRequest, NextResponse } from "next/server";
import { apiError } from '@/lib/apiError';
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { jsonWithEtag } from "@/lib/etag";

type Status = "confirmed" | "probable" | "locked" | "unknown";

interface DbRow {
  homeAway: string;
  lineupRows: number;
  confirmedCount: number;
  probableCount: number;
  latestCreatedAt: string | null;
}

function deriveStatus(row: DbRow | undefined): Status {
  if (!row || row.lineupRows === 0) return "unknown";
  if (row.confirmedCount > 0) return "confirmed";
  if (row.probableCount > 0) return "probable";
  return "locked";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "gameId required" }, { status: 400 });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("gameId", mssql.VarChar, id)
      .query<DbRow>(
        `SELECT
           dl.home_away AS homeAway,
           COUNT(*)     AS lineupRows,
           SUM(CASE WHEN LOWER(dl.lineup_status) LIKE '%confirm%' THEN 1 ELSE 0 END) AS confirmedCount,
           SUM(CASE WHEN LOWER(dl.lineup_status) LIKE '%probable%'  THEN 1 ELSE 0 END) AS probableCount,
           CONVERT(VARCHAR(33), MAX(dl.created_at), 126) AS latestCreatedAt
         FROM nba.daily_lineups dl
         WHERE dl.game_id = @gameId
         GROUP BY dl.home_away`,
      );

    const byTeam = new Map<string, DbRow>();
    for (const r of result.recordset) {
      byTeam.set(r.homeAway.toLowerCase(), r);
    }

    const home = deriveStatus(byTeam.get("home"));
    const away = deriveStatus(byTeam.get("away"));

    // Overall = worst of the two (unknown < locked < probable < confirmed),
    // but the pill semantics in spec are "starters probable / confirmed", so
    // return the most-advanced state both teams have reached together. If
    // either is unknown, overall is unknown so the UI hides the pill.
    const order: Status[] = ["unknown", "locked", "probable", "confirmed"];
    const overall: Status =
      home === "unknown" || away === "unknown"
        ? "unknown"
        : order[Math.min(order.indexOf(home), order.indexOf(away))];

    const latest =
      [byTeam.get("home")?.latestCreatedAt, byTeam.get("away")?.latestCreatedAt]
        .filter((v): v is string => v != null)
        .sort()
        .pop() ?? null;

    return jsonWithEtag(req, {
      game_id: id,
      home,
      away,
      overall,
      latest_updated_at: latest,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return apiError(err, 'api/game/[id]/lineup-status');
  }
}
