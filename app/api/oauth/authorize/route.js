import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { consentValid, issueCode, readAuthorizeRequest, redirectWith } from '@/lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Allow and Cancel buttons on /oauth/authorize. Everything is checked
 * again here: the request, the signed-in member, and the consent token that
 * ties this press to the page Stash showed them.
 */
export async function POST(req) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const request = readAuthorizeRequest(Object.fromEntries(form.entries()));
  if (request.fatal) return page(req, form, request.fatal);
  if (request.error) {
    return NextResponse.redirect(redirectWith(request.redirectUri, { error: request.error, error_description: request.description, state: request.state }), 303);
  }

  if (form.get('decision') !== 'allow') {
    return NextResponse.redirect(redirectWith(request.redirectUri, { error: 'access_denied', error_description: 'The member did not allow access.', state: request.state }), 303);
  }

  const user = await currentUser();
  if (!user) return page(req, form, null);
  if (!consentValid(form.get('consent'), user.id, request)) return page(req, form, 'That approval had expired. Check the details and press Allow again.');

  const code = issueCode(user.id, request);
  return NextResponse.redirect(redirectWith(request.redirectUri, { code, state: request.state }), 303);
}

/** Back to the consent page with the same request, and a message if there is one. */
function page(req, form, message) {
  const to = new URL('/oauth/authorize', req.url);
  for (const k of ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']) {
    const v = form.get(k);
    if (v) to.searchParams.set(k, v);
  }
  if (message) to.searchParams.set('notice', message);
  return NextResponse.redirect(to, 303);
}
