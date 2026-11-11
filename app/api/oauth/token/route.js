import { NextResponse } from 'next/server';
import { CORS, OAuthError, authenticateClient, exchangeCode, refresh } from '@/lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Accepts the standard form encoding, and JSON from clients that send that instead. */
async function readForm(req) {
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const j = await req.json().catch(() => ({}));
    return new URLSearchParams(Object.entries(j || {}).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await req.text().catch(() => ''));
}

/** The token endpoint: an authorization code (or refresh token) in, a Stash key out. */
export async function POST(req) {
  const form = await readForm(req);
  try {
    const client = authenticateClient(req, form);
    const grant = form.get('grant_type');
    let body;
    if (grant === 'authorization_code') body = await exchangeCode(client, form);
    else if (grant === 'refresh_token') body = await refresh(client, form);
    else throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
    return NextResponse.json(body, { headers: { ...CORS, pragma: 'no-cache' } });
  } catch (e) {
    if (!(e instanceof OAuthError)) throw e;
    const headers = { ...CORS };
    if (e.status === 401) headers['www-authenticate'] = 'Basic realm="stash"';
    return NextResponse.json({ error: e.code, error_description: e.message }, { status: e.status, headers });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
