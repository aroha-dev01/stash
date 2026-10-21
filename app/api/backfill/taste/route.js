import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { scoreTaste, TASTE_VERSION } from '@/lib/taste';
import { jevEnabled } from '@/lib/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Scores saved design items with Jev (premium feel, how distinctive, motion,
// risk, style, industry fit). One Jev request per item, a handful per call.
// Call it repeatedly until `remaining` reaches 0. Needs supabase/taste.sql.
//
//   POST /api/backfill/taste            next slice
//   POST /api/backfill/taste?redo=1     rescore everything from the start
//   POST /api/backfill/taste?no_image=1 text only (faster, a little less accurate)

const SLICE = 8;

export async function POST(req) {
  const secret = process.env.STASH_TOKEN;
  if (secret && (req.headers.get('authorization') || '') !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  if (!jevEnabled()) return NextResponse.json({ error: 'Set TYPESAFE_API_KEY (or OPENROUTER_API_KEY) first.' }, { status: 400 });

  const url = new URL(req.url);
  const redo = url.searchParams.get('redo') === '1';
  const withImage = url.searchParams.get('no_image') !== '1';
  const after = Number(url.searchParams.get('after')) || 0;
  const started = Date.now();

  let q = db.from('links').select('*').order('id', { ascending: true }).limit(SLICE);
  q = redo ? q.gt('id', after) : q.or('taste_v.is.null,taste_v.lt.' + TASTE_VERSION);
  const { data: due, error } = await q;
  if (error) {
    const missing = /taste/i.test(error.message || '');
    return NextResponse.json({
      error: missing ? 'The taste columns are missing. Run supabase/taste.sql in the Supabase SQL editor, then call this again.' : error.message,
    }, { status: 500 });
  }

  const done = [];
  const failed = [];
  // Items are independent, so score a few at a time.
  const queue = [...(due || [])];
  const worker = async () => {
    while (queue.length && Date.now() - started < 45000) {
      const link = queue.shift();
      try {
        const t = await scoreTaste(link, { withImage });
        done.push({ id: link.id, name: link.title, relevant: t.relevant, premium: t.premium, style: t.style });
      } catch (e) {
        failed.push({ id: link.id, why: String(e.message || e).slice(0, 120) });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const { count } = redo
    ? await db.from('links').select('id', { count: 'exact', head: true }).gt('id', Math.max(after, ...done.map((d) => d.id), 0))
    : await db.from('links').select('id', { count: 'exact', head: true }).or('taste_v.is.null,taste_v.lt.' + TASTE_VERSION);

  return NextResponse.json({
    ok: true,
    took_ms: Date.now() - started,
    scored: done.length,
    failed,
    remaining: count ?? null,
    next_after: redo && done.length ? Math.max(...done.map((d) => d.id)) : undefined,
    sample: done.slice(0, 4),
    hint: count ? 'Call this again until remaining is 0.' : 'Everything is scored.',
  });
}
