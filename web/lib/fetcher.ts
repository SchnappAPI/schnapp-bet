// SWR fetcher with optional X-Auth-Token injection.
//
// /api/search is gated by the middleware; everything else is open today.
// We read the token from localStorage if present and always send it — costs
// nothing on routes that don't check it, and works on routes that do.
//
// Errors throw so SWR keeps the previous cached value rather than swapping
// in undefined. Non-2xx responses become throws too.

const TOKEN_KEY = 'schnapp_auth_token';

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function fetcher<T = unknown>(url: string): Promise<T> {
  const token = readToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['x-auth-token'] = token;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} on ${url}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}
