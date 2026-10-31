import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { getViewer } from '@/lib/auth';
import { policyFor, canOpen } from '@/lib/access';
import { viewOf } from '@/lib/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One entry. A viewer who cannot open it gets the locked teaser, never the record. */
export async function GET(_req, { params }) {
  const { id } = await params;
  const viewer = await getViewer();
  const policy = await policyFor(viewer);

  const { data: row } = await db.from('links').select('*').eq('id', Number(id)).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const open = canOpen(row, policy);
  let saved = false;
  if (viewer && open) {
    const { data } = await db.from('saves').select('link_id').eq('user_id', viewer.id).eq('link_id', row.id).maybeSingle();
    saved = !!data;
  }
  return NextResponse.json({ link: { ...viewOf(row, policy), saved }, level: policy.level });
}
