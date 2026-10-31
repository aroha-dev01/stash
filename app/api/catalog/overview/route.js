import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { TOOLKITS, toolkitFor } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Counts for the landing page and the explore rail. Only public-safe
 * aggregates: per toolkit, per type, and how much sits behind sign-in.
 * Never the facets RPC, whose collections are client project names.
 */
export async function GET() {
  const { data, error } = await db.from('links').select('category,type,is_premium').eq('dead', false);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data || [];
  const toolkits = TOOLKITS.map((t) => ({ key: t.key, label: t.label, blurb: t.blurb, count: 0, premium: 0 }));
  const byKey = new Map(toolkits.map((t) => [t.key, t]));
  const types = {};

  for (const r of rows) {
    const t = byKey.get(toolkitFor(r.category));
    t.count += 1;
    if (r.is_premium) t.premium += 1;
    if (r.type) types[r.type] = (types[r.type] || 0) + 1;
  }

  return NextResponse.json({
    total: rows.length,
    premium: rows.filter((r) => r.is_premium).length,
    toolkits,
    types: Object.entries(types).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  });
}
