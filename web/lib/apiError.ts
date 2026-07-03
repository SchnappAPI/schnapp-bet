import { NextResponse } from 'next/server';

// Generic error response for API route catch blocks. The real error is
// logged server-side only — raw driver/SQL messages carry schema names and
// connection detail that must not reach the client (they were previously
// returned verbatim from ~40 routes).
export function apiError(
  err: unknown,
  context: string,
  init?: { status?: number; message?: string },
) {
  console.error(`[api] ${context}:`, err);
  return NextResponse.json(
    { error: init?.message ?? 'Internal server error' },
    { status: init?.status ?? 500 },
  );
}
