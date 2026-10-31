import { NextResponse } from 'next/server';
import { db, shape } from '@/lib/supabase';
import { embed } from '@/lib/embed';
import { normalizeUrl } from '@/lib/util';
import { inferSource, STAGES, TOOLKITS, toolkitFor } from '@/lib/taxonomy';
import { premiumToolkits, tierOf } from '@/lib/access';
import { requireAdmin } from '@/lib/auth';
import { newEntryAccess } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------ list/search */

export async function GET(req) {
  const { error: denied } = await requireAdmin();
  if (denied) return denied;
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

  // Console views the RPC has no parameter for. Same over-fetch approach as
  // stages: the catalogue is a few hundred rows, so this stays cheap.
  //
  // Tier views go by the tier an entry effectively has, so an entry stored as
  // public inside a Premium toolkit counts as Premium, exactly as members see it.
  // `collection` is the Free collection: everything a Free member can open.
  const attention = p.get('attention') === '1'; // failed, still reading, or broken
  const tier = ['public', 'free', 'premium', 'collection'].includes(p.get('access')) ? p.get('access') : null;
  const toolkit = TOOLKITS.find((t) => t.key === p.get('toolkit'))?.key || null;
  const locks = { premiumToolkits: tier ? await premiumToolkits() : [] };
  const keep = (r) =>
    (!stage || stage.categories.includes(r.category)) &&
    (!toolkit || toolkitFor(r.category) === toolkit) &&
    (!tier || (tier === 'collection' ? !r.dead && tierOf(r, locks) !== 'premium' : tierOf(r, locks) === tier)) &&
    (!attention || r.dead || r.status === 'error' || r.status === 'pending' || r.status === 'enriching');
  const postFilter = !!(stage || attention || tier || toolkit);

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
    // Curators see every tier; these only narrow the console's views.
    f_featured: p.get('featured') === '1',
    sort_by: p.get('sort') || 'newest',
    max_rows: postFilter ? 2000 : limit,
    skip_rows: postFilter ? 0 : offset,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data || [];
  let total = rows.length ? Number(rows[0].total_count) : 0;

  if (postFilter) {
    rows = rows.filter(keep);
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
  const { error: denied } = await requireAdmin();
  if (denied) return denied;
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
      ...(await newEntryAccess()),
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrichment runs as its own request so saving stays instant and the slow
  // work gets a full function budget of its own. The client kicks it off.
  return NextResponse.json({ link: shape(data), enrich: `/api/enrich/${data.id}` }, { status: 201 });
}
