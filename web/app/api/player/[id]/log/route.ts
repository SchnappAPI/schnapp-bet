import { NextRequest, NextResponse } from "next/server";
import { apiError } from '@/lib/apiError';
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { jsonWithEtag } from "@/lib/etag";

interface DbRow {
  gameId: string;
  gameDate: string;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3m: number | null;
  fg3a: number | null;
  fgm: number | null;
  fga: number | null;
  ftm: number | null;
  fta: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
  min: number | null;
  isHome: number;
  oppTeamId: number | null;
  oppAbbr: string | null;
  started: number | null;
  daysSincePrev: number | null;
  recencyRank: number;
  win: number | null;
  upcomingOppTeamId: number | null;
}

interface LogRow {
  gameId: string;
  gameDate: string;
  oppAbbr: string | null;
  oppTeamId: number | null;
  isHome: boolean;
  started: boolean | null;
  win: boolean | null;
  restDays: number | null;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
  fg3a: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  stl: number;
  blk: number;
  tov: number;
}

interface Averages {
  gp: number;
  min: number;
  pts: number;
  fg3m: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pra: number;
  pr: number;
  pa: number;
  ra: number;
  fgPct: number | null;
  fg3Pct: number | null;
  ftPct: number | null;
}

function parseIntList(s: string | null): number[] {
  if (!s) return [];
  return s
    .split(",")
    .map((p) => parseInt(p.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

function aggregate(rows: LogRow[]): Averages {
  const gp = rows.length;
  const empty: Averages = {
    gp: 0,
    min: 0,
    pts: 0,
    fg3m: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pra: 0,
    pr: 0,
    pa: 0,
    ra: 0,
    fgPct: null,
    fg3Pct: null,
    ftPct: null,
  };
  if (gp === 0) return empty;
  let sumMin = 0,
    sumPts = 0,
    sumReb = 0,
    sumAst = 0,
    sum3m = 0;
  let sumStl = 0,
    sumBlk = 0,
    sumTov = 0;
  let sumFgm = 0,
    sumFga = 0,
    sumFg3a = 0,
    sumFtm = 0,
    sumFta = 0;
  for (const r of rows) {
    sumMin += r.min;
    sumPts += r.pts;
    sumReb += r.reb;
    sumAst += r.ast;
    sum3m += r.fg3m;
    sumStl += r.stl;
    sumBlk += r.blk;
    sumTov += r.tov;
    sumFgm += r.fgm;
    sumFga += r.fga;
    sumFg3a += r.fg3a;
    sumFtm += r.ftm;
    sumFta += r.fta;
  }
  return {
    gp,
    min: sumMin / gp,
    pts: sumPts / gp,
    fg3m: sum3m / gp,
    reb: sumReb / gp,
    ast: sumAst / gp,
    stl: sumStl / gp,
    blk: sumBlk / gp,
    tov: sumTov / gp,
    pra: (sumPts + sumReb + sumAst) / gp,
    pr: (sumPts + sumReb) / gp,
    pa: (sumPts + sumAst) / gp,
    ra: (sumReb + sumAst) / gp,
    fgPct: sumFga > 0 ? sumFgm / sumFga : null,
    fg3Pct: sumFg3a > 0 ? sum3m / sumFg3a : null,
    ftPct: sumFta > 0 ? sumFtm / sumFta : null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const playerId = parseInt(id, 10);
  if (isNaN(playerId)) {
    return NextResponse.json({ error: "invalid player id" }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;
  const range = (sp.get("range") ?? "season").toLowerCase();
  const vs = sp.get("vs")?.toUpperCase() ?? null;
  const vsUpcoming = sp.get("vsUpcoming") === "1";
  const ha = sp.get("ha")?.toLowerCase() ?? null;
  const starterParam = sp.get("starter");
  const minGtParam = sp.get("minGt");
  const wlParam = sp.get("wl")?.toLowerCase() ?? null;
  const restCsv = sp.get("rest");
  const b2bOnly = sp.get("b2b") === "1";
  const since = sp.get("since");
  const until = sp.get("until");

  const minGt = minGtParam == null ? null : parseFloat(minGtParam);
  const restBuckets = new Set(parseIntList(restCsv));

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("playerId", mssql.Int, playerId)
      .query<DbRow>(
        `WITH player_team AS (
           SELECT p.player_id,
                  p.player_name,
                  p.team_id
           FROM nba.players p
           WHERE p.player_id = @playerId
         ),
         upcoming AS (
           SELECT TOP 1
             CASE WHEN s.home_team_id = (SELECT team_id FROM player_team)
                  THEN s.away_team_id ELSE s.home_team_id END AS opp_team_id
           FROM nba.schedule s
           WHERE (s.home_team_id = (SELECT team_id FROM player_team)
               OR s.away_team_id = (SELECT team_id FROM player_team))
             AND s.game_date >= CAST(GETUTCDATE() AS DATE)
           ORDER BY s.game_date ASC, s.game_id ASC
         ),
         game_totals AS (
           SELECT
             pbs.game_id,
             pbs.game_date,
             SUM(CAST(pbs.pts  AS INT))   AS pts,
             SUM(CAST(pbs.reb  AS INT))   AS reb,
             SUM(CAST(pbs.ast  AS INT))   AS ast,
             SUM(CAST(pbs.fg3m AS INT))   AS fg3m,
             SUM(CAST(pbs.fg3a AS INT))   AS fg3a,
             SUM(CAST(pbs.fgm  AS INT))   AS fgm,
             SUM(CAST(pbs.fga  AS INT))   AS fga,
             SUM(CAST(pbs.ftm  AS INT))   AS ftm,
             SUM(CAST(pbs.fta  AS INT))   AS fta,
             SUM(CAST(pbs.stl  AS INT))   AS stl,
             SUM(CAST(pbs.blk  AS INT))   AS blk,
             SUM(CAST(pbs.tov  AS INT))   AS tov,
             SUM(pbs.minutes)             AS min,
             MAX(CASE WHEN pbs.matchup LIKE '% vs. %' THEN 1 ELSE 0 END) AS isHome,
             MAX(CASE WHEN pbs.matchup LIKE '% vs. %'
                      THEN LTRIM(RTRIM(SUBSTRING(pbs.matchup, CHARINDEX(' vs. ', pbs.matchup) + 5, 10)))
                      ELSE LTRIM(RTRIM(SUBSTRING(pbs.matchup, CHARINDEX(' @ ',  pbs.matchup) + 3, 10)))
                 END) AS opp_abbr
           FROM nba.player_box_score_stats pbs
           WHERE pbs.player_id = @playerId
           GROUP BY pbs.game_id, pbs.game_date
         ),
         lineup_status AS (
           SELECT
             dl.game_id,
             CASE WHEN MAX(CASE WHEN dl.starter_status = 'Starter' THEN 1 ELSE 0 END) = 1
                  THEN 1 ELSE 0 END AS started
           FROM nba.daily_lineups dl
           WHERE dl.player_name = (SELECT player_name FROM player_team)
           GROUP BY dl.game_id
         ),
         with_meta AS (
           SELECT
             gt.game_id,
             gt.game_date,
             gt.pts, gt.reb, gt.ast, gt.fg3m, gt.fg3a,
             gt.fgm, gt.fga, gt.ftm, gt.fta,
             gt.stl, gt.blk, gt.tov,
             gt.min,
             gt.isHome,
             ot.team_id AS opp_team_id,
             gt.opp_abbr,
             ls.started,
             DATEDIFF(DAY, LAG(gt.game_date) OVER (ORDER BY gt.game_date), gt.game_date) AS days_since_prev,
             ROW_NUMBER() OVER (ORDER BY gt.game_date DESC, gt.game_id DESC) AS recency_rank,
             CASE
               WHEN g.home_score IS NULL OR g.away_score IS NULL THEN NULL
               WHEN gt.isHome = 1 AND g.home_score > g.away_score THEN 1
               WHEN gt.isHome = 0 AND g.away_score > g.home_score THEN 1
               WHEN g.home_score = g.away_score THEN NULL
               ELSE 0
             END AS win
           FROM game_totals gt
           LEFT JOIN nba.teams ot ON ot.team_tricode = gt.opp_abbr
           LEFT JOIN lineup_status ls ON ls.game_id = gt.game_id
           LEFT JOIN nba.games g ON g.game_id = gt.game_id
         )
         SELECT
           wm.game_id                              AS gameId,
           CONVERT(VARCHAR(10), wm.game_date, 120) AS gameDate,
           wm.pts, wm.reb, wm.ast, wm.fg3m, wm.fg3a,
           wm.fgm, wm.fga, wm.ftm, wm.fta,
           wm.stl, wm.blk, wm.tov,
           CAST(wm.min AS FLOAT)                   AS min,
           wm.isHome,
           wm.opp_team_id                          AS oppTeamId,
           wm.opp_abbr                             AS oppAbbr,
           wm.started,
           wm.days_since_prev                      AS daysSincePrev,
           wm.recency_rank                         AS recencyRank,
           wm.win,
           (SELECT opp_team_id FROM upcoming)      AS upcomingOppTeamId
         FROM with_meta wm
         WHERE wm.min IS NOT NULL AND wm.min > 0
         ORDER BY wm.game_date DESC`,
      );

    const upcomingOppTeamId = result.recordset[0]?.upcomingOppTeamId ?? null;

    let rows: LogRow[] = result.recordset.map((r) => ({
      gameId: r.gameId,
      gameDate: r.gameDate,
      oppAbbr: r.oppAbbr,
      oppTeamId: r.oppTeamId,
      isHome: r.isHome === 1,
      started: r.started == null ? null : r.started === 1,
      win: r.win == null ? null : r.win === 1,
      restDays: r.daysSincePrev == null ? null : r.daysSincePrev - 1,
      min: r.min ?? 0,
      pts: r.pts ?? 0,
      reb: r.reb ?? 0,
      ast: r.ast ?? 0,
      fg3m: r.fg3m ?? 0,
      fg3a: r.fg3a ?? 0,
      fgm: r.fgm ?? 0,
      fga: r.fga ?? 0,
      ftm: r.ftm ?? 0,
      fta: r.fta ?? 0,
      stl: r.stl ?? 0,
      blk: r.blk ?? 0,
      tov: r.tov ?? 0,
    }));

    const recencyRanks = new Map<string, number>();
    result.recordset.forEach((r) => recencyRanks.set(r.gameId, r.recencyRank));

    if (range === "l5") {
      rows = rows.filter((r) => (recencyRanks.get(r.gameId) ?? 999) <= 5);
    } else if (range === "l10") {
      rows = rows.filter((r) => (recencyRanks.get(r.gameId) ?? 999) <= 10);
    } else if (range === "l20") {
      rows = rows.filter((r) => (recencyRanks.get(r.gameId) ?? 999) <= 20);
    }
    if (since) rows = rows.filter((r) => r.gameDate >= since);
    if (until) rows = rows.filter((r) => r.gameDate <= until);

    if (vsUpcoming && upcomingOppTeamId != null) {
      rows = rows.filter((r) => r.oppTeamId === upcomingOppTeamId);
    } else if (vs) {
      rows = rows.filter((r) => r.oppAbbr === vs);
    }

    if (ha === "home") rows = rows.filter((r) => r.isHome);
    else if (ha === "away" || ha === "road")
      rows = rows.filter((r) => !r.isHome);

    if (starterParam === "1" || starterParam === "started") {
      rows = rows.filter((r) => r.started === true);
    } else if (starterParam === "0" || starterParam === "bench") {
      rows = rows.filter((r) => r.started === false);
    }

    if (minGt != null && !Number.isNaN(minGt)) {
      rows = rows.filter((r) => r.min > minGt);
    }

    if (wlParam === "w" || wlParam === "win") {
      rows = rows.filter((r) => r.win === true);
    } else if (wlParam === "l" || wlParam === "loss") {
      rows = rows.filter((r) => r.win === false);
    }

    if (b2bOnly) {
      rows = rows.filter((r) => r.restDays === 0);
    } else if (restBuckets.size > 0) {
      rows = rows.filter((r) => {
        if (r.restDays == null) return false;
        if (r.restDays >= 3) return restBuckets.has(3);
        return restBuckets.has(r.restDays);
      });
    }

    return jsonWithEtag(req, {
      player_id: playerId,
      upcoming_opp_team_id: upcomingOppTeamId,
      averages: aggregate(rows),
      rows,
      total: rows.length,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return apiError(err, 'api/player/[id]/log');
  }
}
