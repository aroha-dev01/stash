import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { llmStatus } from '@/lib/llm';
import { requireAdmin } from '@/lib/auth';
import { newKey, MAX_ACTIVE_KEYS } from '@/lib/mcpkeys';
import { getSetting, setSetting } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLUMNS = 'id,name,prefix,created_at,last_used_at';

/**
 * Everything that decides whether the iOS share sheet works, checked live:
 * the switch, a key, whether the phone has been heard from, and what the last
 * shared link turned into.
 */
async function status(viewer) {
  const [setting, { data: keys }, { data: recent }] = await Promise.all([
    getSetting('ios_shortcut'),
    db.from('mcp_keys').select(COLUMNS)
      .eq('user_id', viewer.id).eq('kind', 'shortcut').is('revoked_at', null)
      .order('created_at', { ascending: false }),
    db.from('links').select('id,title,domain,status,error,category,created_at')
      .eq('source', 'share-sheet')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const active = keys || [];
  const heard = active.map((k) => k.last_used_at).filter(Boolean).sort().pop() || null;

  return {
    enabled: setting.enabled,
    keys: active,
    max: MAX_ACTIVE_KEYS,
    heard,
    recent: recent || [],
    ai: llmStatus().enabled,
    tokenFallback: !!process.env.STASH_TOKEN,
  };
}

export async function GET() {
  const { viewer, error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json(await status(viewer));
}

/** Turn the share sheet on or off for every shortcut key at once. */
export async function PATCH(req) {
  const { viewer, error } = await requireAdmin();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Send enabled: true or false' }, { status: 400 });
  await setSetting('ios_shortcut', { enabled: body.enabled });
  return NextResponse.json(await status(viewer));
}

/** Make a shortcut key. The response is the only time the full key is shown. */
export async function POST(req) {
  const { viewer, error } = await requireAdmin();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || 'iPhone').trim().slice(0, 40) || 'iPhone';

  const { count } = await db.from('mcp_keys').select('id', { count: 'exact', head: true })
    .eq('user_id', viewer.id).eq('kind', 'shortcut').is('revoked_at', null);
  if ((count || 0) >= MAX_ACTIVE_KEYS) {
    return NextResponse.json({ error: 'You have ' + MAX_ACTIVE_KEYS + ' shortcut keys. Revoke one to make another.' }, { status: 400 });
  }

  const { key, key_hash, prefix, kind } = newKey('shortcut');
  const { data, error: e } = await db.from('mcp_keys')
    .insert({ user_id: viewer.id, name, prefix, key_hash, kind })
    .select(COLUMNS).single();
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });

  return NextResponse.json({ key, record: data, status: await status(viewer) }, { status: 201 });
}

export async function DELETE(req) {
  const { viewer, error } = await requireAdmin();
  if (error) return error;
  const id = Number(req.nextUrl.searchParams.get('id'));
  await db.from('mcp_keys').update({ revoked_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', viewer.id).eq('kind', 'shortcut');
  return NextResponse.json(await status(viewer));
}
