import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import mssql from "mssql";
import { getPool } from "@/lib/db";

// Per-PA log for one batter with the research page's unified filters
// (date window, pitcher hand, AB number). Same row shape as the player
// page's atbats route so client formatting is shared; this one adds the
// filter dimensions server-side (docs/features/mlb-research-dashboard.md
// Phase 2).

export interface ResearchAtBatRow {
  atBatId: string;
  gamePk: number;
  gameDate: string;
  inning: number | null;
  atBatNumber: number;
  oppAbbr: string | null;
  pitcherId: number | null;
  pitcherName: string | null;
  pitcherHand: string | null;
  result: string | null;
  resultDesc: string | null;
  rbi: number | null;
  ev: number | null;
  la: number | null;
  dist: number | null;
  trajectory: string | null;
  hardness: string | null;
  xba: number | null;
  batSpeed: number | null;
  hrParks: number | null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const batterId = parseInt(sp.get("batterId") ?? "", 10);
  if (isNaN(batterId)) {
    return NextResponse.json({ error: "invalid batterId" }, { status: 400 });
  }
  const from = sp.get("from");
  const to = sp.get("to");
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !dateRe.test(from)) || (to && !dateRe.test(to))) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  const hand = sp.get("hand");
  if (hand && hand !== "L" && hand !== "R") {
    return NextResponse.json({ error: "invalid hand" }, { status: 400 });
  }
  const abNumRaw = sp.get("abNum");
  const abNum = abNumRaw ? parseInt(abNumRaw, 10) : null;
  if (abNumRaw && (isNaN(abNum!) || abNum! < 1 || abNum! > 9)) {
    return NextResponse.json({ error: "invalid abNum" }, { status: 400 });
  }

  try {
    const pool = await getPool();
    const r = pool.request().input("batterId", mssql.Int, batterId);
    const where: string[] = ["ab.batter_id = @batterId"];
    if (from) {
      r.input("from", mssql.VarChar, from);
      where.push("ab.game_date >= @from");
    } else {
      where.push("ab.game_date >= DATEFROMPARTS(YEAR(GETUTCDATE()), 1, 1)");
    }
    if (to) {
      r.input("to", mssql.VarChar, to);
      where.push("ab.game_date <= @to");
    }
    if (hand) {
      r.input("hand", mssql.VarChar, hand);
      where.push("p.pitch_hand = @hand");
    }
    if (abNum != null) {
      r.input("abNum", mssql.Int, abNum);
      where.push("ab.at_bat_number = @abNum");
    }

    const res = await r.query<ResearchAtBatRow>(`
      SELECT
        ab.at_bat_id          AS atBatId,
        ab.game_pk            AS gamePk,
        CONVERT(VARCHAR(10), ab.game_date, 120) AS gameDate,
        ab.inning,
        ab.at_bat_number      AS atBatNumber,
        t.team_abbreviation   AS oppAbbr,
        ab.pitcher_id         AS pitcherId,
        p.player_name         AS pitcherName,
        p.pitch_hand          AS pitcherHand,
        ab.result_event_type  AS result,
        ab.result_description AS resultDesc,
        ab.result_rbi         AS rbi,
        ab.hit_launch_speed   AS ev,
        ab.hit_launch_angle   AS la,
        ab.hit_total_distance AS dist,
        ab.hit_trajectory     AS trajectory,
        ab.hit_hardness       AS hardness,
        ab.hit_probability    AS xba,
        ab.hit_bat_speed      AS batSpeed,
        ab.home_run_ballparks AS hrParks
      FROM mlb.player_at_bats ab
      LEFT JOIN mlb.teams t
        ON t.team_id = CASE WHEN ab.is_top_inning = 1
                            THEN ab.home_team_id
                            ELSE ab.away_team_id END
      LEFT JOIN mlb.players p ON p.player_id = ab.pitcher_id
      WHERE ${where.join(" AND ")}
      ORDER BY ab.game_date DESC, ab.game_pk DESC, ab.at_bat_number DESC
    `);

    return jsonWithEtag(req, {
      batterId,
      from,
      to,
      hand,
      abNum,
      atBats: res.recordset,
    });
  } catch (err) {
    return apiError(err, "api/mlb/research/atbats");
  }
}
