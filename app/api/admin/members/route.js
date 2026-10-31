import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everyone who has signed in, newest first, with their keys and saves counted. */
export async function GET() {
  const { error: denied } = await requireAdmin();
  if (denied) return denied;

  const [{ data: people, error }, { data: keys }, { data: saves }] = await Promise.all([
    db.from('profiles').select('id,email,name,avatar_url,plan,is_admin,created_at').order('created_at', { ascending: false }),
    db.from('mcp_keys').select('user_id,last_used_at').eq('kind', 'mcp').is('revoked_at', null),
    db.from('saves').select('user_id'),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tally = (rows) => (rows || []).reduce((m, r) => m.set(r.user_id, (m.get(r.user_id) || 0) + 1), new Map());
  const keyCount = tally(keys);
  const saveCount = tally(saves);
  const lastAgent = new Map();
  (keys || []).forEach((k) => {
    if (k.last_used_at && (!lastAgent.get(k.user_id) || k.last_used_at > lastAgent.get(k.user_id))) lastAgent.set(k.user_id, k.last_used_at);
  });

  return NextResponse.json({
    members: (people || []).map((p) => ({
      ...p,
      keys: keyCount.get(p.id) || 0,
      saves: saveCount.get(p.id) || 0,
      agent_last_used: lastAgent.get(p.id) || null,
    })),
  });
}

/** Change a member's plan or curator role. Until payments exist, this is how Pro is granted. */
export async function PATCH(req) {
  const { viewer, error: denied } = await requireAdmin();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'Which member?' }, { status: 400 });

  const patch = {};
  if (body.plan === 'free' || body.plan === 'pro') patch.plan = body.plan;
  if (typeof body.is_admin === 'boolean') {
    // Removing yourself could leave the catalogue with no curator at all.
    if (body.id === viewer.id && !body.is_admin) {
      return NextResponse.json({ error: 'You cannot remove your own curator role.' }, { status: 400 });
    }
    patch.is_admin = body.is_admin;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  const { data, error } = await db.from('profiles').update(patch).eq('id', body.id)
    .select('id,email,name,avatar_url,plan,is_admin,created_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ member: data });
}
