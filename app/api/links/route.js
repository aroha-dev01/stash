import { NextResponse } from 'next/server';
import { db, shape } from '@/lib/supabase';
import { embed } from '@/lib/embed';
import { normalizeUrl } from '@/lib/util';
import { inferSource, STAGES } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------ list/search */

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const q = (p.get('q') || '').trim();

  // Only pay for an embedding when there is something to search for.
  const q_embedding = q ? await embed(q) : null;

  // A "stage" (Design & Inspiration, Backend & Data, etc.) spans several
  // categories, and the RPC only filters on one exact category, so browsing
  // by stage over-fetches and filters here rather than adding a second RPC
  // signature just for a client-side grouping.
  const stageKey = p.get('stage') || null;
  const stage = stageKey ? STAGES.find((s) => s.key === stageKey) : null;
  const limit = Number(p.get('limit')) || 60;
  const offset = Number(p.get('offset')) || 0;

  const { data, error } = await db.rpc('search_links', {
    q: q || null,
    q_embedding,
    f_category: stage ? null : p.get('category') || null,
    f_pricing: p.get('pricing') || null,
    f_source: p.get('source') || null,
    f_kind: p.get('kind') || null,
    f_status: p.get('status') || null,
    f_tags: p.getAll('tag').length ? p.getAll('tag') : null,
    f_oss: p.get('oss') === '1',
    f_starred: p.get('starred') === '1',
    f_collection: p.get('collection') || null,
    f_language: p.get('language') || null,
    f_type: p.get('type') || null,
    f_min_stars: p.get('min_stars') ? Number(p.get('min_stars')) : null,
    f_maintained: p.get('maintained') === '1',
    f_dead: p.get('dead') === '1' ? true : null,
    f_section: p.get('section') || null,
    f_style: p.get('style') || null,
    f_effect: p.get('effect') || null,
    sort_by: p.get('sort') || 'newest',
    max_rows: stage ? 400 : limit,
    skip_rows: stage ? 0 : offset,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data || [];
  let total = rows.length ? Number(rows[0].total_count) : 0;

  if (stage) {
    rows = rows.filter((r) => stage.categories.includes(r.category));
    total = rows.length;
    rows = rows.slice(offset, offset + limit);
  }

  return NextResponse.json({
    items: rows.map(shape),
    total,
    mode: q ? 'search' : 'browse',
  });
}

/* -------------------------------------------------------------- save one */

export async function POST(req) {
  const body = await req.json().catch(() => ({}));

  let norm;
  try {
    norm = normalizeUrl(body.url);
  } catch {
    return NextResponse.json({ error: 'That does not look like a URL.' }, { status: 400 });
  }

  const { data: existing } = await db.from('links').select('*').eq('norm_url', norm).maybeSingle();
  if (existing) {
    if (body.note) {
      await db.from('links').update({ note: body.note }).eq('id', existing.id);
    }
    return NextResponse.json({ duplicate: true, link: shape(existing) });
  }

  const { data, error } = await db
    .from('links')
    .insert({
      kind: 'link',
      url: norm,
      norm_url: norm,
      domain: new URL(norm).hostname,
      title: new URL(norm).hostname,
      note: body.note || null,
      source: body.source || inferSource(norm),
      tags: Array.isArray(body.tags) ? body.tags : [],
      status: 'pending',
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrichment runs as its own request so saving stays instant and the slow
  // work gets a full function budget of its own. The client kicks it off.
  return NextResponse.json({ link: shape(data), enrich: `/api/enrich/${data.id}` }, { status: 201 });
}
