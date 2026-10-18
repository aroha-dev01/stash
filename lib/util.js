export const now = () => new Date().toISOString();

// Marks where the visible chat answer ends and the machine-readable citation
// list begins, inside the SAME streamed response body. This used to travel
// as an x-stash-sources header instead, which broke once the library grew
// past a couple dozen links: a header carrying every citable id as JSON
// routinely exceeds the ~16KB a proxy or Node will actually deliver, so the
// header silently failed to arrive and every citation rendered as dead text.
// A response body has no such ceiling.
//
// This was first tried with a raw NUL control character as the delimiter, on
// the theory that real prose would never contain one. In practice something
// in the Vercel/CDN path strips or mangles raw control bytes in a text/plain
// stream, so the marker never matched client-side and the raw JSON leaked
// straight into the visible answer. Plain, unmistakable ASCII survives every
// layer, so that's what this is now.
export const STASH_SOURCES_MARKER = '\n<<<STASH:SOURCES>>>\n';

/**
 * Canonical form of a URL, used as the dedupe key.
 * Two links that point at the same thing must produce the same string here,
 * or you end up saving the same tool three times from three apps.
 */
export function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('empty url');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;

  const u = new URL(s);
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';

  // Same post, different hostnames.
  if (u.hostname === 'twitter.com' || u.hostname === 'mobile.twitter.com') u.hostname = 'x.com';

  const junk = /^(utm_|ref$|ref_|fbclid|gclid|mc_cid|mc_eid|igshid|si$|feature$|source$|_branch)/i;
  // `s` and `t` are share-tracking on these hosts but meaningful elsewhere.
  const social = /(^|\.)(x\.com|instagram\.com|reddit\.com)$/i.test(u.hostname);
  const socialJunk = /^(s|t|share_id|rdt|context|correlation_id)$/i;

  for (const k of [...u.searchParams.keys()]) {
    if (junk.test(k) || (social && socialJunk.test(k))) u.searchParams.delete(k);
  }

  // Trailing slash on the path only. Doing this to the whole string misses the
  // case where a query follows, which silently creates duplicates.
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');

  u.searchParams.sort();
  return u.toString();
}

export function faviconFor(url) {
  try {
    return `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`;
  } catch {
    return null;
  }
}

export function absoluteUrl(base, href) {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** fetch with a hard timeout, since a hung request would stall enrichment. */
export async function fetchTimeout(url, opts = {}, ms = 15000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms), redirect: 'follow' });
}

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Models sometimes wrap JSON in prose or fences despite json_object mode. */
export function parseLooseJSON(text) {
  const t = String(text ?? '').trim();
  try {
    return JSON.parse(t);
  } catch {
    /* keep trying */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* keep trying */
    }
  }
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last > first) return JSON.parse(t.slice(first, last + 1));
  throw new Error('Model did not return JSON');
}

// Section signals without the thumbnail URLs, which are for people, not models.
export const lean = (signals) => { const { previews, ...rest } = signals || {}; return rest; };
