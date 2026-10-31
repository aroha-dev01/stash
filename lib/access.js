import { db } from './supabase.js';
import { getSetting } from './settings.js';
import { TOOLKITS, FALLBACK_TOOLKIT, toolkitFor } from './taxonomy.js';

// Who may open what. One policy for the website, the catalogue API, the detail
// API, saves, the assistant and MCP, so a locked entry cannot be reached by
// asking a different door.
//
//   visitor   signed out              public entries
//   free      signed in, Free plan    public and free entries
//   premium   Pro plan                every tier, every toolkit
//   admin     curator role            everything. A role, not a plan: Pro never
//                                     makes anyone a curator.
//
// An entry's tier is links.access. A toolkit the curator locks to Pro
// (app_settings.catalogue.premium_toolkits) makes every entry in it premium.
//
// Pages use this to decide what to draw; the queries use it to decide what to
// return. Only the second is the security boundary.

export const TIERS = ['public', 'free', 'premium'];

const OPEN = {
  visitor: ['public'],
  free: ['public', 'free'],
  premium: TIERS,
  admin: null, // no filter at all
};

/** `viewer` is getViewer()'s result, or anything with isAdmin / isPro. */
export function levelOf(viewer) {
  if (!viewer) return 'visitor';
  if (viewer.isAdmin) return 'admin';
  if (viewer.isPro) return 'premium';
  return 'free';
}

const validToolkits = (keys) => (Array.isArray(keys) ? keys : []).filter((k) => TOOLKITS.some((t) => t.key === k));

/** The toolkits the curator has locked to Pro, for everyone. */
export async function premiumToolkits() {
  return validToolkits((await getSetting('catalogue')).premium_toolkits);
}

/**
 * The access policy for one viewer. Cheap: one settings read, plus a category
 * scan only when the fallback toolkit is locked (it also owns categories the
 * enrichment model invented, which no list can name in advance).
 */
export async function policyFor(viewer) {
  const level = levelOf(viewer);
  const premium = await premiumToolkits();
  const unlocked = level === 'premium' || level === 'admin';
  const locked = unlocked ? [] : premium;

  let hideCategories = null;
  if (locked.length) {
    const hide = new Set(locked.flatMap((k) => TOOLKITS.find((t) => t.key === k).categories));
    if (locked.includes(FALLBACK_TOOLKIT)) {
      hide.add('');
      const { data } = await db.from('links').select('category');
      for (const r of data || []) if (toolkitFor(r.category) === FALLBACK_TOOLKIT) hide.add(r.category || '');
    }
    hideCategories = [...hide];
  }

  return {
    level,
    signedIn: level !== 'visitor',
    tiers: OPEN[level],
    premiumToolkits: premium, // locked to Pro, whoever is looking
    lockedToolkits: locked, // locked to this viewer
    hideCategories,
  };
}

/** Spread into every search_links call. */
export const rpcAccess = (policy) => ({
  f_access: policy.tiers,
  f_hide_categories: policy.hideCategories,
});

/** The tier an entry effectively has once toolkit locks are applied. */
export function tierOf(row, policy) {
  if (policy.premiumToolkits.includes(toolkitFor(row.category))) return 'premium';
  return TIERS.includes(row.access) ? row.access : 'public';
}

export function canOpen(row, policy) {
  if (policy.level === 'admin') return true;
  return policy.tiers.includes(tierOf(row, policy));
}

/** What it takes to open an entry this viewer cannot: 'sign-in' or 'pro'. */
export function needs(row, policy) {
  if (canOpen(row, policy)) return null;
  return tierOf(row, policy) === 'free' ? 'sign-in' : 'pro';
}

/** What it takes to open a toolkit: null, or 'pro'. */
export const toolkitNeeds = (key, policy) => (policy.lockedToolkits.includes(key) ? 'pro' : null);
