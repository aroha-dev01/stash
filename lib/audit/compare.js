import { db } from '../supabase.js';

// Before and after: the same site audited twice. Nothing new is stored; the
// earlier audit is simply looked up and the two are set side by side.
//
// A finding is "the same" across audits by its key: technical checks and
// Lighthouse findings have stable keys. Section findings get a new id each
// run, so they are matched by their title instead.

const hostOf = (u) => { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
const idOf = (it) => (it.source === 'section' ? 'section:' + String(it.title || '').toLowerCase() : it.key);
const slim = (it) => ({ key: it.key, title: it.title, category: it.category, severity: it.severity, tier: it.tier });

/** The most recent finished audit of the same site before this one, or null. */
export async function previousAudit(audit) {
  const host = hostOf(audit.url);
  if (!host) return null;
  const { data } = await db
    .from('audits')
    .select('id,url,client,created_at,updated_at,summary,plan,psi')
    .ilike('url', '%' + host + '%')
    .eq('status', 'done')
    .lt('id', audit.id)
    .order('id', { ascending: false })
    .limit(8);
  return (data || []).find((a) => hostOf(a.url) === host) || null;
}

const delta = (from, to) => (from == null || to == null ? null : { from, to, change: to - from });

/** What changed between the earlier audit and this one. */
export function diffAudits(cur, prev) {
  const curItems = (cur.plan?.items || []);
  const prevItems = (prev.plan?.items || []);
  const curIds = new Set(curItems.map(idOf));
  const prevIds = new Set(prevItems.map(idOf));
  const dismissed = (a, it) => a.plan?.feedback?.[it.key]?.verdict === 'down';

  const resolved = prevItems.filter((it) => !curIds.has(idOf(it)) && !dismissed(prev, it)).map(slim);
  const added = curItems.filter((it) => !prevIds.has(idOf(it)) && !dismissed(cur, it)).map(slim);
  const still = curItems.filter((it) => prevIds.has(idOf(it)) && !dismissed(cur, it)).length;

  const scores = {};
  for (const k of ['security', 'privacy', 'seo', 'performance_checks']) {
    const d = delta(prev.summary?.site_scores?.[k], cur.summary?.site_scores?.[k]);
    if (d) scores[k] = d;
  }
  const lighthouse = {};
  for (const k of Object.keys(cur.psi?.scores || {})) {
    const d = delta(prev.psi?.scores?.[k], cur.psi.scores[k]);
    if (d) lighthouse[k] = d;
  }
  return {
    prev_id: prev.id,
    prev_date: prev.updated_at || prev.created_at,
    health: delta(prev.summary?.health, cur.summary?.health),
    scores,
    lighthouse,
    resolved,
    added,
    still,
  };
}
