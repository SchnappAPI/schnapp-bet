import { NextRequest, NextResponse } from 'next/server';
import mssql from 'mssql';
import { getPool } from '@/lib/db';
import { apiError } from '@/lib/apiError';

// MLB At-a-Glance: every FanDuel Over prop graded by the MLB model for a
// slate date, with matchup context from mlb.games/mlb.teams and the KDE tier
// ladder from common.player_tier_lines when one was computed.
//
// daily_grades.game_id for MLB rows is game_pk stored as a string, so the
// games join goes through TRY_CAST; the tier-lines join stays on the string
// key both tables share.

function todayCT(): string {
  const now = new Date();
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return `${ct.getFullYear()}-${String(ct.getMonth() + 1).padStart(2, '0')}-${String(ct.getDate()).padStart(2, '0')}`;
}

interface DbRow {
  playerId: number;
  playerName: string;
  marketKey: string;
  lineValue: number;
  overPrice: number | null;
  compositeGrade: number | null;
  gamePk: number | null;
  awayAbbr: string | null;
  homeAbbr: string | null;
  safeLine: number | null;
  safeProb: number | null;
  safePrice: number | null;
  valueLine: number | null;
  valueProb: number | null;
  valuePrice: number | null;
  highriskLine: number | null;
  highriskProb: number | null;
  highriskPrice: number | null;
  lottoLine: number | null;
  lottoProb: number | null;
  lottoPrice: number | null;
}

export interface MlbGradeTier {
  line: number | null;
  prob: number | null;
  price: number | null;
}

export interface MlbGradeRow {
  playerId: number;
  playerName: string;
  marketKey: string;
  lineValue: number;
  overPrice: number | null;
  compositeGrade: number | null;
  gamePk: number | null;
  matchup: string | null;
  tiers: {
    safe: MlbGradeTier;
    value: MlbGradeTier;
    highrisk: MlbGradeTier;
    lotto: MlbGradeTier;
  } | null;
}

function tier(line: number | null, prob: number | null, price: number | null): MlbGradeTier {
  return { line, prob, price };
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? todayCT();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('date', mssql.VarChar, date)
      .query<DbRow>(`
        SELECT
          dg.player_id        AS playerId,
          dg.player_name      AS playerName,
          dg.market_key       AS marketKey,
          dg.line_value       AS lineValue,
          dg.over_price       AS overPrice,
          dg.composite_grade  AS compositeGrade,
          g.game_pk           AS gamePk,
          at.team_abbreviation AS awayAbbr,
          ht.team_abbreviation AS homeAbbr,
          tl.safe_line        AS safeLine,
          tl.safe_prob        AS safeProb,
          tl.safe_price       AS safePrice,
          tl.value_line       AS valueLine,
          tl.value_prob       AS valueProb,
          tl.value_price      AS valuePrice,
          tl.highrisk_line    AS highriskLine,
          tl.highrisk_prob    AS highriskProb,
          tl.highrisk_price   AS highriskPrice,
          tl.lotto_line       AS lottoLine,
          tl.lotto_prob       AS lottoProb,
          tl.lotto_price      AS lottoPrice
        FROM common.daily_grades dg
        LEFT JOIN mlb.games g  ON g.game_pk  = TRY_CAST(dg.game_id AS INT)
        LEFT JOIN mlb.teams at ON at.team_id = g.away_team_id
        LEFT JOIN mlb.teams ht ON ht.team_id = g.home_team_id
        LEFT JOIN common.player_tier_lines tl
          ON  tl.grade_date = dg.grade_date
          AND tl.game_id    = dg.game_id
          AND tl.player_id  = dg.player_id
          AND tl.market_key = dg.market_key
        WHERE dg.grade_date = @date
          AND dg.model_version LIKE 'mlb%'
          AND dg.outcome_name  = 'Over'
          AND dg.bookmaker_key = 'fanduel'
        ORDER BY dg.composite_grade DESC, dg.player_name, dg.market_key
      `);

    const gamesMap = new Map<number, { gamePk: number; matchup: string }>();
    const rows: MlbGradeRow[] = result.recordset.map((r) => {
      const matchup = r.awayAbbr && r.homeAbbr ? `${r.awayAbbr} @ ${r.homeAbbr}` : null;
      if (r.gamePk != null && matchup && !gamesMap.has(r.gamePk)) {
        gamesMap.set(r.gamePk, { gamePk: r.gamePk, matchup });
      }
      const hasTiers =
        r.safeLine != null || r.valueLine != null || r.highriskLine != null || r.lottoLine != null;
      return {
        playerId: r.playerId,
        playerName: r.playerName,
        marketKey: r.marketKey,
        lineValue: r.lineValue,
        overPrice: r.overPrice,
        compositeGrade: r.compositeGrade,
        gamePk: r.gamePk,
        matchup,
        tiers: hasTiers
          ? {
              safe: tier(r.safeLine, r.safeProb, r.safePrice),
              value: tier(r.valueLine, r.valueProb, r.valuePrice),
              highrisk: tier(r.highriskLine, r.highriskProb, r.highriskPrice),
              lotto: tier(r.lottoLine, r.lottoProb, r.lottoPrice),
            }
          : null,
      };
    });

    return NextResponse.json({
      date,
      games: Array.from(gamesMap.values()).sort((a, b) => a.matchup.localeCompare(b.matchup)),
      rows,
    });
  } catch (err) {
    return apiError(err, 'api/mlb/grades');
  }
}
