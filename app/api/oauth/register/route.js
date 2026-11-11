import { NextResponse } from 'next/server';
import { CORS, OAuthError, registerClient } from '@/lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Dynamic client registration (RFC 7591). Claude and other MCP clients register themselves here. */
export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: 'Send the registration as JSON.' }, { status: 400, headers: CORS });
  }
  try {
    return NextResponse.json(registerClient(body), { status: 201, headers: CORS });
  } catch (e) {
    if (e instanceof OAuthError) {
      return NextResponse.json({ error: e.code, error_description: e.message }, { status: e.status, headers: CORS });
    }
    throw e;
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
