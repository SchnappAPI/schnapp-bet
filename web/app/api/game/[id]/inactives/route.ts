import { NextRequest, NextResponse } from "next/server";
import { apiError } from '@/lib/apiError';
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { jsonWithEtag } from "@/lib/etag";

interface DbRow {
  playerName: string;
  playerId: number | null;
  teamTricode: string;
  homeAway: string;
  position: string | null;
  lineupStatus: string | null;
  rosterStatus: string | null;
}

interface Inactive {
  playerName: string;
  playerId: number | null;
  teamTricode: string;
  homeOrAway: "home" | "away";
  reason: string;
}

// roster_status is the authoritative inactive flag for NBA daily_lineups
// (sampled values: 'Active' | 'Inactive'). lineup_status describes how
// confirmed the projected starting five is and applies to active players,
// so it does not gate inactives.
function isInactive(rosterStatus: string | null): boolean {
  return (rosterStatus ?? "").toLowerCase() === "inactive";
}

function deriveReason(
  lineupStatus: string | null,
  rosterStatus: string | null,
): string {
  // lineup_status occasionally carries the specific reason ("Out - Knee" etc).
  // Treat the bare "Confirmed" / "Probable" tokens as non-reasons and fall
  // back to roster_status when that's the case.
  const ls = (lineupStatus ?? "").trim();
  const lower = ls.toLowerCase();
  if (ls.length > 0 && lower !== "confirmed" && lower !== "probable") return ls;
  return (rosterStatus ?? "inactive").trim();
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
           dl.player_name   AS playerName,
           p.player_id      AS playerId,
           dl.team_tricode  AS teamTricode,
           dl.home_away     AS homeAway,
           dl.position      AS position,
           dl.lineup_status AS lineupStatus,
           dl.roster_status AS rosterStatus
         FROM nba.daily_lineups dl
         LEFT JOIN nba.players p
           ON p.player_name COLLATE Latin1_General_CI_AI
            = dl.player_name COLLATE Latin1_General_CI_AI
         WHERE dl.game_id = @gameId`,
      );

    const inactives: Inactive[] = result.recordset
      .filter((r) => isInactive(r.rosterStatus))
      .map((r) => ({
        playerName: r.playerName,
        playerId: r.playerId,
        teamTricode: r.teamTricode,
        homeOrAway: r.homeAway.toLowerCase() === "home" ? "home" : "away",
        reason: deriveReason(r.lineupStatus, r.rosterStatus),
      }));

    return jsonWithEtag(req, {
      game_id: id,
      total: inactives.length,
      inactives,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return apiError(err, 'api/game/[id]/inactives');
  }
}
