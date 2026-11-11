import { NextResponse } from 'next/server';
import { CORS, originOf, authorizationServerMetadata } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

// RFC 8414: where to register, sign in and trade codes for tokens.
export function GET(req) {
  return NextResponse.json(authorizationServerMetadata(originOf(req)), { headers: { ...CORS, 'cache-control': 'no-store' } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
