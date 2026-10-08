import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { tagSections, SECTIONS_VERSION } from '@/lib/sections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Tags existing links with sections / effects / styles / format.
//
// Each call works through as many untagged links as fit in ~45 seconds,
// several at a time, then reports what is left. Call it repeatedly until
// `remaining` is 0. Tagging only reads what is already stored, so it is safe
// to re-run and never touches summaries, images or repo data.

const CONCURRENCY = 6;
const BUDGET_MS = 45000;

const SELECT =
  'id,url,domain,title,summary,description,type,category,role,use_cases,tags,works_with';

async function remaining() {
  const { count } = await db
    .from('links')
    .select('id', { count: 'exact', head: true })
    .lt('sections_v', SECTIONS_VERSION)
    .eq('status', 'ready');
  return count ?? 0;
}

export async function POST(req) {
  const secret = process.env.STASH_TOKEN;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== 'Bearer ' + secret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  const started = Date.now();
  const done = [];
  const failed = [];
  const tried = new Set();

  while (Date.now() - started < BUDGET_MS) {
    const { data: due, error } = await db
      .from('links')
      .select(SELECT)
      .lt('sections_v', SECTIONS_VERSION)
      .eq('status', 'ready')
      .order('id', { ascending: true })
      .limit(CONCURRENCY + tried.size);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Skip anything that already failed in this call, so one bad row cannot
    // be retried forever inside a single request.
    const batch = (due || []).filter((l) => !tried.has(l.id)).slice(0, CONCURRENCY);
    if (!batch.length) break;

    const results = await Promise.allSettled(batch.map((l) => tagSections(l)));
    results.forEach((r, i) => {
      const id = batch[i].id;
      tried.add(id);
      if (r.status === 'fulfilled') done.push(id);
      else failed.push({ id, why: String(r.reason?.message || r.reason).slice(0, 120) });
    });
  }

  const left = await remaining();
  return NextResponse.json({
    ok: true,
    took_ms: Date.now() - started,
    tagged: done.length,
    failed,
    remaining: left,
    hint: left > 0 ? 'Call again to continue.' : 'Every link is section-tagged.',
  });
}

export async function GET() {
  const { count: total } = await db
    .from('links')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'ready');
  const left = await remaining();
  return NextResponse.json({ total: total ?? 0, tagged: (total ?? 0) - left, remaining: left });
}
