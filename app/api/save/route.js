import { NextResponse } from 'next/server';
import { db, shape } from '@/lib/supabase';
import { enrichLink } from '@/lib/enrich';
import { normalizeUrl } from '@/lib/util';
import { inferSource } from '@/lib/taxonomy';
import { resolveKey } from '@/lib/mcpkeys';
import { getSetting, newEntryAccess } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// One request that saves AND enriches, so the iOS Share Sheet shortcut can be
// a single action. /api/links deliberately returns immediately and lets the
// browser kick off enrichment separately, but a Shortcut has no page sitting
// there to do that follow-up call, so a link saved from the share sheet would
// stay 'pending' forever. This endpoint closes that gap.
//
// GET is supported as well as POST purely because it makes the Shortcut
// trivial to build: one "Get Contents of URL" step, no JSON body to hand-write.

async function save(rawUrl, note, source) {
  let norm;
  try {
    norm = normalizeUrl(rawUrl);
  } catch {
    return { status: 400, body: { ok: false, error: 'That does not look like a URL.' } };
  }

  const { data: existing } = await db.from('links').select('*').eq('norm_url', norm).maybeSingle();

  if (existing) {
    if (note) await db.from('links').update({ note }).eq('id', existing.id);
    // Re-enrich only if it never finished, so re-sharing something is cheap.
    if (existing.status !== 'ready') await enrichLink(existing.id).catch(() => {});
    const { data: fresh } = await db.from('links').select('*').eq('id', existing.id).maybeSingle();
    return {
      status: 200,
      body: { ok: true, duplicate: true, saved: shape(fresh || existing) },
    };
  }

  const { data, error } = await db
    .from('links')
    .insert({
      kind: 'link',
      url: norm,
      norm_url: norm,
      domain: new URL(norm).hostname,
      title: new URL(norm).hostname,
      note: note || null,
      source: source || inferSource(norm),
      tags: [],
      status: 'pending',
      ...(await newEntryAccess()),
    })
    .select('*')
    .single();

  if (error) return { status: 500, body: { ok: false, error: error.message } };

  // The row already exists at this point, so even if enrichment times out or
  // the model is down, the link is never lost.
  try {
    await enrichLink(data.id);
  } catch (e) {
    const { data: partial } = await db.from('links').select('*').eq('id', data.id).maybeSingle();
    return {
      status: 200,
      body: { ok: true, enriched: false, note: 'Saved, but enrichment failed: ' + e.message, saved: shape(partial || data) },
    };
  }

  const { data: fresh } = await db.from('links').select('*').eq('id', data.id).maybeSingle();
  return { status: 201, body: { ok: true, enriched: true, saved: shape(fresh || data) } };
}

/**
 * Pulls the shared URL out of the raw query string rather than via
 * searchParams.
 *
 * An iOS Shortcut appends "Shortcut Input" onto the end of the address as
 * plain text, with no encoding. A YouTube or Twitter link routinely carries
 * its own query, so ?url=https://x.com/a?s=20&t=9 would be parsed as url=
 * "https://x.com/a?s=20" plus a stray t=9, and the link would be silently
 * truncated. Taking everything after the last url= keeps it intact, which is
 * why the instructions insist url= goes last.
 */
function rawUrlParam(reqUrl) {
  const qi = reqUrl.indexOf('?');
  if (qi < 0) return null;
  const m = reqUrl.slice(qi + 1).match(/(?:^|&)u(?:rl)?=(.*)$/);
  if (!m || !m[1]) return null;
  try {
    // Handles the case where the Shortcut, or Safari, did encode it.
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Short, human-readable line so the Shortcut can show a useful notification. */
function summarise(body) {
  if (!body.ok) return 'Stash: ' + (body.error || 'failed');
  const l = body.saved || {};
  const bits = [l.title || l.domain];
  if (l.category) bits.push(l.category);
  if (body.duplicate) bits.push('already saved');
  return bits.filter(Boolean).join(' — ');
}

/**
 * Hidden from members for now: the iOS share sheet is a curator feature until
 * it ships as part of Pro. It answers to:
 *
 *   - a shortcut key (ios_stash_...) belonging to a curator, while the switch
 *     in /admin is on. Sent as `Authorization: Bearer <key>`.
 *   - STASH_TOKEN, for scripts, whatever the switch says.
 *
 * Anything else gets a 404, so the endpoint does not advertise itself. A key in
 * the query (?key= or ?token=) also works but must come BEFORE url=, which has
 * to stay last (see rawUrlParam).
 */
async function allowed(req) {
  const header = req.headers.get('authorization') || '';
  const p = req.nextUrl.searchParams;
  const given = (header.startsWith('Bearer ') ? header.slice(7) : p.get('key') || p.get('token') || '').trim();
  if (!given) return false;

  const token = process.env.STASH_TOKEN;
  if (token && given === token) return true;

  if (!(await getSetting('ios_shortcut')).enabled) return false;
  const who = await resolveKey(given, 'shortcut');
  return !!who?.isAdmin;
}

const notFound = () => NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

// ?check=1 proves the key and the connection without saving anything. Using
// the key records "last heard from", which is what /admin shows as connected.
const CONNECTED = 'Stash is connected. Share any page to save it.';

export async function GET(req) {
  if (!(await allowed(req))) return notFound();
  const p = req.nextUrl.searchParams;
  if (p.get('check') === '1') {
    return p.get('text') === '1'
      ? new NextResponse(CONNECTED, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
      : NextResponse.json({ ok: true, message: CONNECTED });
  }
  const url = rawUrlParam(req.url) || p.get('url') || p.get('u');
  if (!url) return NextResponse.json({ ok: false, error: 'Pass ?url=' }, { status: 400 });

  const r = await save(url, p.get('note'), p.get('source') || 'share-sheet');

  // text=1 returns a bare line instead of JSON, which is what you want when a
  // Shortcut pipes the result straight into a notification.
  if (p.get('text') === '1') {
    return new NextResponse(summarise(r.body), {
      status: r.status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return NextResponse.json({ ...r.body, message: summarise(r.body) }, { status: r.status });
}

export async function POST(req) {
  if (!(await allowed(req))) return notFound();
  const body = await req.json().catch(() => ({}));
  const url = body.url || body.u || req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ ok: false, error: 'Pass a url' }, { status: 400 });

  const r = await save(url, body.note, body.source || 'share-sheet');
  return NextResponse.json({ ...r.body, message: summarise(r.body) }, { status: r.status });
}
