import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { getViewer } from '@/lib/auth';
import { viewOf } from '@/lib/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const { id } = await params;
  const viewer = await getViewer();

  const { data: row } = await db.from('links').select('*').eq('id', Number(id)).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let saved = false;
  if (viewer) {
    const { data } = await db.from('saves').select('link_id').eq('user_id', viewer.id).eq('link_id', row.id).maybeSingle();
    saved = !!data;
  }
  return NextResponse.json({ link: { ...viewOf(row, viewer), saved } });
}
