import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { getViewer } from '@/lib/auth';
import { policyFor, TIERS } from '@/lib/access';
import { browse } from '@/lib/browse';
import { guard } from '@/lib/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The catalogue, as this viewer may see it. Entries they cannot open are not
 * returned at all; `hidden` says how many more match behind sign-in or Pro.
 * `saved=1` is a member's own list, filtered by the same policy.
 */
export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const viewer = await getViewer();
  const stop = await guard(req, 'catalog', viewer);
  if (stop) return stop;
  const policy = await policyFor(viewer);

  let savedIds = [];
  if (viewer) {
    const { data } = await db.from('saves').select('link_id').eq('user_id', viewer.id);
    savedIds = (data || []).map((r) => r.link_id);
  }

  let ids = null;
  const savedOnly = p.get('saved') === '1';
  if (savedOnly) {
    if (!viewer) return NextResponse.json({ error: 'Sign in to see your saved tools' }, { status: 401 });
    ids = savedIds.length ? savedIds : [-1];
  }

  try {
    const page = await browse(policy, {
      q: p.get('q'),
      toolkit: p.get('toolkit'),
      type: p.get('type'),
      access: viewer && TIERS.includes(p.get('access')) ? p.get('access') : null,
      featured: p.get('featured') === '1',
      ids,
      sort: p.get('sort'),
      limit: p.get('limit'),
      offset: p.get('offset'),
      countHidden: !savedOnly,
    });
    const saved = new Set(savedIds);
    return NextResponse.json({
      ...page,
      items: page.items.map((i) => ({ ...i, saved: saved.has(i.id) })),
      mode: p.get('q') ? 'search' : 'browse',
      level: policy.level,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
