import { createHash, randomBytes } from 'node:crypto';
import { db } from './supabase.js';

// Per-user keys. The full key is shown once, at creation; only its SHA-256 is
// stored, so a database leak does not hand out working keys.
//
// Two kinds, kept apart by prefix and by the `kind` column:
//   mcp       connects an agent to /api/mcp
//   shortcut  lets the iOS share sheet save links through /api/save

export const KEY_PREFIX = 'sk_stash_';
export const SHORTCUT_PREFIX = 'ios_stash_';
export const MAX_ACTIVE_KEYS = 5;

const PREFIX = { mcp: KEY_PREFIX, shortcut: SHORTCUT_PREFIX };

const hash = (key) => createHash('sha256').update(key).digest('hex');

export function newKey(kind = 'mcp') {
  const p = PREFIX[kind];
  const key = p + randomBytes(24).toString('base64url');
  return { key, key_hash: hash(key), prefix: key.slice(0, p.length + 6), kind };
}

/** The member behind a key of this kind, or null. Records when the key was last used. */
export async function resolveKey(key, kind = 'mcp') {
  if (!key || !key.startsWith(PREFIX[kind])) return null;

  const { data: row } = await db
    .from('mcp_keys')
    .select('id,user_id,revoked_at,profiles(plan,is_admin,email)')
    .eq('key_hash', hash(key))
    .eq('kind', kind)
    .maybeSingle();
  if (!row || row.revoked_at) return null;

  // Best effort; a failed timestamp must never fail the request.
  db.from('mcp_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(() => {}, () => {});

  const p = row.profiles || {};
  const isAdmin = !!p.is_admin;
  return { keyId: row.id, userId: row.user_id, email: p.email, isAdmin, isPro: isAdmin || p.plan === 'pro' };
}

/** Records which app connected with a key, from the clientInfo it sent on initialize. */
export function noteClient(keyId, clientInfo) {
  const name = String(clientInfo?.name || '').trim().slice(0, 60);
  if (!keyId || !name) return;
  db.from('mcp_keys').update({ last_client: name }).eq('id', keyId).then(() => {}, () => {});
}

/**
 * Whether a member's agent is connected. "Connected" means the MCP server has
 * actually answered a call made with one of their live keys, never that they
 * copied a config.
 */
export async function connectionOf(userId) {
  const { data } = await db
    .from('mcp_keys')
    .select('id,name,last_used_at,last_client')
    .eq('user_id', userId).eq('kind', 'mcp').is('revoked_at', null)
    .order('last_used_at', { ascending: false, nullsFirst: false });
  const keys = data || [];
  const used = keys.find((k) => k.last_used_at) || null;
  return {
    keys: keys.length,
    connected: !!used,
    lastUsedAt: used?.last_used_at || null,
    lastClient: used?.last_client || null,
    keyName: used?.name || null,
  };
}
