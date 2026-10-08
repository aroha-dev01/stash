import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enrichLink } from '@/lib/enrich';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Re-enriches links that were catalogued before the usage fields existed.
//
// Ninety-one links cannot be re-enriched inside one 60-second function, so
// this does a slice per call and reports what is left. Call it repeatedly
// until `remaining` reaches zero. The nightly sweep would eventually get
// there on its own at three a day, but that is a month of waiting.

const SLICE = 6;

export async function POST(req) {
  const secret = process.env.STASH_TOKEN;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== 'Bearer ' + secret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  const started = Date.now();

  // Oldest schema version first, so a partial backfill is still coherent.
  const { data: due, error } = await db
    .from('links')
    .select('id,title,enriched_v')
    .lt('enriched_v', 2)
    .order('id', { ascending: true })
    .limit(SLICE);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const done = [];
  const failed = [];

  for (const link of due || []) {
    if (Date.now() - started > 48000) break;
    try {
      await enrichLink(link.id);
      done.push(link.id);
    } catch (e) {
      failed.push({ id: link.id, why: String(e.message || e).slice(0, 120) });
    }
  }

  const { count } = await db
    .from('links')
    .select('id', { count: 'exact', head: true })
    .lt('enriched_v', 2);

  return NextResponse.json({
    ok: true,
    took_ms: Date.now() - started,
    upgraded: done.length,
    ids: done,
    failed,
    remaining: count ?? 0,
    hint: (count ?? 0) > 0 ? 'Call again to continue.' : 'Every link is on the new schema.',
  });
}

export async function GET() {
  const { count: pending } = await db
    .from('links')
    .select('id', { count: 'exact', head: true })
    .lt('enriched_v', 2);
  const { count: total } = await db.from('links').select('id', { count: 'exact', head: true });

  return NextResponse.json({
    total: total ?? 0,
    on_new_schema: (total ?? 0) - (pending ?? 0),
    remaining: pending ?? 0,
  });
}
