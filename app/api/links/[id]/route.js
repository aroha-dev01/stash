import { NextResponse } from 'next/server';
import { db, shape } from '@/lib/supabase';
import { embed, embeddingText } from '@/lib/embed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const { id } = await params;
  const { data } = await db.from('links').select('*').eq('id', Number(id)).maybeSingle();
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ link: shape(data) });
}

const EDITABLE = [
  'title', 'summary', 'category', 'note', 'pricing', 'source',
  'starred', 'is_open_source', 'url', 'tags', 'collections', 'dead',
];

/** Collection names are matched exactly in queries, so they are normalised. */
const cleanList = (v) => [
  ...new Set((v || []).map((x) => String(x).trim()).filter(Boolean)),
];

export async function PATCH(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const patch = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k];
  if (Array.isArray(patch.tags)) {
    patch.tags = [...new Set(patch.tags.map((t) => String(t).trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))];
  }
  // Collections keep their capitalisation - they are project names you read,
  // not machine tags.
  if (Array.isArray(patch.collections)) patch.collections = cleanList(patch.collections);

  const { data, error } = await db.from('links').update(patch).eq('id', Number(id)).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // An edited title or summary changes what this link means, so the vector
  // has to follow or semantic search drifts out of sync with reality.
  if (patch.title || patch.summary || patch.note || patch.tags || patch.category) {
    const vec = await embed(embeddingText(data));
    if (vec) await db.from('links').update({ embedding: vec }).eq('id', Number(id));
  }

  return NextResponse.json({ link: shape(data) });
}

export async function DELETE(_req, { params }) {
  const { id } = await params;
  await db.from('links').delete().eq('id', Number(id));
  return NextResponse.json({ ok: true });
}
