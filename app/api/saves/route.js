import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { requireViewer } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Save a catalogue entry to My Stash: { link_id }. Saving twice is harmless. */
export async function POST(req) {
  const { viewer, error } = await requireViewer();
  if (error) return error;
  const { link_id } = await req.json().catch(() => ({}));
  const id = Number(link_id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'link_id is required' }, { status: 400 });

  const { error: e } = await db.from('saves').upsert({ user_id: viewer.id, link_id: id }, { onConflict: 'user_id,link_id' });
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });
  return NextResponse.json({ ok: true, saved: true });
}

export async function DELETE(req) {
  const { viewer, error } = await requireViewer();
  if (error) return error;
  const id = Number(req.nextUrl.searchParams.get('link_id'));
  await db.from('saves').delete().eq('user_id', viewer.id).eq('link_id', id);
  return NextResponse.json({ ok: true, saved: false });
}
