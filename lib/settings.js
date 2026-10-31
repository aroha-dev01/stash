import { db } from './supabase.js';

// Switches the curator flips from /admin. Stored in app_settings so they take
// effect on the next request, without a redeploy.

export const DEFAULTS = {
  ios_shortcut: { enabled: false },
  catalogue: { new_entries_premium: false },
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

/** Whether a newly added entry starts as members only. */
export async function newEntriesPremium() {
  return !!(await getSetting('catalogue')).new_entries_premium;
}
