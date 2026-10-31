import { NextResponse } from 'next/server';
import { track } from '@vercel/analytics/server';
import { authClient, safeNext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Google sends the visitor back here with a one-time code; trade it for a session. */
export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const code = p.get('code');
  // Set by the sign-in page; ?next= is still honoured for older links.
  const next = safeNext(req.cookies.get('stash_next')?.value || p.get('next') || '/explore');

  let res;
  if (code) {
    const sb = await authClient();
    const { data, error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      // A brand-new member lands on a short welcome rather than a blank page.
      const created = Date.parse(data?.user?.created_at || '');
      const isNew = Date.now() - created < 10 * 60 * 1000;
      const to = new URL(next, req.url);
      if (isNew) to.searchParams.set('welcome', '1');
      await track('google_sign_in_completed', { new_member: isNew }, { request: req }).catch(() => {});
      res = NextResponse.redirect(to);
    }
  }
  if (!res) {
    const why = p.get('error_description') || 'Sign-in did not complete. Try again.';
    res = NextResponse.redirect(new URL('/login?error=' + encodeURIComponent(why), req.url));
  }
  res.cookies.delete('stash_next');
  return res;
}
