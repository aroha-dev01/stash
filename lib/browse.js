import { db } from './supabase.js';
import { embed } from './embed.js';
import { rpcAccess, canOpen, toolkitNeeds, policyFor, tierOf } from './access.js';
import { publicLink } from './catalog.js';
import { TOOLKITS, FALLBACK_TOOLKIT, toolkitFor } from './taxonomy.js';

// The one catalogue query behind the homepage, Explore and /api/catalog, so
// featured cards, category tiles and search results always agree, and every
// one of them is filtered by the viewer's policy inside the database.

const SORTS = new Set(['newest', 'oldest', 'stars', 'title']);

/** search_links arguments for a toolkit filter, merged with the policy's own hidden categories. */
function toolkitArgs(key, policy) {
  const kit = TOOLKITS.find((t) => t.key === key);
  const hidden = policy.hideCategories;
  if (!kit) return { f_categories: null, f_hide_categories: hidden };
  if (kit.key !== FALLBACK_TOOLKIT) return { f_categories: kit.categories, f_hide_categories: hidden };
  // The fallback toolkit also owns categories no list names, so it is
  // "everything the other toolkits do not claim".
  const others = TOOLKITS.filter((t) => t.key !== FALLBACK_TOOLKIT).flatMap((t) => t.categories);
  return { f_categories: null, f_hide_categories: [...new Set([...(hidden || []), ...others])] };
}

/**
 * One page of the catalogue for this policy.
 *
 * `access` narrows to stored tiers the viewer may already open. `embedding`
 * lets a caller that runs two queries for the same text embed it once.
 * Returns the page, the total, and how many more entries match but sit behind
 * a free account (`hiddenBy.members`) or Premium (`hiddenBy.premium`). Those
 * are counted on the first page of a browse, for visitors and Free only; the
 * count is all that leaves the database about them.
 */
export async function browse(policy, opts = {}) {
  const q = String(opts.q || '').trim().slice(0, 200);
  const limit = Math.min(Math.max(Number(opts.limit) || 24, 1), 48);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  if (opts.toolkit && toolkitNeeds(opts.toolkit, policy)) {
    return { items: [], total: 0, hidden: 0, hiddenBy: null, locked: { toolkit: opts.toolkit, needs: 'pro' } };
  }

  const q_embedding = q ? (opts.embedding !== undefined ? opts.embedding : await embed(q)) : null;
  const access = rpcAccess(policy);
  if (opts.access) access.f_access = (access.f_access || ['public', 'free', 'premium']).filter((t) => t === opts.access);

  const base = {
    q: q || null,
    q_embedding,
    f_type: opts.type || null,
    f_dead: false,
    f_ids: opts.ids || null,
    f_featured: !!opts.featured,
    sort_by: SORTS.has(opts.sort) ? opts.sort : 'newest',
  };

  const { data, error } = await db.rpc('search_links', {
    ...base,
    ...access,
    ...toolkitArgs(opts.toolkit, policy),
    max_rows: limit,
    skip_rows: offset,
  });
  if (error) throw new Error(error.message);

  const rows = data || [];
  const total = rows.length ? Number(rows[0].total_count) : 0;

  // Not for searches: semantic search always fills its top hundred, so the
  // difference between two searches says nothing.
  let hiddenBy = null;
  if (opts.countHidden && !q && offset === 0 && (policy.level === 'visitor' || policy.level === 'free')) {
    const countFor = async (p) => {
      const { data: one } = await db.rpc('search_links', {
        ...base, ...rpcAccess(p), ...toolkitArgs(opts.toolkit, p), max_rows: 1, skip_rows: 0,
      });
      return one?.length ? Number(one[0].total_count) : 0;
    };
    const everyone = { level: 'admin', tiers: null, hideCategories: null, premiumToolkits: [], lockedToolkits: [] };
    const all = await countFor(everyone);
    const members = policy.level === 'visitor' ? await countFor(await policyFor({ isPro: false })) : total;
    hiddenBy = { members: Math.max(0, members - total), premium: Math.max(0, all - members) };
  }

  const hidden = hiddenBy ? hiddenBy.members + hiddenBy.premium : 0;
  return { items: rows.map((r) => publicLink(r, policy)), total, hidden, hiddenBy };
}

/**
 * Counts for the toolkit tiles and the Explore rail. `count` is every live
 * entry in the toolkit; `open` is how many this viewer can open. `levels` is
 * how much each kind of account opens (signed out, Free, Premium), so copy
 * such as "50 free entries" always states what the policy enforces.
 */
export async function overview(policy) {
  const { data, error } = await db.from('links').select('category,type,access').eq('dead', false);
  if (error) throw new Error(error.message);

  const rows = data || [];
  const toolkits = TOOLKITS.map((t) => ({
    key: t.key, label: t.label, blurb: t.blurb, pitch: t.pitch,
    count: 0, open: 0,
    premium: policy.premiumToolkits.includes(t.key),
    needs: toolkitNeeds(t.key, policy),
  }));
  const byKey = new Map(toolkits.map((t) => [t.key, t]));
  const types = {};
  const levels = { visitor: 0, free: 0, premium: rows.length };
  let open = 0;

  for (const r of rows) {
    const t = byKey.get(toolkitFor(r.category));
    t.count += 1;
    const tier = tierOf(r, policy);
    if (tier === 'public') levels.visitor += 1;
    if (tier !== 'premium') levels.free += 1;
    if (canOpen(r, policy)) {
      t.open += 1;
      open += 1;
      if (r.type) types[r.type] = (types[r.type] || 0) + 1;
    }
  }

  return {
    total: rows.length,
    open,
    levels,
    toolkits,
    types: Object.entries(types).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

// The homepage demo runs a real search, as a signed-out visitor would, so it
// only ever shows public entries. Kept for a few minutes per instance: the
// answer changes only when the catalogue does.
const demoCache = new Map();
const DEMO_TTL = 10 * 60 * 1000;

export async function demoSearch(query, limit = 3) {
  const hit = demoCache.get(query);
  if (hit && Date.now() - hit.at < DEMO_TTL) return hit.items;
  const policy = await policyFor(null);
  const { items } = await browse(policy, { q: query, limit });
  demoCache.set(query, { at: Date.now(), items });
  return items;
}
