import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { premiumOf } from '@/lib/taste';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Calibration. Jev's idea of "premium" is a starting point; yours wins.
//
//   GET  /api/taste?top=40            items with Jev's premium score, to review
//   GET  /api/taste?unrated=1&top=30  only ones you have not rated, mixed across the range
//   POST /api/taste  { id, premium }  premium 0-4 (0 template, 4 exceptional); null clears it
//
// A rating is stored in links.taste.manual and is kept when the item is rescored.

const guard = (req) => {
  const secret = process.env.STASH_TOKEN;
  return !secret || (req.headers.get('authorization') || '') === 'Bearer ' + secret;
};

export async function GET(req) {
  if (!guard(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const u = new URL(req.url);
  const top = Math.min(Number(u.searchParams.get('top')) || 40, 100);
  const { data, error } = await db.from('links').select('id,title,domain,url,image,taste').not('taste', 'is', null).limit(600);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let rows = (data || []).filter((r) => r.taste?.relevant >= 0.5);
  if (u.searchParams.get('unrated') === '1') rows = rows.filter((r) => typeof r.taste?.manual?.premium !== 'number');
  rows.sort((a, b) => (premiumOf(b.taste) ?? 0) - (premiumOf(a.taste) ?? 0));
  // Spread the sample across the whole range, so you rate the easy and the hard ones.
  const step = Math.max(1, rows.length / top);
  const picked = Array.from({ length: Math.min(top, rows.length) }, (_, i) => rows[Math.floor(i * step)]);
  return NextResponse.json({
    count: picked.length,
    items: picked.map((r) => ({
      id: r.id, name: r.title, url: r.url, preview: r.image,
      jev_premium_0_to_4: Math.round((r.taste.premium ?? 0) * 4 * 10) / 10,
      your_rating: r.taste.manual?.premium ?? null,
      style: r.taste.style, confidence: r.taste.conf,
    })),
  });
}

export async function POST(req) {
  if (!guard(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const p = b.premium === null ? null : Number(b.premium);
  if (p !== null && !(p >= 0 && p <= 4)) return NextResponse.json({ error: 'premium must be 0 to 4, or null to clear' }, { status: 400 });

  const { data: row } = await db.from('links').select('taste').eq('id', id).maybeSingle();
  const taste = { ...(row?.taste || { v: 0 }) };
  if (p === null) delete taste.manual;
  else taste.manual = { premium: Math.round(p * 10) / 10, at: new Date().toISOString() };
  const { error } = await db.from('links').update({ taste }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id, manual: taste.manual || null });
}
