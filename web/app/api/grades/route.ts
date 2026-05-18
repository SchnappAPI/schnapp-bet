import { NextRequest, NextResponse } from 'next/server';
import { getGrades, type GradesSport } from '@/lib/queries';
import { jsonWithEtag } from '@/lib/etag';

function normalizeSport(raw: string | null): GradesSport {
  if (raw === 'mlb') return 'mlb';
  if (raw === 'all') return 'all';
  return 'nba';
}

export async function GET(req: NextRequest) {
  const date   = req.nextUrl.searchParams.get('date')   ?? new Date().toISOString().slice(0, 10);
  const gameId = req.nextUrl.searchParams.get('gameId') ?? null;
  const sport  = normalizeSport(req.nextUrl.searchParams.get('sport'));

  try {
    const rows = await getGrades(date, gameId, sport);

    // updated_at: latest grade_date in the result set, falling back to now
    // when the result set is empty. ISO 8601 UTC. PropMatrix v2 doesn't
    // surface this directly — it's primarily here for ETag derivation
    // and future SSE Last-Event-ID.
    let updated_at = new Date().toISOString();
    if (rows.length > 0) {
      const maxDate = rows.reduce((acc, r) => {
        return r.gradeDate && r.gradeDate > acc ? r.gradeDate : acc;
      }, rows[0].gradeDate ?? '');
      if (maxDate) {
        const d = new Date(`${maxDate}T00:00:00Z`);
        if (!isNaN(d.getTime())) updated_at = d.toISOString();
      }
    }

    const payload = {
      rows,
      params: { sport, date, gameId },
      updated_at,
      // Legacy callers expect `grades` + `date` at the top level; preserve
      // these so the existing PropMatrix continues to work during the v1→v2
      // transition. The redesign reads `rows`.
      date,
      gameId,
      grades: rows,
    };

    return jsonWithEtag(req, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
