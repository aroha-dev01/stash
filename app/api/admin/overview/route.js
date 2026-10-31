import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { embed } from '@/lib/embed';
import { llmStatus } from '@/lib/llm';
import { requireAdmin } from '@/lib/auth';
import { getSetting } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const count = async (q) => {
  const { count: n, error } = await q;
  return error ? null : n || 0;
};

// Which environment variables are set. Names and yes/no only, never values.
const ENV = [
  ['SUPABASE_URL', 'Database address', true],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Database server key', true],
  ['NEXT_PUBLIC_SUPABASE_URL', 'Sign-in address', true],
  ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'Sign-in public key', true],
  ['DEEPSEEK_API_KEY', 'AI summaries, assistant and Pro tools', false],
  ['DEEPSEEK_MODEL', 'AI model name (defaults to deepseek-chat)', false],
  ['GITHUB_TOKEN', 'Higher GitHub limits for repo stats', false],
  ['CRON_SECRET', 'Signs the nightly link check', false],
  ['STASH_TOKEN', 'Owner token for scripts', false],
];

/** Everything the console's first screen needs, in one request. */
export async function GET() {
  const { error: denied } = await requireAdmin();
  if (denied) return denied;

  const started = Date.now();
  const { data: facets, error: dbError } = await db.rpc('stash_facets');
  const dbMs = Date.now() - started;

  const [members, pro, curators, premium, agentKeys, attention, shortcut, shortcutKeys, vec] = await Promise.all([
    count(db.from('profiles').select('id', { count: 'exact', head: true })),
    count(db.from('profiles').select('id', { count: 'exact', head: true }).eq('plan', 'pro')),
    count(db.from('profiles').select('id', { count: 'exact', head: true }).eq('is_admin', true)),
    count(db.from('links').select('id', { count: 'exact', head: true }).neq('access', 'public')),
    count(db.from('mcp_keys').select('id', { count: 'exact', head: true }).eq('kind', 'mcp').is('revoked_at', null)),
    db.from('links')
      .select('id,title,domain,status,dead,dead_reason,error,created_at')
      .or('status.eq.error,status.eq.pending,status.eq.enriching,dead.eq.true')
      .order('created_at', { ascending: false })
      .limit(8)
      .then((r) => r.data || [], () => []),
    getSetting('ios_shortcut'),
    db.from('mcp_keys').select('last_used_at').eq('kind', 'shortcut').is('revoked_at', null)
      .then((r) => r.data || [], () => []),
    // A real round trip to the embed function, so "on" means it answered.
    embed('health check').catch(() => null),
  ]);

  const llm = llmStatus();
  const stats = facets?.stats || {};
  const heard = shortcutKeys.map((k) => k.last_used_at).filter(Boolean).sort().pop() || null;

  return NextResponse.json({
    stats: {
      entries: stats.total ?? null,
      premium,
      oss: stats.oss ?? null,
      members,
      pro,
      curators,
      agentKeys,
      errored: stats.errored ?? 0,
      working: stats.working ?? 0,
      dead: stats.dead ?? 0,
    },
    health: {
      database: dbError ? { ok: false, detail: dbError.message } : { ok: true, detail: 'Answered in ' + dbMs + ' ms' },
      ai: llm.enabled ? { ok: true, detail: llm.model } : { ok: false, detail: 'DEEPSEEK_API_KEY is not set' },
      semantic: vec ? { ok: true, detail: 'gte-small embeddings' } : { ok: false, detail: 'The embed function did not answer' },
      signin: {
        ok: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
        detail: 'Google',
      },
      shortcut: {
        ok: shortcut.enabled && shortcutKeys.length > 0,
        enabled: shortcut.enabled,
        keys: shortcutKeys.length,
        heard,
      },
    },
    env: ENV.map(([name, what, required]) => ({ name, what, required, set: !!process.env[name] })),
    attention,
  });
}
