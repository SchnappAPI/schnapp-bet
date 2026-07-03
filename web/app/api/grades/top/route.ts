import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { getGrades, type GradesSport, type GradeRow } from '@/lib/queries';
import { getAllSignals, type Signal } from '@/lib/signals';
import { jsonWithEtag } from '@/lib/etag';

function normalizeSport(raw: string | null): GradesSport {
  if (raw === 'nba') return 'nba';
  if (raw === 'mlb') return 'mlb';
  return 'all';
}

function todayCT(): string {
  const now = new Date();
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return `${ct.getFullYear()}-${String(ct.getMonth() + 1).padStart(2, '0')}-${String(ct.getDate()).padStart(2, '0')}`;
}

interface TopGradeRow {
  player_id: number | null;
  player_name: string;
  team_abbr: string | null;
  sport: 'nba' | 'mlb';
  market: string;
  line: number;
  side: string;
  grade: number | null;
  ev_pct: number | null;
  signals: Signal[];
  game_id: string | null;
}

function pickSport(row: GradeRow, requested: GradesSport): 'nba' | 'mlb' {
  if (requested === 'nba' || requested === 'mlb') return requested;
  // For sport=all, infer per-row. NBA grades have a populated nba.players join
  // (homeTeamAbbr derived from nba.schedule). MLB rows would have null
  // homeTeamAbbr because the nba.schedule join misses. The current
  // common.daily_grades.model_version prefix is the canonical signal but
  // isn't returned in GradeRow. Best heuristic available: if oppTeamAbbr
  // resolved to a non-null value via nba.teams, it's NBA.
  if (row.homeTeamAbbr || row.awayTeamAbbr || row.position) return 'nba';
  return 'mlb';
}

function teamAbbrForRow(row: GradeRow): string | null {
  // The player's own team is whichever side of the matchup isn't the
  // opponent. oppTeamAbbr is precomputed by getGrades; the player's team
  // is the *other* side.
  if (row.homeTeamAbbr && row.awayTeamAbbr && row.oppTeamAbbr) {
    if (row.oppTeamAbbr === row.homeTeamAbbr) return row.awayTeamAbbr;
    if (row.oppTeamAbbr === row.awayTeamAbbr) return row.homeTeamAbbr;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const sport = normalizeSport(req.nextUrl.searchParams.get('sport'));
  const nRaw  = req.nextUrl.searchParams.get('n');
  const date  = req.nextUrl.searchParams.get('date') ?? todayCT();
  const n     = Math.max(1, Math.min(100, parseInt(nRaw ?? '10', 10) || 10));

  try {
    const rows = await getGrades(date, null, sport);

    // Single pass over rows: derive signals once per row, accumulate the
    // top-N output AND the dashboard-wide signal counts. This collapses what
    // was previously two endpoints (/grades/top + /grades/signals/today)
    // sharing the same getGrades() result into one round-trip.
    const counts = { hot: 0, cold: 0, due: 0, fade: 0, streak: 0, slump: 0, longshot: 0 };
    const enriched = rows.map((r) => {
      const all = getAllSignals({
        trendGrade:      r.trendGrade,
        regressionGrade: r.regressionGrade,
        momentumGrade:   r.momentumGrade,
        overPrice:       r.overPrice,
        hitRate20:       r.hitRate20,
        hitRate60:       r.hitRate60,
      }).all;
      for (const s of all) {
        switch (s.type) {
          case 'HOT':      counts.hot++;      break;
          case 'COLD':     counts.cold++;     break;
          case 'DUE':      counts.due++;      break;
          case 'FADE':     counts.fade++;     break;
          case 'STREAK':   counts.streak++;   break;
          case 'SLUMP':    counts.slump++;    break;
          case 'LONGSHOT': counts.longshot++; break;
        }
      }
      return { row: r, signals: all };
    });

    // Already sorted by COALESCE(ev_pct, composite_grade, grade) DESC inside
    // getGrades. Take the top N for the response.
    const top = enriched.slice(0, n).map<TopGradeRow>(({ row: r, signals }) => ({
      player_id:   r.playerId,
      player_name: r.playerName,
      team_abbr:   teamAbbrForRow(r),
      sport:       pickSport(r, sport),
      market:      r.marketKey,
      line:        r.lineValue,
      side:        r.outcomeName ?? 'Over',
      grade:       r.compositeGrade ?? r.grade,
      ev_pct:      r.evPct,
      signals,
      game_id:     r.gameId,
    }));

    const updated_at = new Date().toISOString();
    return jsonWithEtag(req, {
      rows: top,
      counts,
      updated_at,
      params: { sport, n, date },
    });
  } catch (err) {
    return apiError(err, 'api/grades/top');
  }
}
