import { NextResponse } from 'next/server';
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
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) res = NextResponse.redirect(new URL(next, req.url));
  }
  if (!res) {
    const why = p.get('error_description') || 'Sign-in did not complete. Try again.';
    res = NextResponse.redirect(new URL('/login?error=' + encodeURIComponent(why), req.url));
  }
  res.cookies.delete('stash_next');
  return res;
}
