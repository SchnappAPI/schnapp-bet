import { NextRequest, NextResponse } from "next/server";
import mssql from "mssql";
import { getPool } from "@/lib/db";
import { jsonWithEtag } from "@/lib/etag";

interface GameRow {
  gameId: string;
  gameDate: string;
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
  fgm: number;
  fga: number;
  fg3a: number;
  ftm: number;
  fta: number;
  min: number;
  isHome: boolean;
  oppTeamId: number | null;
  oppAbbr: string | null;
  oppDivision: string | null;
  oppConference: string | null;
  started: boolean | null;
  daysSincePrev: number | null;
  recencyRank: number;
  win: boolean | null;
  upcomingOppTeamId: number | null;
  playerDivision: string | null;
  playerConference: string | null;
}

interface DbRow {
  gameId: string;
  gameDate: string;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3m: number | null;
  fgm: number | null;
  fga: number | null;
  fg3a: number | null;
  ftm: number | null;
  fta: number | null;
  min: number | null;
  isHome: number;
  oppTeamId: number | null;
  oppAbbr: string | null;
  oppDivision: string | null;
  oppConference: string | null;
  started: number | null;
  daysSincePrev: number | null;
  recencyRank: number;
  win: number | null;
  upcomingOppTeamId: number | null;
  upcomingOppAbbr: string | null;
  playerDivision: string | null;
  playerConference: string | null;
}

interface SplitRow {
  splitKey: string;
  label: string;
  gp: number;
  min: number;
  pts: number;
  fg3m: number;
  reb: number;
  ast: number;
  pra: number;
  pr: number;
  pa: number;
  ra: number;
  fgPct: number | null;
  fg3Pct: number | null;
  ftPct: number | null;
  gameIds: string[];
}

interface SplitGroup {
  groupKey: string;
  label: string;
  rows: SplitRow[];
}

function aggregate(rows: GameRow[], key: string, label: string): SplitRow {
  const gp = rows.length;
  if (gp === 0) {
    return {
      splitKey: key,
      label,
      gp: 0,
      min: 0,
      pts: 0,
      fg3m: 0,
      reb: 0,
      ast: 0,
      pra: 0,
      pr: 0,
      pa: 0,
      ra: 0,
      fgPct: null,
      fg3Pct: null,
      ftPct: null,
      gameIds: [],
    };
  }
  let sumMin = 0,
    sumPts = 0,
    sumReb = 0,
    sumAst = 0,
    sum3m = 0;
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
    sumFgm += r.fgm;
    sumFga += r.fga;
    sumFg3a += r.fg3a;
    sumFtm += r.ftm;
    sumFta += r.fta;
  }
  return {
    splitKey: key,
    label,
    gp,
    min: sumMin / gp,
    pts: sumPts / gp,
    fg3m: sum3m / gp,
    reb: sumReb / gp,
    ast: sumAst / gp,
    pra: (sumPts + sumReb + sumAst) / gp,
    pr: (sumPts + sumReb) / gp,
    pa: (sumPts + sumAst) / gp,
    ra: (sumReb + sumAst) / gp,
    fgPct: sumFga > 0 ? sumFgm / sumFga : null,
    fg3Pct: sumFg3a > 0 ? sum3m / sumFg3a : null,
    ftPct: sumFta > 0 ? sumFtm / sumFta : null,
    gameIds: rows.map((r) => r.gameId),
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

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("playerId", mssql.Int, playerId)
      .query<DbRow>(
        `WITH player_team AS (
           SELECT p.player_id,
                  p.player_name,
                  p.team_id,
                  t.division   AS division,
                  t.conference AS conference
           FROM nba.players p
           LEFT JOIN nba.teams t ON t.team_id = p.team_id
           WHERE p.player_id = @playerId
         ),
         upcoming AS (
           SELECT TOP 1
             CASE WHEN s.home_team_id = (SELECT team_id FROM player_team)
                  THEN s.away_team_id ELSE s.home_team_id END AS opp_team_id,
             CASE WHEN s.home_team_id = (SELECT team_id FROM player_team)
                  THEN s.away_team_tricode ELSE s.home_team_tricode END AS opp_abbr
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
             SUM(CAST(pbs.pts  AS INT))     AS pts,
             SUM(CAST(pbs.reb  AS INT))     AS reb,
             SUM(CAST(pbs.ast  AS INT))     AS ast,
             SUM(CAST(pbs.fg3m AS INT))     AS fg3m,
             SUM(CAST(pbs.fgm  AS INT))     AS fgm,
             SUM(CAST(pbs.fga  AS INT))     AS fga,
             SUM(CAST(pbs.fg3a AS INT))     AS fg3a,
             SUM(CAST(pbs.ftm  AS INT))     AS ftm,
             SUM(CAST(pbs.fta  AS INT))     AS fta,
             SUM(pbs.minutes)               AS min,
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
             gt.pts, gt.reb, gt.ast, gt.fg3m,
             gt.fgm, gt.fga, gt.fg3a, gt.ftm, gt.fta,
             gt.min,
             gt.isHome,
             ot.team_id    AS opp_team_id,
             gt.opp_abbr,
             ot.division   AS opp_division,
             ot.conference AS opp_conference,
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
           wm.pts, wm.reb, wm.ast, wm.fg3m,
           wm.fgm, wm.fga, wm.fg3a, wm.ftm, wm.fta,
           CAST(wm.min AS FLOAT)                   AS min,
           wm.isHome,
           wm.opp_team_id                          AS oppTeamId,
           wm.opp_abbr                             AS oppAbbr,
           wm.opp_division                         AS oppDivision,
           wm.opp_conference                       AS oppConference,
           wm.started,
           wm.days_since_prev                      AS daysSincePrev,
           wm.recency_rank                         AS recencyRank,
           wm.win                                  AS win,
           (SELECT opp_team_id FROM upcoming)      AS upcomingOppTeamId,
           (SELECT opp_abbr    FROM upcoming)      AS upcomingOppAbbr,
           (SELECT division    FROM player_team)   AS playerDivision,
           (SELECT conference  FROM player_team)   AS playerConference
         FROM with_meta wm
         WHERE wm.min IS NOT NULL AND wm.min > 0
         ORDER BY wm.game_date DESC`,
      );

    const allRows: GameRow[] = result.recordset.map((r) => ({
      gameId: r.gameId,
      gameDate: r.gameDate,
      pts: r.pts ?? 0,
      reb: r.reb ?? 0,
      ast: r.ast ?? 0,
      fg3m: r.fg3m ?? 0,
      fgm: r.fgm ?? 0,
      fga: r.fga ?? 0,
      fg3a: r.fg3a ?? 0,
      ftm: r.ftm ?? 0,
      fta: r.fta ?? 0,
      min: r.min ?? 0,
      isHome: r.isHome === 1,
      oppTeamId: r.oppTeamId,
      oppAbbr: r.oppAbbr,
      oppDivision: r.oppDivision,
      oppConference: r.oppConference,
      started: r.started == null ? null : r.started === 1,
      daysSincePrev: r.daysSincePrev,
      recencyRank: r.recencyRank,
      win: r.win == null ? null : r.win === 1,
      upcomingOppTeamId: r.upcomingOppTeamId,
      playerDivision: r.playerDivision,
      playerConference: r.playerConference,
    }));

    // Active-filter params mirror PlayerLogFilters URL state. Apply before
    // grouping so every split row reflects the filtered universe.
    const sp = req.nextUrl.searchParams;
    const fRange = (sp.get("range") ?? "season").toLowerCase();
    const fVs = sp.get("vs")?.toUpperCase() ?? null;
    const fVsUpcoming = sp.get("vsUpcoming") === "1";
    const fHa = sp.get("ha")?.toLowerCase() ?? null;
    const fStarter = sp.get("starter");
    const fMinGt = sp.get("minGt");
    const fWl = sp.get("wl")?.toLowerCase() ?? null;
    const fRestCsv = sp.get("rest");
    const fB2b = sp.get("b2b") === "1";
    const fSince = sp.get("since");
    const fUntil = sp.get("until");

    const first = result.recordset[0];
    const upcomingOppTeamId = first?.upcomingOppTeamId ?? null;
    const upcomingOppAbbr = first?.upcomingOppAbbr ?? null;
    const playerDivision = first?.playerDivision ?? null;
    const playerConference = first?.playerConference ?? null;

    let rows = allRows;
    if (fSince) rows = rows.filter((r) => r.gameDate >= fSince);
    if (fUntil) rows = rows.filter((r) => r.gameDate <= fUntil);
    if (fVsUpcoming && upcomingOppTeamId != null) {
      rows = rows.filter((r) => r.oppTeamId === upcomingOppTeamId);
    } else if (fVs) {
      rows = rows.filter((r) => r.oppAbbr === fVs);
    }
    if (fHa === "home") rows = rows.filter((r) => r.isHome);
    else if (fHa === "away" || fHa === "road")
      rows = rows.filter((r) => !r.isHome);
    if (fStarter === "1") rows = rows.filter((r) => r.started === true);
    else if (fStarter === "0") rows = rows.filter((r) => r.started === false);
    if (fMinGt != null && fMinGt !== "") {
      const n = parseFloat(fMinGt);
      if (!Number.isNaN(n)) rows = rows.filter((r) => r.min > n);
    }
    if (fWl === "w" || fWl === "win") rows = rows.filter((r) => r.win === true);
    else if (fWl === "l" || fWl === "loss")
      rows = rows.filter((r) => r.win === false);
    if (fB2b) {
      rows = rows.filter((r) => r.daysSincePrev === 1);
    } else if (fRestCsv) {
      const buckets = new Set(
        fRestCsv
          .split(",")
          .map((s) => parseInt(s, 10))
          .filter((n) => !Number.isNaN(n)),
      );
      if (buckets.size > 0) {
        rows = rows.filter((r) => {
          if (r.daysSincePrev == null) return false;
          const rd = r.daysSincePrev - 1;
          if (rd >= 3) return buckets.has(3);
          return buckets.has(rd);
        });
      }
    }
    if (fRange === "l5") rows = rows.filter((r) => r.recencyRank <= 5);
    else if (fRange === "l10") rows = rows.filter((r) => r.recencyRank <= 10);
    else if (fRange === "l20") rows = rows.filter((r) => r.recencyRank <= 20);

    const groups: SplitGroup[] = [];

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
          rows.filter((r) => r.isHome),
          "home",
          "Home",
        ),
        aggregate(
          rows.filter((r) => !r.isHome),
          "road",
          "Road",
        ),
      ],
    });

    const oppRows: SplitRow[] = [];
    if (upcomingOppTeamId != null) {
      oppRows.push(
        aggregate(
          rows.filter((r) => r.oppTeamId === upcomingOppTeamId),
          "vs_upcoming",
          `vs Upcoming${upcomingOppAbbr ? ` (${upcomingOppAbbr})` : ""}`,
        ),
      );
    }
    if (playerDivision) {
      oppRows.push(
        aggregate(
          rows.filter((r) => r.oppDivision === playerDivision),
          "vs_division",
          "vs Division",
        ),
      );
    }
    if (playerConference) {
      oppRows.push(
        aggregate(
          rows.filter((r) => r.oppConference === playerConference),
          "vs_conference",
          "vs Conference",
        ),
      );
    }
    if (oppRows.length > 0) {
      groups.push({ groupKey: "opponent", label: "Opponent", rows: oppRows });
    }

    const hasRole = rows.some((r) => r.started != null);
    if (hasRole) {
      groups.push({
        groupKey: "role",
        label: "Role",
        rows: [
          aggregate(
            rows.filter((r) => r.started === true),
            "started",
            "Started",
          ),
          aggregate(
            rows.filter((r) => r.started === false),
            "bench",
            "Bench",
          ),
        ],
      });
    }

    const restRows = [
      aggregate(
        rows.filter((r) => r.daysSincePrev === 1),
        "rest_b2b",
        "0 days (B2B)",
      ),
      aggregate(
        rows.filter((r) => r.daysSincePrev === 2),
        "rest_1",
        "1 day",
      ),
      aggregate(
        rows.filter((r) => r.daysSincePrev === 3),
        "rest_2",
        "2 days",
      ),
      aggregate(
        rows.filter((r) => r.daysSincePrev != null && r.daysSincePrev >= 4),
        "rest_3plus",
        "3+ days",
      ),
    ];
    groups.push({ groupKey: "rest", label: "Rest", rows: restRows });

    groups.push({
      groupKey: "recent",
      label: "Recent form",
      rows: [
        aggregate(
          rows.filter((r) => r.recencyRank <= 5),
          "l5",
          "Last 5",
        ),
        aggregate(
          rows.filter((r) => r.recencyRank <= 10),
          "l10",
          "Last 10",
        ),
        aggregate(
          rows.filter((r) => r.recencyRank <= 20),
          "l20",
          "Last 20",
        ),
      ],
    });

    return jsonWithEtag(req, {
      player_id: playerId,
      upcoming_opp_team_id: upcomingOppTeamId,
      upcoming_opp_abbr: upcomingOppAbbr,
      total_games: rows.length,
      groups,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
