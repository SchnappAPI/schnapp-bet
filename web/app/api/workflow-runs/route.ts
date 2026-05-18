import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// Workflows tracked and which tabs they feed.
// nba-game-day: Roster, Matchups, Stats (lineup + box scores)
// nba-grading:  Trends, Props (tier lines + grades)
const WORKFLOWS = ['nba-game-day', 'nba-grading'] as const;

export async function GET() {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT workflow_name, completed_at
      FROM common.workflow_runs
      WHERE workflow_name IN ('nba-game-day', 'nba-grading')
    `);

    const runs: Record<string, string> = {};
    for (const row of result.recordset) {
      runs[row.workflow_name] = new Date(row.completed_at).toISOString();
    }

    return NextResponse.json(runs, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    // Table may not exist yet if no workflow has run since deploy.
    // Return empty object — UI will show nothing rather than crash.
    console.error('workflow-runs route error:', err);
    return NextResponse.json({}, { headers: { 'Cache-Control': 'no-store' } });
  }
}
