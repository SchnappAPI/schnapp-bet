import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Wraps a JSON response with an MD5-derived ETag and short-circuits to a
 * 304 Not Modified when the request's If-None-Match header matches.
 *
 * MD5 is a non-cryptographic fingerprint here — only used for change
 * detection on a single response body, never for security.
 *
 * Use only on routes where the payload is small enough that hashing on every
 * request is cheaper than the bandwidth saved (grades, top-grades, player
 * history). Skip for routes with very short cache TTLs (games/today @ 10s)
 * where the 304 win is dominated by edge cache anyway.
 */
export function jsonWithEtag(
  req: NextRequest,
  data: unknown,
  init?: ResponseInit
): NextResponse {
  const body = JSON.stringify(data);
  const hash = createHash('md5').update(body).digest('hex');
  const etag = `"${hash}"`;

  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        ...(init?.headers ?? {}),
      },
    });
  }

  const headers = new Headers(init?.headers);
  headers.set('ETag', etag);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return new NextResponse(body, {
    ...init,
    headers,
  });
}
