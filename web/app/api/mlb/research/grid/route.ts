import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { jsonWithEtag } from "@/lib/etag";
import mssql from "mssql";
import { getPool } from "@/lib/db";

// The research heat grid: both lineups for one game, per-batter Statcast
// aggregates over an arbitrary date window, plus latest trend/platoon
// columns, career BvP vs the opposing probable, and pivoted projections
// (docs/features/mlb-research-dashboard.md Phase 2, PBI "Visual 9").
//
// Two aggregation grains:
//   - default: SUM over mlb.player_game_statcast (raw sums re-aggregated so
//     avgEv = SUM(ev_sum)/SUM(bbe), never an average of averages)
//   - hand= or abNum= present: drop to mlb.player_at_bats grain (hand via
//     mlb.players.pitch_hand, AB number via at_bat_number) and rebuild the
//     same aggregate shape from raw at-bats.
// Definitions mirror the ETL: hard-hit = EV >= 95, barrel = EV >= 95 AND
// 8 <= LA <= 32 (etl/mlb_play_by_play.py / statcastFormat.ts).

// Baserunning noise event types excluded from PA counting at the at-bat
// grain — keep in lockstep with etl/mlb_play_by_play.py NOISE_EVENTS.
const NOISE_EVENTS = [
  "caught_stealing_2b",
  "caught_stealing_3b",
  "caught_stealing_home",
  "pickoff_1b",
  "pickoff_2b",
  "pickoff_caught_stealing_2b",
  "pickoff_caught_stealing_3b",
  "pickoff_caught_stealing_home",
  "pickoff_error_1b",
  "stolen_base_2b",
  "wild_pitch",
];

export interface GridAgg {
  games: number;
  pa: number;
  ab: number;
  hits: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  xbh: number;
  totalBases: number;
  strikeouts: number;
  walks: number;
  hip: number;
  bbe: number;
  avg: number | null;
  avgEv: number | null;
  maxEv: number | null;
  avgLa: number | null;
  avgDist: number | null;
  avgXba: number | null;
  hardHitPct: number | null;
  barrelPct: number | null;
  babip: number | null;
}

export interface GridTrend {
  w10HitRate: number | null;
  w10AvgEv: number | null;
  w10HardHitPct: number | null;
  w10AvgXba: number | null;
  w30HitRate: number | null;
  w30AvgEv: number | null;
  w30HardHitPct: number | null;
  w30AvgXba: number | null;
  vsHandPa: number | null;
  vsHandHitRate: number | null;
  vsHandAvgEv: number | null;
  vsHandHardHitPct: number | null;
  vsHandAvgXba: number | null;
  vsHandBabip: number | null;
}

export interface GridBvp {
  pa: number;
  ab: number;
  hits: number;
  homeRuns: number;
  battingAvg: number | null;
  ops: number | null;
  avgEv: number | null;
  avgXba: number | null;
}

export interface GridBatter {
  playerId: number;
  playerName: string | null;
  batSide: string | null;
  position: string | null;
  battingOrder: number;
  agg: GridAgg | null;
  trend: GridTrend | null;
  bvp: GridBvp | null;
  proj: Record<string, number>;
}

export interface GridTeam {
  teamId: number;
  teamAbbr: string;
  lineupStatus: "confirmed" | "projected" | "unavailable";
  pitcherId: number | null;
  pitcherName: string | null;
  pitcherHand: string | null;
  batters: GridBatter[];
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
  // Same heuristic as the game-page lineups route: starters (hundreds
  // batting_order) over the team's last 10 games, regulars-first.
  const res = await pool
    .request()
    .input("teamId", mssql.Int, teamId)
    .input("gameDate", mssql.VarChar, gameDate).query<LineupRow>(`
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
        ROW_NUMBER() OVER (
          ORDER BY CASE WHEN appearances >= 5 THEN 0 ELSE 1 END,
                   bestOrder ASC, appearances DESC
        ) AS battingOrder
      FROM pool
      ORDER BY battingOrder
    `);
  return res.recordset;
}

function toAgg(r: any): GridAgg | null {
  if (!r || !r.pa) return null;
  const bbe: number = r.bbe ?? 0;
  const ab: number = r.ab ?? 0;
  const babipDenom =
    ab - (r.strikeouts ?? 0) - (r.homeRuns ?? 0) + (r.sacFlies ?? 0);
  const babipNumer = (r.hits ?? 0) - (r.homeRuns ?? 0);
  return {
    games: r.games ?? 0,
    pa: r.pa ?? 0,
    ab,
    hits: r.hits ?? 0,
    singles: r.singles ?? 0,
    doubles: r.doubles ?? 0,
    triples: r.triples ?? 0,
    homeRuns: r.homeRuns ?? 0,
    xbh: r.xbh ?? 0,
    totalBases: r.totalBases ?? 0,
    strikeouts: r.strikeouts ?? 0,
    walks: r.walks ?? 0,
    hip: r.hip ?? 0,
    bbe,
    avg: ab > 0 ? (r.hits ?? 0) / ab : null,
    avgEv: bbe > 0 && r.evSum != null ? r.evSum / bbe : null,
    maxEv: r.maxEv,
    avgLa: r.laCnt > 0 && r.laSum != null ? r.laSum / r.laCnt : null,
    avgDist: r.distCnt > 0 && r.distSum != null ? r.distSum / r.distCnt : null,
    // hit_probability is stored 0-100; avg_xba convention is 0-1 (ETL divides by 100)
    avgXba: r.xbaCnt > 0 && r.xbaSum != null ? r.xbaSum / r.xbaCnt / 100 : null,
    hardHitPct: bbe > 0 ? (r.hardHit ?? 0) / bbe : null,
    barrelPct: bbe > 0 ? (r.barrels ?? 0) / bbe : null,
    babip: babipDenom > 0 ? babipNumer / babipDenom : null,
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const gamePk = parseInt(sp.get("gamePk") ?? "", 10);
  if (isNaN(gamePk)) {
    return NextResponse.json({ error: "invalid gamePk" }, { status: 400 });
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

    const gameRes = await pool.request().input("gamePk", mssql.Int, gamePk)
      .query(`
        SELECT
          g.game_pk            AS gamePk,
          CONVERT(VARCHAR(10), g.game_date, 120) AS gameDate,
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

    const seasonStart = `${game.gameDate.slice(0, 4)}-01-01`;
    const winFrom = from ?? seasonStart;
    const winTo = to ?? game.gameDate;

    // Lineups: confirmed from the intraday poller, else projected nine.
    const confirmedRes = await pool.request().input("gamePk", mssql.Int, gamePk)
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

    const sides = [] as {
      teamId: number;
      teamAbbr: string;
      pitcherId: number | null;
      pitcherName: string | null;
      pitcherHand: string | null;
      oppPitcherId: number | null;
      lineupStatus: "confirmed" | "projected" | "unavailable";
      rows: LineupRow[];
    }[];
    for (const side of ["away", "home"] as const) {
      const teamId = side === "away" ? game.awayTeamId : game.homeTeamId;
      const confirmed = confirmedByTeam.get(teamId) ?? [];
      let rows = confirmed;
      let lineupStatus: "confirmed" | "projected" | "unavailable" = "confirmed";
      if (rows.length === 0) {
        rows = await fetchProjectedNine(pool, teamId, game.gameDate);
        lineupStatus = rows.length > 0 ? "projected" : "unavailable";
      }
      sides.push({
        teamId,
        teamAbbr: side === "away" ? game.awayTeamAbbr : game.homeTeamAbbr,
        pitcherId: side === "away" ? game.awayPitcherId : game.homePitcherId,
        pitcherName:
          side === "away" ? game.awayPitcherName : game.homePitcherName,
        pitcherHand:
          side === "away" ? game.awayPitcherHand : game.homePitcherHand,
        oppPitcherId: side === "away" ? game.homePitcherId : game.awayPitcherId,
        lineupStatus,
        rows,
      });
    }

    const batterIds = [
      ...new Set(sides.flatMap((s) => s.rows.map((r) => r.playerId))),
    ];
    if (batterIds.length === 0) {
      return jsonWithEtag(req, {
        gamePk,
        gameDate: game.gameDate,
        from: winFrom,
        to: winTo,
        hand,
        abNum,
        away: { ...sides[0], batters: [] },
        home: { ...sides[1], batters: [] },
      });
    }
    // Ints straight from the DB — safe to inline as an IN list.
    const idList = batterIds.join(",");

    // --- Aggregates over the date window ---
    const filtered = hand != null || abNum != null;
    let aggSql: string;
    if (!filtered) {
      aggSql = `
        SELECT
          batter_id            AS playerId,
          COUNT(*)             AS games,
          SUM(COALESCE(pa, 0))          AS pa,
          SUM(COALESCE(ab, 0))          AS ab,
          SUM(COALESCE(hits, 0))        AS hits,
          SUM(COALESCE(singles, 0))     AS singles,
          SUM(COALESCE(doubles, 0))     AS doubles,
          SUM(COALESCE(triples, 0))     AS triples,
          SUM(COALESCE(home_runs, 0))   AS homeRuns,
          SUM(COALESCE(xbh, 0))         AS xbh,
          SUM(COALESCE(total_bases, 0)) AS totalBases,
          SUM(COALESCE(strikeouts, 0))  AS strikeouts,
          SUM(COALESCE(walks, 0))       AS walks,
          SUM(COALESCE(sac_flies, 0))   AS sacFlies,
          SUM(COALESCE(hip, 0))         AS hip,
          SUM(COALESCE(bbe, 0))         AS bbe,
          SUM(ev_sum)          AS evSum,
          MAX(max_ev)          AS maxEv,
          SUM(COALESCE(la_cnt, 0))   AS laCnt,
          SUM(la_sum)          AS laSum,
          SUM(COALESCE(dist_cnt, 0)) AS distCnt,
          SUM(dist_sum)        AS distSum,
          SUM(COALESCE(xba_cnt, 0))  AS xbaCnt,
          SUM(xba_sum)         AS xbaSum,
          SUM(COALESCE(hard_hit, 0)) AS hardHit,
          SUM(COALESCE(barrels, 0))  AS barrels
        FROM mlb.player_game_statcast
        WHERE batter_id IN (${idList})
          AND game_date >= @from AND game_date <= @to
          AND game_pk <> @gamePk
        GROUP BY batter_id`;
    } else {
      // At-bat grain: rebuild the same shape from raw at-bats so the
      // hand/AB-number slicers compose with the date window.
      const noiseList = NOISE_EVENTS.map((e) => `'${e}'`).join(",");
      aggSql = `
        SELECT
          ab.batter_id AS playerId,
          COUNT(DISTINCT ab.game_pk) AS games,
          COUNT(*) AS pa,
          SUM(CASE WHEN ab.result_event_type IN (
                'walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt',
                'sac_fly_double_play','sac_bunt_double_play','catcher_interf'
              ) THEN 0 ELSE 1 END) AS ab,
          SUM(CASE WHEN ab.result_event_type IN ('single','double','triple','home_run') THEN 1 ELSE 0 END) AS hits,
          SUM(CASE WHEN ab.result_event_type = 'single' THEN 1 ELSE 0 END) AS singles,
          SUM(CASE WHEN ab.result_event_type = 'double' THEN 1 ELSE 0 END) AS doubles,
          SUM(CASE WHEN ab.result_event_type = 'triple' THEN 1 ELSE 0 END) AS triples,
          SUM(CASE WHEN ab.result_event_type = 'home_run' THEN 1 ELSE 0 END) AS homeRuns,
          SUM(CASE WHEN ab.result_event_type IN ('double','triple','home_run') THEN 1 ELSE 0 END) AS xbh,
          SUM(CASE WHEN ab.result_event_type = 'single' THEN 1
                   WHEN ab.result_event_type = 'double' THEN 2
                   WHEN ab.result_event_type = 'triple' THEN 3
                   WHEN ab.result_event_type = 'home_run' THEN 4
                   ELSE 0 END) AS totalBases,
          SUM(CASE WHEN ab.result_event_type IN ('strikeout','strikeout_double_play','strikeout_triple_play') THEN 1 ELSE 0 END) AS strikeouts,
          SUM(CASE WHEN ab.result_event_type IN ('walk','intent_walk') THEN 1 ELSE 0 END) AS walks,
          SUM(CASE WHEN ab.result_event_type IN ('sac_fly','sac_fly_double_play') THEN 1 ELSE 0 END) AS sacFlies,
          SUM(CASE WHEN ab.result_event_type NOT IN (
                'strikeout','strikeout_double_play','strikeout_triple_play',
                'walk','intent_walk','hit_by_pitch','catcher_interf'
              ) THEN 1 ELSE 0 END) AS hip,
          SUM(CASE WHEN ab.hit_launch_speed IS NOT NULL THEN 1 ELSE 0 END) AS bbe,
          SUM(CAST(ab.hit_launch_speed AS FLOAT)) AS evSum,
          MAX(ab.hit_launch_speed) AS maxEv,
          SUM(CASE WHEN ab.hit_launch_angle IS NOT NULL THEN 1 ELSE 0 END) AS laCnt,
          SUM(CAST(ab.hit_launch_angle AS FLOAT)) AS laSum,
          SUM(CASE WHEN ab.hit_total_distance IS NOT NULL THEN 1 ELSE 0 END) AS distCnt,
          SUM(CAST(ab.hit_total_distance AS FLOAT)) AS distSum,
          SUM(CASE WHEN ab.hit_probability IS NOT NULL THEN 1 ELSE 0 END) AS xbaCnt,
          SUM(CAST(ab.hit_probability AS FLOAT)) AS xbaSum,
          SUM(CASE WHEN ab.hit_launch_speed >= 95 THEN 1 ELSE 0 END) AS hardHit,
          SUM(CASE WHEN ab.hit_launch_speed >= 95 AND ab.hit_launch_angle BETWEEN 8 AND 32 THEN 1 ELSE 0 END) AS barrels
        FROM mlb.player_at_bats ab
        ${hand ? "JOIN mlb.players pp ON pp.player_id = ab.pitcher_id" : ""}
        WHERE ab.batter_id IN (${idList})
          AND ab.game_date >= @from AND ab.game_date <= @to
          AND ab.game_pk <> @gamePk
          AND ab.result_event_type NOT IN (${noiseList})
          ${hand ? "AND pp.pitch_hand = @hand" : ""}
          ${abNum != null ? "AND ab.at_bat_number = @abNum" : ""}
        GROUP BY ab.batter_id`;
    }
    const aggReq = pool
      .request()
      .input("from", mssql.VarChar, winFrom)
      .input("to", mssql.VarChar, winTo)
      .input("gamePk", mssql.Int, gamePk);
    if (hand) aggReq.input("hand", mssql.VarChar, hand);
    if (abNum != null) aggReq.input("abNum", mssql.Int, abNum);
    const aggRes = await aggReq.query(aggSql);
    const aggByPlayer = new Map<number, GridAgg | null>();
    for (const r of aggRes.recordset) {
      aggByPlayer.set(r.playerId, toAgg(r));
    }

    // --- Batter meta ---
    const metaRes = await pool.request().query(`
      SELECT player_id AS playerId, player_name AS playerName,
             bat_side AS batSide
      FROM mlb.players
      WHERE player_id IN (${idList})
    `);
    const metaByPlayer = new Map<
      number,
      { playerName: string | null; batSide: string | null }
    >();
    for (const m of metaRes.recordset) {
      metaByPlayer.set(m.playerId, {
        playerName: m.playerName,
        batSide: m.batSide,
      });
    }

    // --- Latest trend row per batter (profile entering the most recent game) ---
    const trendRes = await pool.request().query(`
      SELECT playerId,
             w10_hit_rate AS w10HitRate, w10_avg_ev AS w10AvgEv,
             w10_hard_hit_pct AS w10HardHitPct, w10_avg_xba AS w10AvgXba,
             w30_hit_rate AS w30HitRate, w30_avg_ev AS w30AvgEv,
             w30_hard_hit_pct AS w30HardHitPct, w30_avg_xba AS w30AvgXba,
             vs_lhp_pa, vs_lhp_hit_rate, vs_lhp_avg_ev, vs_lhp_hard_hit_pct,
             vs_lhp_avg_xba, vs_lhp_babip,
             vs_rhp_pa, vs_rhp_hit_rate, vs_rhp_avg_ev, vs_rhp_hard_hit_pct,
             vs_rhp_avg_xba, vs_rhp_babip
      FROM (
        SELECT batter_id AS playerId, ts.*,
               ROW_NUMBER() OVER (
                 PARTITION BY batter_id ORDER BY game_date DESC
               ) AS rn
        FROM mlb.player_trend_stats ts
        WHERE batter_id IN (${idList})
      ) x
      WHERE rn = 1
    `);
    const trendByPlayer = new Map<number, any>();
    for (const t of trendRes.recordset) trendByPlayer.set(t.playerId, t);

    // --- BvP vs each side's opposing probable ---
    const oppPitcherIds = sides
      .map((s) => s.oppPitcherId)
      .filter((id): id is number => id != null);
    const bvpByKey = new Map<string, GridBvp>();
    if (oppPitcherIds.length > 0) {
      const bvpRes = await pool.request().query(`
        SELECT batter_id AS batterId, pitcher_id AS pitcherId,
               plate_appearances AS pa, at_bats AS ab, hits,
               home_runs AS homeRuns, batting_avg AS battingAvg, ops,
               avg_ev AS avgEv, avg_xba AS avgXba
        FROM mlb.career_batter_vs_pitcher
        WHERE batter_id IN (${idList})
          AND pitcher_id IN (${oppPitcherIds.join(",")})
      `);
      for (const b of bvpRes.recordset) {
        bvpByKey.set(`${b.batterId}-${b.pitcherId}`, {
          pa: b.pa,
          ab: b.ab,
          hits: b.hits,
          homeRuns: b.homeRuns,
          battingAvg: b.battingAvg,
          ops: b.ops,
          avgEv: b.avgEv,
          avgXba: b.avgXba,
        });
      }
    }

    // --- Projections pivoted long -> map per batter ---
    const projRes = await pool.request().input("gamePk", mssql.Int, gamePk)
      .query(`
        SELECT batter_id AS playerId, market_key AS marketKey,
               projected_value AS projectedValue
        FROM mlb.batter_projections
        WHERE game_pk = @gamePk AND projected_value IS NOT NULL
      `);
    const projByPlayer = new Map<number, Record<string, number>>();
    for (const p of projRes.recordset) {
      const m = projByPlayer.get(p.playerId) ?? {};
      m[p.marketKey] = p.projectedValue;
      projByPlayer.set(p.playerId, m);
    }

    const toTrend = (
      playerId: number,
      oppHand: string | null,
    ): GridTrend | null => {
      const t = trendByPlayer.get(playerId);
      if (!t) return null;
      const side = oppHand === "L" ? "lhp" : oppHand === "R" ? "rhp" : null;
      return {
        w10HitRate: t.w10HitRate,
        w10AvgEv: t.w10AvgEv,
        w10HardHitPct: t.w10HardHitPct,
        w10AvgXba: t.w10AvgXba,
        w30HitRate: t.w30HitRate,
        w30AvgEv: t.w30AvgEv,
        w30HardHitPct: t.w30HardHitPct,
        w30AvgXba: t.w30AvgXba,
        vsHandPa: side ? t[`vs_${side}_pa`] : null,
        vsHandHitRate: side ? t[`vs_${side}_hit_rate`] : null,
        vsHandAvgEv: side ? t[`vs_${side}_avg_ev`] : null,
        vsHandHardHitPct: side ? t[`vs_${side}_hard_hit_pct`] : null,
        vsHandAvgXba: side ? t[`vs_${side}_avg_xba`] : null,
        vsHandBabip: side ? t[`vs_${side}_babip`] : null,
      };
    };

    const toTeam = (s: (typeof sides)[number]): GridTeam => {
      // The opposing probable's hand drives the vs-hand trend columns.
      const opp = sides.find((o) => o.teamId !== s.teamId)!;
      return {
        teamId: s.teamId,
        teamAbbr: s.teamAbbr,
        lineupStatus: s.lineupStatus,
        pitcherId: s.pitcherId,
        pitcherName: s.pitcherName,
        pitcherHand: s.pitcherHand,
        batters: s.rows.map((r) => ({
          playerId: r.playerId,
          playerName: metaByPlayer.get(r.playerId)?.playerName ?? null,
          batSide: metaByPlayer.get(r.playerId)?.batSide ?? null,
          position: r.position,
          battingOrder: r.battingOrder,
          agg: aggByPlayer.get(r.playerId) ?? null,
          trend: toTrend(r.playerId, opp.pitcherHand),
          bvp:
            s.oppPitcherId != null
              ? (bvpByKey.get(`${r.playerId}-${s.oppPitcherId}`) ?? null)
              : null,
          proj: projByPlayer.get(r.playerId) ?? {},
        })),
      };
    };

    return jsonWithEtag(req, {
      gamePk,
      gameDate: game.gameDate,
      from: winFrom,
      to: winTo,
      hand,
      abNum,
      away: toTeam(sides[0]),
      home: toTeam(sides[1]),
    });
  } catch (err) {
    return apiError(err, "api/mlb/research/grid");
  }
}
