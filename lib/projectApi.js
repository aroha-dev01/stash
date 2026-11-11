import { NextResponse } from 'next/server';
import { requireViewer } from './auth.js';
import { policyFor } from './access.js';
import { guard } from './guard.js';
import { PRO } from './plans.js';
import { ProjectError } from './projects.js';

// The door every /api/projects route goes through:
//
//   1. a signed-in member (lib/auth.js asks the Auth server, never the cookie alone)
//   2. for writes, a same-site request: the Origin and Fetch Metadata headers a
//      browser always sends must say it came from this site, and the body must
//      be JSON. A form on another site cannot meet either.
//   3. Premium: projects are a Premium feature, and the data of a member who
//      has left Premium is kept, but not served, until they come back
//   4. the bot check and the per-account pace (lib/guard.js)

const json = (body, status = 200) => NextResponse.json(body, { status });

function sameSite(req) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function premiumMember(req, { write = false } = {}) {
  const { viewer, error } = await requireViewer();
  if (error) return { error };
  if (write) {
    if (!sameSite(req)) return { error: json({ error: 'Requests must come from Stash itself.' }, 403) };
    const type = req.headers.get('content-type') || '';
    if (req.method !== 'DELETE' && !type.toLowerCase().startsWith('application/json')) {
      return { error: json({ error: 'Send JSON.' }, 415) };
    }
  }
  if (!viewer.isPro) {
    return { error: json({ error: 'Projects are part of ' + PRO.name + '.', upgrade: '/upgrade' }, 403) };
  }
  const stop = await guard(req, 'projects', viewer);
  if (stop) return { error: stop };
  return { viewer };
}

export const policyOf = (viewer) => policyFor(viewer);

/** The JSON body, or {} when there is none or it is not an object. */
export async function body(req) {
  const b = await req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}

export function failed(e) {
  if (e instanceof ProjectError) return json({ error: e.message }, e.status);
  console.error('projects api:', e);
  return json({ error: 'Something went wrong. Try again.' }, 500);
}

export { json };
