import { NextResponse } from 'next/server';
import { authClient, safeNext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Google sends the visitor back here with a one-time code; trade it for a session. */
export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const code = p.get('code');
  const next = safeNext(p.get('next'));

  if (code) {
    const sb = await authClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, req.url));
  }

  const why = p.get('error_description') || 'Sign-in did not complete. Try again.';
  return NextResponse.redirect(new URL('/login?error=' + encodeURIComponent(why), req.url));
}
