import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { STAGES } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY = {
  categories: [], collections: [], tags: [], sources: [], pricing: [], stages: [],
  stats: { total: 0, oss: 0, starred: 0, errored: 0, working: 0, dead: 0, unchecked: 0 },
};

export async function GET() {
  const { data, error } = await db.rpc('stash_facets');
  if (error) return NextResponse.json(EMPTY);
  const f = data || {};

  // Categories grouped into the phase of a client website/web-app build they
  // belong to. Computed here rather than stored, so it always reflects the
  // live category list without a migration every time a category is added.
  const stages = STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    hint: s.hint,
    count: (f.categories || [])
      .filter((c) => s.categories.includes(c.name))
      .reduce((sum, c) => sum + c.count, 0),
  }));

  return NextResponse.json({ ...EMPTY, ...f, stages });
}
