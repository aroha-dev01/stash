'use client';

import { createBrowserClient } from '@supabase/ssr';
import { track } from './track';

/**
 * Sends the visitor straight to Google, and back to `next` afterwards.
 *
 * Where to land travels in a short-lived cookie, not in the redirect address.
 * Supabase only returns to an address on its allow-list, and
 * `/auth/callback?next=...` does not match a plain `/auth/callback` entry.
 * When nothing matches it silently falls back to the Site URL, which once sent
 * new members to the wrong deployment.
 *
 * Resolves with an error message, or never (the browser is leaving).
 */
export async function startGoogleSignIn(next = '/explore', from = 'login') {
  const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  document.cookie = 'stash_next=' + encodeURIComponent(next) + '; path=/; max-age=600; samesite=lax';
  track('google_sign_in_started', { from });
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/auth/callback' },
  });
  return error ? error.message : null;
}
