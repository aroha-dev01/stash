import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './supabase.js';
import { KEY_PREFIX, MAX_ACTIVE_KEYS } from './mcpkeys.js';

// OAuth 2.1 for the MCP server, so an agent that only takes a URL (Claude's
// custom connectors, and any client following the MCP auth spec) can send
// its member to Stash to sign in, instead of needing a key pasted into the
// address.
//
//   /.well-known/oauth-protected-resource   which server signs callers in
//   /.well-known/oauth-authorization-server where its endpoints are
//   /api/oauth/register                     dynamic client registration
//   /oauth/authorize                        the member signs in and allows it
//   /api/oauth/token                        the client trades its code for a token
//
// Nothing here needs a table. Client ids, codes and refresh tokens are
// sealed (AES-256-GCM) with a server secret, so the server can read them back
// and nobody else can make or alter one. The access token is an ordinary
// Stash key in mcp_keys, so plans, rate limits, "Connected" on /connect and
// revoking all work exactly as they do for a key made by hand.
//
// A code is good for five minutes and the key it buys is derived from it, so
// trading the same code twice returns the same key rather than a second one.
// PKCE (S256) is required, so a code is useless to anyone without the
// client's verifier.

const CODE_TTL = 5 * 60;
const CONSENT_TTL = 10 * 60;
export const SCOPE = 'stash';

let cachedKey = null;

/** The 32-byte secret everything here is sealed with. */
function secret() {
  if (cachedKey) return cachedKey;
  const own = process.env.MCP_OAUTH_SECRET;
  const base = own || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error('MCP_OAUTH_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set for MCP sign-in');
  cachedKey = Buffer.from(hkdfSync('sha256', base, 'stash', 'mcp-oauth-v1', 32));
  return cachedKey;
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (s) => createHash('sha256').update(s).digest();
const now = () => Math.floor(Date.now() / 1000);

/** Encrypts and signs a small object. `purpose` keeps a code from passing as a client id, and so on. */
export function seal(obj, purpose) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secret(), iv);
  c.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return b64(Buffer.concat([iv, c.getAuthTag(), body]));
}

/** The object, or null when the token is malformed, altered or made for another purpose. */
export function unseal(token, purpose) {
  try {
    const raw = Buffer.from(String(token || ''), 'base64url');
    if (raw.length < 29) return null;
    const d = createDecipheriv('aes-256-gcm', secret(), raw.subarray(0, 12));
    d.setAAD(Buffer.from(purpose));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

function sameString(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ---------------------------------------------------------------- origins */

/** The origin a request came in on, so metadata matches whichever host the client used. */
export function originOf(req) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'stash.aruo.dev';
  const proto = req.headers.get('x-forwarded-proto') || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
  return proto.split(',')[0].trim() + '://' + host.split(',')[0].trim();
}

export function protectedResourceMetadata(origin) {
  return {
    resource: origin + '/api/mcp',
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Stash',
    resource_documentation: origin + '/connect',
  };
}

export function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: origin + '/oauth/authorize',
    token_endpoint: origin + '/api/oauth/token',
    registration_endpoint: origin + '/api/oauth/register',
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    service_documentation: origin + '/connect',
  };
}

/** Lets browser-based MCP clients (the MCP Inspector, for one) read the OAuth endpoints. */
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-max-age': '86400',
};

/* ----------------------------------------------------------------- clients */

const AUTH_METHODS = new Set(['none', 'client_secret_post', 'client_secret_basic']);
const BAD_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'about:', 'blob:', 'ftp:', 'ws:', 'wss:']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether a client may be sent back to this address: https anywhere, http
 * only to this machine (agents that listen on a local port), or an app's
 * own scheme (cursor://, vscode://). Never a fragment.
 */
export function redirectAllowed(uri) {
  let u;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || String(uri).length > 512) return false;
  if (u.protocol === 'https:') return !!u.hostname;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname);
  return !BAD_SCHEMES.has(u.protocol);
}

class OAuthError extends Error {
  constructor(code, description, status = 400) {
    super(description);
    this.code = code;
    this.status = status;
  }
}
export { OAuthError };

/** RFC 7591 registration. The client id carries the registration, sealed. */
export function registerClient(body) {
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10) throw new OAuthError('invalid_redirect_uri', 'Send between one and ten redirect_uris.');
  const bad = uris.find((u) => !redirectAllowed(u));
  if (bad) throw new OAuthError('invalid_redirect_uri', 'Stash cannot send members back to ' + bad.slice(0, 100));

  const method = body?.token_endpoint_auth_method || 'none';
  if (!AUTH_METHODS.has(method)) {
    throw new OAuthError('invalid_client_metadata', 'token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.');
  }
  const name = String(body?.client_name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || null;
  const issued = now();

  const client_id = seal({ r: uris, n: name, m: method, t: issued }, 'client');
  const out = {
    client_id,
    client_id_issued_at: issued,
    client_name: name || undefined,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
  };
  if (method !== 'none') {
    out.client_secret = clientSecret(client_id);
    out.client_secret_expires_at = 0;
  }
  return out;
}

function clientSecret(clientId) {
  return b64(createHmac('sha256', secret()).update('client-secret:' + clientId).digest());
}

/** The registration behind a client id, or null. */
export function clientOf(clientId) {
  const c = unseal(clientId, 'client');
  if (!c || !Array.isArray(c.r)) return null;
  return { id: clientId, redirectUris: c.r, name: c.n || null, authMethod: c.m || 'none' };
}

/**
 * The registered address the member goes back to. A client that listens on
 * this machine may pick a different port each run (RFC 8252), so for
 * loopback addresses only the port may differ.
 */
export function matchRedirect(client, given) {
  if (!given) return client.redirectUris.length === 1 ? client.redirectUris[0] : null;
  if (client.redirectUris.includes(given)) return given;
  let g;
  try { g = new URL(given); } catch { return null; }
  if (g.protocol !== 'http:' || !LOOPBACK.has(g.hostname)) return null;
  const hit = client.redirectUris.find((r) => {
    try {
      const u = new URL(r);
      return u.protocol === g.protocol && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search;
    } catch {
      return false;
    }
  });
  return hit ? given : null;
}

/** A short name for where the member is sent back, for the consent screen. */
export function redirectHost(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : u.protocol.replace(/:$/, '') + ' app';
  } catch {
    return 'the app';
  }
}

/* --------------------------------------------------------------- authorize */

/**
 * Checks an authorization request. Problems with the client or its address
 * are shown on Stash's own page (`fatal`); anything else goes back to the
 * client as an OAuth error, as the spec says.
 */
export function readAuthorizeRequest(p) {
  const get = (k) => (typeof p.get === 'function' ? p.get(k) : p[k]) ?? null;
  const client = clientOf(get('client_id'));
  if (!client) return { fatal: 'This app is not registered with Stash. Start the connection again from the app.' };
  const redirectUri = matchRedirect(client, get('redirect_uri'));
  if (!redirectUri) return { fatal: 'This app asked Stash to send you to an address it did not register. Start the connection again from the app.' };

  const state = get('state');
  const back = (error, description) => ({ client, redirectUri, state, error, description });

  if (get('response_type') !== 'code') return back('unsupported_response_type', 'Stash only issues authorization codes.');
  const challenge = get('code_challenge');
  if (!challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return back('invalid_request', 'A PKCE code_challenge is required.');
  if ((get('code_challenge_method') || 'plain') !== 'S256') return back('invalid_request', 'code_challenge_method must be S256.');

  return {
    client,
    redirectUri,
    state,
    challenge,
    scope: get('scope') || SCOPE,
    resource: get('resource') || null,
  };
}

/** Where the client hears back, with an OAuth error or a code. */
export function redirectWith(redirectUri, params) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  return u.toString();
}

const fingerprint = (r) => b64(sha256([r.client.id, r.redirectUri, r.challenge, r.state || '', r.scope].join('\n'))).slice(0, 22);

/** Ties the Allow button to this member and this exact request, so another site cannot press it for them. */
export function consentToken(userId, request) {
  return seal({ u: userId, f: fingerprint(request), e: now() + CONSENT_TTL }, 'consent');
}

export function consentValid(token, userId, request) {
  const c = unseal(token, 'consent');
  return !!c && c.u === userId && c.f === fingerprint(request) && c.e > now();
}

export function issueCode(userId, request) {
  return seal(
    {
      u: userId,
      c: b64(sha256(request.client.id)),
      r: request.redirectUri,
      ch: request.challenge,
      s: request.scope,
      n: b64(randomBytes(18)),
      e: now() + CODE_TTL,
    },
    'code'
  );
}

/* ------------------------------------------------------------------- token */

/** The client calling the token endpoint, with its secret checked when it registered with one. */
export function authenticateClient(req, form) {
  let id = form.get('client_id');
  let given = form.get('client_secret');
  const header = req.headers.get('authorization') || '';
  if (/^basic /i.test(header)) {
    try {
      const raw = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
      const at = raw.indexOf(':');
      if (at > 0) {
        id = decodeURIComponent(raw.slice(0, at));
        given = decodeURIComponent(raw.slice(at + 1));
      }
    } catch {}
  }
  const client = clientOf(id);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client. Register again.', 401);
  if (client.authMethod !== 'none' && !sameString(given, clientSecret(client.id))) {
    throw new OAuthError('invalid_client', 'The client secret is wrong.', 401);
  }
  return client;
}

/** The Stash key a grant buys. Derived, so the same grant always yields the same key. */
function keyFor(nonce) {
  return KEY_PREFIX + b64(createHmac('sha256', secret()).update('mcp-key:' + nonce).digest().subarray(0, 24));
}

const keyHash = (key) => createHash('sha256').update(key).digest('hex');

/** Records the key for this member, or finds it when this grant was already traded. */
async function ensureKey(userId, nonce, clientName) {
  const key = keyFor(nonce);
  const hash = keyHash(key);

  const { data: existing } = await db.from('mcp_keys').select('id,user_id,revoked_at').eq('key_hash', hash).maybeSingle();
  if (existing) {
    if (existing.user_id !== userId || existing.revoked_at) throw new OAuthError('invalid_grant', 'This connection was revoked. Connect again.');
    return key;
  }

  const { count } = await db
    .from('mcp_keys').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('kind', 'mcp').is('revoked_at', null);
  if ((count || 0) >= MAX_ACTIVE_KEYS) {
    throw new OAuthError('invalid_grant', 'This Stash account already has ' + MAX_ACTIVE_KEYS + ' keys. Revoke one on /connect, then connect again.');
  }

  const name = (clientName || 'MCP client').slice(0, 40);
  const { error } = await db.from('mcp_keys').insert({
    user_id: userId, name, prefix: key.slice(0, KEY_PREFIX.length + 6), key_hash: hash, kind: 'mcp',
  });
  // Two requests trading the same code at once: the other one recorded it.
  if (error && error.code !== '23505') throw new OAuthError('server_error', 'The key was not saved. Try again.', 500);
  return key;
}

function tokenResponse(key, refresh, scope) {
  return { access_token: key, token_type: 'Bearer', refresh_token: refresh, scope: scope || SCOPE };
}

/** authorization_code: checks the code, the address, the client and the PKCE verifier. */
export async function exchangeCode(client, form) {
  const code = unseal(form.get('code'), 'code');
  if (!code || code.e < now()) throw new OAuthError('invalid_grant', 'The code is invalid or has expired. Connect again.');
  if (code.c !== b64(sha256(client.id))) throw new OAuthError('invalid_grant', 'The code was issued to another client.');
  if (form.get('redirect_uri') && form.get('redirect_uri') !== code.r) throw new OAuthError('invalid_grant', 'redirect_uri does not match.');

  const verifier = form.get('code_verifier') || '';
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !sameString(b64(sha256(verifier)), code.ch)) {
    throw new OAuthError('invalid_grant', 'The PKCE code_verifier does not match.');
  }

  const key = await ensureKey(code.u, code.n, client.name);
  return tokenResponse(key, seal({ u: code.u, c: code.c, n: code.n, s: code.s }, 'refresh'), code.s);
}

/** refresh_token: hands back the same key while it is live. Keys do not expire, so this is rarely needed. */
export async function refresh(client, form) {
  const r = unseal(form.get('refresh_token'), 'refresh');
  if (!r || r.c !== b64(sha256(client.id))) throw new OAuthError('invalid_grant', 'The refresh token is invalid.');
  const key = keyFor(r.n);
  const { data } = await db.from('mcp_keys').select('user_id,revoked_at').eq('key_hash', keyHash(key)).maybeSingle();
  if (!data || data.user_id !== r.u || data.revoked_at) throw new OAuthError('invalid_grant', 'This connection was revoked. Connect again.');
  return tokenResponse(key, form.get('refresh_token'), r.s);
}

/** How many live keys a member has, for the consent screen. */
export async function liveKeyCount(userId) {
  const { count } = await db
    .from('mcp_keys').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('kind', 'mcp').is('revoked_at', null);
  return count || 0;
}
