// Which other pages of a site to audit. Pure functions, no network.
//
// Order of preference: links in the header and navigation (the pages the
// owner thinks matter), then other links on the homepage, then the sitemap.
// Anything that is not a plain public page (files, logins, carts, feeds,
// tag and paging archives) is skipped.

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|zip|rar|mp4|mp3|mov|docx?|xlsx?|pptx?|css|js|json|xml|txt|rss)$/i;
const SKIP_PATH = /\/(wp-admin|wp-login|wp-json|cart|checkout|login|logout|signin|signup|register|account|my-account|feed|tag|tags|author|page\/\d+|cdn-cgi|search)(\/|$)/i;

const bare = (h) => String(h || '').replace(/^www\./i, '').toLowerCase();

/** A comparable page address: no hash, no query, no trailing slash. Null if it is not a page of this site. */
export function pageKey(raw, base) {
  try {
    const u = new URL(raw, base);
    const b = new URL(base);
    if (!/^https?:$/.test(u.protocol) || bare(u.hostname) !== bare(b.hostname)) return null;
    if (SKIP_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) return null;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return u.origin + (path === '/' ? '' : path);
  } catch {
    return null;
  }
}

export const pathOf = (url) => { try { return new URL(url).pathname.replace(/\/+$/, '') || '/'; } catch { return url; } };

/**
 * @param $        the homepage, loaded with cheerio
 * @param base     the homepage's final URL
 * @param sitemap  URLs listed in the sitemap, if any
 * @param max      how many pages in total, homepage included
 */
export function discoverPages($, base, sitemap = [], max = 12) {
  const home = pageKey(base, base) || base;
  const seen = new Set([home]);
  const out = [];
  const add = (raw) => {
    if (out.length >= max - 1) return;
    const k = pageKey(raw, base);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  try {
    $('nav a[href], header a[href], [role="navigation"] a[href]').each((_, el) => add($(el).attr('href')));
    $('main a[href], body a[href]').each((_, el) => add($(el).attr('href')));
  } catch { /* fall through to the sitemap */ }
  for (const u of sitemap || []) add(u);
  return out.map((url) => ({ url, path: pathOf(url), status: 'queued' }));
}
