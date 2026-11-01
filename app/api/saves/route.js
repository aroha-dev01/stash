import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { requireViewer } from '@/lib/auth';
import { policyFor, canOpen } from '@/lib/access';
import { PRO } from '@/lib/plans';
import { guard } from '@/lib/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Save a catalogue entry to My Stash: { link_id }. Saving twice is harmless. */
export async function POST(req) {
  const { viewer, error } = await requireViewer();
  if (error) return error;
  const stop = await guard(req, 'saves', viewer);
  if (stop) return stop;
  const { link_id } = await req.json().catch(() => ({}));
  const id = Number(link_id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'link_id is required' }, { status: 400 });

  // Only what the member can open: a save would otherwise confirm the entry
  // exists and, through the saved list, become a way round the lock.
  const { data: row } = await db.from('links').select('id,category,access').eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canOpen(row, await policyFor(viewer))) {
    return NextResponse.json({ error: 'This entry is part of ' + PRO.name + '.', upgrade: '/upgrade' }, { status: 403 });
  }

  const { error: e } = await db.from('saves').upsert({ user_id: viewer.id, link_id: id }, { onConflict: 'user_id,link_id' });
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });
  return NextResponse.json({ ok: true, saved: true });
}

export async function DELETE(req) {
  const { viewer, error } = await requireViewer();
  if (error) return error;
  const stop = await guard(req, 'saves', viewer);
  if (stop) return stop;
  const id = Number(req.nextUrl.searchParams.get('link_id'));
  await db.from('saves').delete().eq('user_id', viewer.id).eq('link_id', id);
  return NextResponse.json({ ok: true, saved: false });
}
