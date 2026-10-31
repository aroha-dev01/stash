import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { requireViewer } from '@/lib/auth';
import { newKey, MAX_ACTIVE_KEYS } from '@/lib/mcpkeys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLUMNS = 'id,name,prefix,created_at,last_used_at,last_client';

export async function GET() {
  const { viewer, error } = await requireViewer();
  if (error) return error;
  const { data } = await db
    .from('mcp_keys').select(COLUMNS)
    .eq('user_id', viewer.id).eq('kind', 'mcp').is('revoked_at', null)
    .order('created_at', { ascending: false });
  return NextResponse.json({ keys: data || [], max: MAX_ACTIVE_KEYS });
}

/** Create a key. The response is the only time the full key is ever shown. */
export async function POST(req) {
  const { viewer, error } = await requireViewer();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || 'Default').trim().slice(0, 40) || 'Default';

  const { count } = await db
    .from('mcp_keys').select('id', { count: 'exact', head: true })
    .eq('user_id', viewer.id).eq('kind', 'mcp').is('revoked_at', null);
  if ((count || 0) >= MAX_ACTIVE_KEYS) {
    return NextResponse.json({ error: 'You have ' + MAX_ACTIVE_KEYS + ' keys. Revoke one to make another.' }, { status: 400 });
  }

  const { key, key_hash, prefix } = newKey();
  const { data, error: e } = await db
    .from('mcp_keys').insert({ user_id: viewer.id, name, prefix, key_hash })
    .select(COLUMNS).single();
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });

  return NextResponse.json({ key, record: data }, { status: 201 });
}

export async function DELETE(req) {
  const { viewer, error } = await requireViewer();
  if (error) return error;
  const id = Number(req.nextUrl.searchParams.get('id'));
  await db.from('mcp_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', viewer.id).eq('kind', 'mcp');
  return NextResponse.json({ ok: true });
}
