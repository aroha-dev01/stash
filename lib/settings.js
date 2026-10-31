import { db } from './supabase.js';

// Switches the curator flips from /admin. Stored in app_settings so they take
// effect on the next request, without a redeploy.

export const DEFAULTS = {
  ios_shortcut: { enabled: false },
  // new_entries_access: the tier a newly added entry starts in.
  // premium_toolkits: toolkit keys (lib/taxonomy.js) locked to Pro.
  catalogue: { new_entries_access: 'public', premium_toolkits: [] },
};

/** One setting, merged over its default. Never throws: a read failure means the default. */
export async function getSetting(key) {
  const { data } = await db.from('app_settings').select('value').eq('key', key).maybeSingle().then((r) => r, () => ({}));
  return { ...(DEFAULTS[key] || {}), ...(data?.value || {}) };
}

/** Merges `patch` into the stored value and returns the result. */
export async function setSetting(key, patch) {
  const next = { ...(await getSetting(key)), ...patch };
  const { error } = await db
    .from('app_settings')
    .upsert({ key, value: next, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return next;
}

/**
 * The columns a newly added entry starts with. is_premium is written too, for
 * the deployment that still reads it, until that column is dropped.
 */
export async function newEntryAccess() {
  const tier = (await getSetting('catalogue')).new_entries_access;
  const access = ['public', 'free', 'premium'].includes(tier) ? tier : 'public';
  return { access, is_premium: access !== 'public' };
}
