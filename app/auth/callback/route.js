import { NextResponse } from 'next/server';
import { track } from '@vercel/analytics/server';
import { authClient, safeNext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where every Google sign-in finishes. The redirect sign-in arrives with a
 * one-time code to trade for a session. Google's button (GoogleButton.jsx)
 * has already set the session in the browser and arrives with ?via=google.
 */
export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const code = p.get('code');
  // Set by the sign-in page; ?next= is still honoured for older links.
  const next = safeNext(req.cookies.get('stash_next')?.value || p.get('next') || '/explore');

  let user = null;
  const sb = await authClient();
  if (code) {
    const { data, error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) user = data?.user;
  } else if (p.get('via') === 'google') {
    const { data } = await sb.auth.getUser();
    user = data?.user || null;
  }

  let res;
  if (user) {
    // A brand-new member lands on a short welcome rather than a blank page.
    const isNew = Date.now() - Date.parse(user.created_at || '') < 10 * 60 * 1000;
    const to = new URL(next, req.url);
    if (isNew) to.searchParams.set('welcome', '1');
    await track('google_sign_in_completed', { new_member: isNew }, { request: req }).catch(() => {});
    res = NextResponse.redirect(to);
  }
  if (!res) {
    const why = p.get('error_description') || 'Sign-in did not complete. Try again.';
    res = NextResponse.redirect(new URL('/login?error=' + encodeURIComponent(why), req.url));
  }
  res.cookies.delete('stash_next');
  return res;
}
