import { NextResponse } from 'next/server';
import { checkBotId } from 'botid/server';
import { db } from './supabase.js';

// Keeps the catalogue from being copied out in bulk. Two checks:
//
//   1. Bots. The JSON the website itself calls (/api/catalog, saves, the
//      assistant) answers only a real browser. Vercel BotID challenges the
//      page invisibly and checkBotId() reads the verdict, so a script or an
//      agent calling those URLs directly gets a 403. Agents have their own
//      door, MCP, which needs a member's key.
//   2. Pace. Every caller, by account or MCP key (or IP when signed out),
//      gets a per-minute and a per-day allowance, counted in Postgres so it
//      holds across server instances. A person never comes near them; a
//      scraper has to slow to a crawl on one account we can see.
//
// Neither makes data a paying member can see impossible to copy by hand;
// together they make copying it by machine slow, visible and tied to an
// account.

// [window in seconds, most requests in it]
const RULES = {
  catalog: [[60, 40], [86400, 600]],
  entry: [[60, 30], [86400, 300]],
  mcp: [[60, 60], [86400, 1500]],
  chat: [[60, 8], [86400, 150]],
  saves: [[60, 30], [86400, 500]],
};

/** Who is asking: the account when signed in, otherwise the address. */
export function callerOf(req, viewer) {
  if (viewer?.id) return 'u:' + viewer.id;
  const h = req?.headers;
  const ip = h?.get('x-real-ip') || h?.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  return 'ip:' + ip;
}

/** Seconds to wait before the next request, or 0 when it may go ahead. */
export async function waitFor(rule, who, cost = 1) {
  const windows = RULES[rule];
  const { data, error } = await db.rpc('rate_hit', {
    p_key: rule + ':' + who,
    p_windows: windows.map((w) => w[0]),
    p_limits: windows.map((w) => w[1]),
    p_cost: cost,
  });
  if (error) {
    // Never take the site down over a counter.
    console.error('rate limit unavailable:', error.message);
    return 0;
  }
  if (data > 0) console.warn('rate limited', rule, who);
  return data || 0;
}

/** True when BotID says this request did not come from a real browser. */
export async function isBot() {
  // Only Vercel can verify; elsewhere it behaves as in development (human),
  // unless BOTID_TEST names a verdict to simulate.
  if (!process.env.VERCEL && !process.env.BOTID_TEST) return false;
  try {
    const verdict = await checkBotId({
      developmentOptions: { isDevelopment: !process.env.VERCEL, bypass: process.env.BOTID_TEST || undefined },
    });
    return verdict.isBot;
  } catch (e) {
    console.error('botid check failed:', e.message);
    return false;
  }
}

export const botDenied = () =>
  NextResponse.json(
    { error: 'Automated access is not allowed. Use Stash in a browser, or connect your agent over MCP with a key from /connect.' },
    { status: 403 }
  );

export const slowDown = (wait) =>
  NextResponse.json(
    { error: 'Too many requests. Try again in ' + (wait < 90 ? wait + ' seconds' : Math.ceil(wait / 60) + ' minutes') + '.' },
    { status: 429, headers: { 'retry-after': String(wait) } }
  );

/** For the browser-only JSON routes: a bot check, then the pace check. */
export async function guard(req, rule, viewer) {
  if (await isBot()) return botDenied();
  const wait = await waitFor(rule, callerOf(req, viewer));
  return wait ? slowDown(wait) : null;
}
