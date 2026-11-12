import { NextResponse } from 'next/server';
import { authClient } from '@/lib/auth';
import { callerOf, slowDown, waitFor } from '@/lib/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Google's button (app/_ui/GoogleButton.jsx) posts its ID token here, and the
 * server trades it with Supabase for a session, set as this site's cookies.
 *
 * The browser used to make that trade itself, straight to
 * <project>.supabase.co. Some networks cannot reach that domain at all (UAE
 * carriers Etisalat and du blocked *.supabase.co by DNS in 2025, Indian ISPs
 * in 2026), and there sign-in died with nothing in our logs. Now the browser
 * only ever talks to Google and to this site.
 *
 * Supabase checks the token's signature, that it was issued to our client ID,
 * and that the nonce hashes to the one inside it, so a token cannot be
 * replayed or borrowed from another site.
 */
export async function POST(req) {
  let body = null;
  try {
    body = await req.json();
  } catch {}
  const token = typeof body?.credential === 'string' ? body.credential : '';
  const nonce = typeof body?.nonce === 'string' ? body.nonce : '';
  if (!token || !nonce || token.length > 8192 || nonce.length > 256) {
    return NextResponse.json({ error: 'Sign-in did not complete. Try again.' }, { status: 400 });
  }

  // Every sign-in now reaches Supabase from our servers, and Supabase limits
  // its token endpoint per IP address. A per-visitor allowance here keeps one
  // caller from using up that shared allowance for everyone else.
  const wait = await waitFor('signin', callerOf(req));
  if (wait) return slowDown(wait);

  const sb = await authClient();
  const { error } = await sb.auth.signInWithIdToken({ provider: 'google', token, nonce });
  if (error) {
    console.warn('google sign-in refused:', error.message);
    return NextResponse.json({ error: error.message || 'Sign-in did not complete. Try again.' }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
