import { NextResponse } from 'next/server';
import { authClient } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST only, so a prefetched or embedded link can never sign anyone out.
export async function POST(req) {
  const sb = await authClient();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
