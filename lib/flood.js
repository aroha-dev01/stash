// The first line against floods, in memory and free: proxy.js counts each
// IP's requests per minute and answers 429 past a generous limit, before any
// route runs, any session is checked or the database is touched.
//
// Counts live in this server instance only. Vercel reuses instances across
// requests (Fluid compute), so a flood from one address is cut quickly, but a
// limit is per instance, not global. The per-account allowances in
// lib/guard.js (counted in Postgres, so global) sit behind it, and Vercel's
// automatic DDoS mitigation sits in front for floods too big for any app.
//
// Limits are per IP and generous on purpose: mobile carriers put many people
// behind one address, and hosted agents (Claude's connectors and the like)
// reach /api/mcp from their providers' shared addresses.

const WINDOW_MS = 60_000;

/** [requests a minute per IP, how to answer] for each kind of path. */
export const FLOOD = {
  signin: 30, // signing in and approving agents: a person does this a few times a day
  api: 300, // the website's JSON calls, MCP, OAuth tokens
  page: 600, // pages, including Next's prefetches of linked pages
};

export function floodClassOf(path) {
  if (path === '/login' || path.startsWith('/auth/') || path.startsWith('/oauth/') || path === '/api/oauth/authorize') return 'signin';
  if (path.startsWith('/api/')) return 'api';
  return 'page';
}

const buckets = new Map(); // "class:ip" -> { count, reset }
const MAX_TRACKED = 50_000;

function sweep(now) {
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
  // Spread across more addresses than this in one minute is a distributed
  // flood, which is Vercel's to absorb; forget everything rather than grow.
  if (buckets.size >= MAX_TRACKED) buckets.clear();
}

/** Seconds until this IP may send another request of this class, or 0. */
export function floodWait(cls, ip) {
  const now = Date.now();
  const key = cls + ':' + ip;
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    if (buckets.size >= MAX_TRACKED) sweep(now);
    b = { count: 0, reset: now + WINDOW_MS };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count > FLOOD[cls] ? Math.max(1, Math.ceil((b.reset - now) / 1000)) : 0;
}

/** The caller's address as Vercel reports it (Vercel sets these; clients cannot). */
export function ipOf(request) {
  const h = request.headers;
  return h.get('x-real-ip') || h.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}
