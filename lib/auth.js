import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { db } from './supabase.js';
import { levelOf } from './access.js';

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

/**
 * Who is looking: null when signed out, otherwise the user with their plan.
 *
 * `plan` is what they pay for (free | pro); `isAdmin` is the curator role and
 * is never implied by a plan. `level` is the access level lib/access.js works
 * from: free, premium (Pro) or admin. Curators get every feature as well.
 */
export async function getViewer() {
  const user = await currentUser();
  if (!user) return null;

  const { data: profile } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  const meta = user.user_metadata || {};
  const isAdmin = !!profile?.is_admin;
  const plan = profile?.plan || 'free';

  const viewer = {
    id: user.id,
    email: user.email,
    name: profile?.name || meta.full_name || meta.name || user.email,
    avatar: profile?.avatar_url || meta.avatar_url || null,
    plan,
    isAdmin,
    isPro: isAdmin || plan === 'pro',
    createdAt: profile?.created_at || user.created_at || null,
  };
  viewer.level = levelOf(viewer);
  return viewer;
}

/** For route handlers: the viewer if signed in, or a 401 response to return. */
export async function requireViewer() {
  const viewer = await getViewer();
  if (!viewer) return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  return { viewer };
}

/** For route handlers that curate the shared catalogue. */
export async function requireAdmin() {
  const viewer = await getViewer();
  if (!viewer) return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  if (!viewer.isAdmin) return { error: NextResponse.json({ error: 'Admins only' }, { status: 403 }) };
  return { viewer };
}

/** Maintenance endpoints: an admin session, or `Authorization: Bearer <STASH_TOKEN>` for scripts. */
export async function requireAdminOrToken(req) {
  const token = process.env.STASH_TOKEN;
  if (token && (req.headers.get('authorization') || '') === 'Bearer ' + token) return {};
  return requireAdmin();
}

/** Where to send someone after sign-in. Only same-site paths, never `//evil.com`. */
export function safeNext(raw) {
  const s = String(raw || '');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : '/';
}
