import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { embed } from '@/lib/embed';
import { getViewer } from '@/lib/auth';
import { viewOf, TOOLKITS } from '@/lib/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS = new Set(['newest', 'oldest', 'stars', 'title']);

/**
 * The public catalogue. Anyone can browse; premium entries come back as
 * locked teasers until the visitor signs in. `saved=1` is a member's own list.
 */
export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const viewer = await getViewer();

  const q = (p.get('q') || '').trim().slice(0, 200);
  const toolkit = TOOLKITS.find((t) => t.key === p.get('toolkit'));
  const limit = Math.min(Math.max(Number(p.get('limit')) || 24, 1), 48);
  const offset = Math.max(Number(p.get('offset')) || 0, 0);
  const sort = SORTS.has(p.get('sort')) ? p.get('sort') : 'newest';

  let savedIds = [];
  if (viewer) {
    const { data } = await db.from('saves').select('link_id').eq('user_id', viewer.id);
    savedIds = (data || []).map((r) => r.link_id);
  }

  let f_ids = null;
  if (p.get('saved') === '1') {
    if (!viewer) return NextResponse.json({ error: 'Sign in to see your saved tools' }, { status: 401 });
    f_ids = savedIds.length ? savedIds : [-1];
  }

  const { data, error } = await db.rpc('search_links', {
    q: q || null,
    q_embedding: q ? await embed(q) : null,
    f_categories: toolkit ? toolkit.categories : null,
    f_type: p.get('type') || null,
    f_oss: p.get('oss') === '1',
    f_dead: false,
    f_ids,
    sort_by: sort,
    max_rows: limit,
    skip_rows: offset,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data || [];
  const saved = new Set(savedIds);
  return NextResponse.json({
    items: rows.map((r) => ({ ...viewOf(r, viewer), saved: saved.has(r.id) })),
    total: rows.length ? Number(rows[0].total_count) : 0,
    mode: q ? 'search' : 'browse',
  });
}
