import { NextResponse } from 'next/server';
import { CORS, originOf, protectedResourceMetadata } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

// RFC 9728. An MCP client that gets a 401 from /api/mcp reads this to learn
// where members sign in. Served at the root and at /api/mcp, the two places
// clients look.
export function GET(req) {
  return NextResponse.json(protectedResourceMetadata(originOf(req)), { headers: { ...CORS, 'cache-control': 'no-store' } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
