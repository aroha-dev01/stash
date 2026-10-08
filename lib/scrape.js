import * as cheerio from 'cheerio';
import { fetchTimeout, absoluteUrl, faviconFor, USER_AGENT } from './util.js';

// Timeouts are deliberately tight. Enrichment runs inside a Vercel function
// with a 60s ceiling, and it may make three network calls in sequence, so no
// single step is allowed to eat the whole budget.

export async function scrapeMeta(url) {
  const out = { title: null, description: null, image: null, favicon: null, site_name: null, text: '' };

  let res;
  try {
    res = await fetchTimeout(
      url,
      { headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' } },
      9000
    );
  } catch (e) {
    throw new Error(
      `Could not reach the page (${e.name === 'TimeoutError' ? 'timed out' : e.message})`
    );
  }
  if (!res.ok) throw new Error(`Page returned ${res.status}`);

  const type = res.headers.get('content-type') || '';
  if (!type.includes('html')) {
    out.title = decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
    out.favicon = faviconFor(url);
    return out;
  }

  const html = (await res.text()).slice(0, 800_000);
  const $ = cheerio.load(html);
  const meta = (sel) => $(sel).attr('content')?.trim() || null;

  out.title =
    meta('meta[property="og:title"]') ||
    meta('meta[name="twitter:title"]') ||
    $('title').first().text().trim() ||
    null;

  out.description =
    meta('meta[property="og:description"]') ||
    meta('meta[name="twitter:description"]') ||
    meta('meta[name="description"]') ||
    null;

  out.image = absoluteUrl(url, meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'));
  out.site_name = meta('meta[property="og:site_name"]');

  const icon =
    $('link[rel="icon"]').attr('href') ||
    $('link[rel="shortcut icon"]').attr('href') ||
    $('link[rel="apple-touch-icon"]').attr('href');
  out.favicon = absoluteUrl(url, icon) || faviconFor(url);

  // Not every page bothers with og:image — plenty of design-gallery and repo
  // pages just don't set one, which left them showing no preview at all.
  // Falling back to the first substantial content image means a reference
  // link (a gallery, a component showcase) still shows something of what it
  // actually looks like, which is the point of saving it in the first place.
  if (!out.image) {
    out.image = absoluteUrl(url, firstContentImage($));
  }

  // Body text rescues pages whose meta tags are thin marketing copy.
  $('script, style, noscript, svg, nav, footer, header').remove();
  out.text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);

  return out;
}

/**
 * Best-effort guess at "the picture that shows what this actually is",
 * skipping icons, logos, tracking pixels, and inline data URIs that are
 * clearly decoration rather than content. Deliberately picks the FIRST
 * plausible candidate rather than the largest — the first content image on a
 * page is usually the hero/example shot, and fetching real dimensions for
 * every candidate would mean a network round trip per image, which is not
 * worth it for a fallback.
 */
function firstContentImage($) {
  const skip = /(logo|icon|favicon|sprite|avatar|badge|pixel|tracking|spinner|loader)/i;
  let found = null;
  $('img').each((_, el) => {
    if (found) return;
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (!src || src.startsWith('data:')) return;
    if (skip.test(src)) return;
    const w = Number($(el).attr('width')) || 0;
    const h = Number($(el).attr('height')) || 0;
    if ((w && w < 120) || (h && h < 120)) return;
    found = src;
  });
  return found;
}

/* ---------------------------------------------------------------- github */

/**
 * A fifth of this library arrived as tweets ABOUT a tool rather than the tool
 * itself, which is how the same thing ended up saved twice — once as a post,
 * once as a repo. This pulls the product link out of the post so the entry can
 * point at the real thing, with the tweet kept as provenance.
 *
 * Deliberately conservative. A tweet contains many links, most of them noise:
 * other profiles, hashtags, image attachments, and t.co wrappers that reveal
 * nothing until followed. Getting this wrong would file a link under the wrong
 * tool, which is worse than leaving it as a tweet. When unsure, it returns null.
 */
export async function resolveSocialLink(url, pageText, description) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (!/^(x\.com|twitter\.com|mobile\.twitter\.com)$/.test(host)) return null;

  const haystack = [description || '', pageText || ''].join(' ');
  const found = haystack.match(/https?:\/\/[^\s"'<>)\]]+/g) || [];

  const ignore =
    /(^|\.)(x\.com|twitter\.com|pbs\.twimg\.com|abs\.twimg\.com|t\.co|instagram\.com|facebook\.com|youtube\.com|linkedin\.com|google\.com|bit\.ly)$/i;

  const candidates = [];
  for (const raw of found.slice(0, 25)) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }

    // t.co hides the destination, so follow it rather than guess.
    if (/(^|\.)t\.co$/i.test(u.hostname)) {
      try {
        const res = await fetchTimeout(raw, { method: 'HEAD', headers: { 'user-agent': USER_AGENT } }, 5000);
        if (res.url && !ignore.test(new URL(res.url).hostname)) candidates.push(res.url);
      } catch {
        // unresolvable; skip
      }
      continue;
    }

    if (!ignore.test(u.hostname)) candidates.push(u.toString());
  }

  if (!candidates.length) return null;

  // A GitHub repo is the least ambiguous thing a tweet can point at, so it
  // wins outright when present.
  const repo = candidates.find((c) => /(^|\.)github\.com\//i.test(c) && parseRepo(c));
  if (repo) return repo;

  // Otherwise only accept a clear winner: one distinct destination. Several
  // different domains means a roundup post, and picking one would be a guess.
  const hosts = new Set(candidates.map((c) => new URL(c).hostname.replace(/^www\./, '')));
  return hosts.size === 1 ? candidates[0] : null;
}

function parseRepo(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)github\.com$/.test(u.hostname)) return null;
    const [owner, name] = u.pathname.split('/').filter(Boolean);
    if (!owner || !name) return null;
    const reserved = new Set([
      'features', 'topics', 'trending', 'orgs', 'sponsors', 'collections',
      'marketplace', 'settings', 'explore', 'about', 'pricing', 'security',
    ]);
    if (reserved.has(owner.toLowerCase())) return null;
    return { owner, name: name.replace(/\.git$/, '') };
  } catch {
    return null;
  }
}

export async function fetchRepo(url) {
  const r = parseRepo(url);
  if (!r) return null;

  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'stash' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  try {
    const res = await fetchTimeout(`https://api.github.com/repos/${r.owner}/${r.name}`, { headers }, 8000);
    if (!res.ok) return null;
    const d = await res.json();

    let readme = '';
    try {
      const rr = await fetchTimeout(
        `https://api.github.com/repos/${r.owner}/${r.name}/readme`,
        { headers: { ...headers, accept: 'application/vnd.github.raw' } },
        7000
      );
      if (rr.ok) readme = (await rr.text()).replace(/\s+/g, ' ').slice(0, 3000);
    } catch {
      /* the readme is a bonus, not a requirement */
    }

    // Open pull requests, which the repo endpoint does not expose directly.
    // `open_issues_count` lumps issues and PRs together, so on its own it
    // cannot answer "is anyone still contributing to this". Asking for one PR
    // per page and reading the last page number off the Link header gets the
    // total in a single request rather than paging through every PR.
    let openPrs = null;
    try {
      const pr = await fetchTimeout(
        'https://api.github.com/repos/' + r.owner + '/' + r.name + '/pulls?state=open&per_page=1',
        { headers },
        6000
      );
      if (pr.ok) {
        const link = pr.headers.get('link') || '';
        const last = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
        if (last) {
          openPrs = Number(last[1]);
        } else {
          // No Link header means it all fits on one page: 0 or 1.
          const body = await pr.json().catch(() => []);
          openPrs = Array.isArray(body) ? body.length : 0;
        }
      }
    } catch {
      // Activity signals are a nice-to-have. Never fail enrichment over them.
    }

    return {
      repo_owner: r.owner,
      repo_name: r.name,
      repo_stars: d.stargazers_count ?? null,
      repo_forks: d.forks_count ?? null,
      repo_open_issues: d.open_issues_count ?? null,
      repo_open_prs: openPrs,
      repo_language: d.language ?? null,
      repo_license:
        d.license?.spdx_id && d.license.spdx_id !== 'NOASSERTION' ? d.license.spdx_id : null,
      repo_pushed_at: d.pushed_at ?? null,
      description: d.description ?? null,
      topics: d.topics ?? [],
      archived: !!d.archived,
      readme,
    };
  } catch {
    return null;
  }
}
