import { NextResponse } from 'next/server';
import { db, shape } from '@/lib/supabase';
import { normalizeUrl } from '@/lib/util';
import { inferSource } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Paste anything containing URLs — a list, a thread, exported bookmarks. */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const found = String(body.text || '').match(/https?:\/\/[^\s"'<>)\]]+/g) || [];

  const seen = new Set();
  const rows = [];

  for (const raw of found.slice(0, 200)) {
    let norm;
    try {
      norm = normalizeUrl(raw);
    } catch {
      continue;
    }
    if (seen.has(norm)) continue;
    seen.add(norm);

    rows.push({
      kind: 'link',
      url: norm,
      norm_url: norm,
      domain: new URL(norm).hostname,
      title: new URL(norm).hostname,
      source: inferSource(norm),
      status: 'pending',
    });
  }

  if (!rows.length) return NextResponse.json({ added: 0, duplicates: 0, found: found.length });

  // Existing rows are skipped rather than overwritten, so re-pasting a list
  // you already saved is harmless.
  const { data, error } = await db
    .from('links')
    .upsert(rows, { onConflict: 'norm_url', ignoreDuplicates: true })
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const added = data || [];
  return NextResponse.json({
    added: added.length,
    duplicates: rows.length - added.length,
    found: found.length,
    enrich: added.map((r) => `/api/enrich/${r.id}`),
  });
}
