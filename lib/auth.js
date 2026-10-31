import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Sign-in is Supabase Auth (Google). This client carries the visitor's own
// session from cookies and the publishable key, so it can only ever do what
// that user is allowed to. Privileged work still goes through `db` in
// lib/supabase.js, scoped by the user id this file hands back.

export function authEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set in Vercel, Settings, Environment Variables'
    );
  }
  return { url, key };
}

export async function authClient() {
  const { url, key } = authEnv();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        // Server Components cannot write cookies. That is fine: proxy.js
        // refreshes the session on every request before we get here.
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {}
      },
    },
  });
}

/**
 * The signed-in user, or null.
 *
 * getUser() asks the Auth server rather than trusting the cookie, so a forged
 * or revoked session cannot pass. Use this for every authorization decision.
 */
export async function currentUser() {
  const sb = await authClient();
  const { data } = await sb.auth.getUser();
  return data?.user || null;
}

/** Where to send someone after sign-in. Only same-site paths, never `//evil.com`. */
export function safeNext(raw) {
  const s = String(raw || '');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : '/';
}
