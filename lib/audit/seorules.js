// Deeper SEO / content / structure / accessibility rules, run on every page
// the audit reads (called from checks.js).
//
// The list of what to check was shaped by the open-source SEOmator audit tool
// (github.com/seo-skills/seo-audit-skill, MIT), which scans against a few
// hundred rules. Those rules need a headless browser and a crawl, so they
// cannot run inside a serverless audit; this file implements, in our own code,
// the part that can be decided from one page's HTML. Rules that need a full
// crawl or a rendered page (orphan pages, duplicate content, tap-target sizes,
// Core Web Vitals) stay with the page-reading, PageSpeed and Search Console
// steps, or with the SEOmator import (see codefindings.js).
//
// Every check is a fact about the HTML. None asks a model.

const GENERIC_LINK = /^(click here|here|read more|more|learn more|link|this|details|continue|go)$/i;
const STOP_NAMES = /^(img|image|dsc|dscn|photo|screenshot|untitled|pic|picture|download|unnamed)[-_ ]?\d*\.(jpe?g|png|gif|webp)$/i;

const abs = (href, base) => { try { return new URL(href, base); } catch { return null; } };

const REQUIRED = {
  LocalBusiness: ['name', 'address', 'telephone'],
  Organization: ['name', 'url'],
  Product: ['name', 'offers'],
  Article: ['headline', 'datePublished', 'author'],
  BlogPosting: ['headline', 'datePublished', 'author'],
  FAQPage: ['mainEntity'],
  BreadcrumbList: ['itemListElement'],
  Person: ['name'],
};

function flatTypes(node, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => flatTypes(n, out)); return out; }
  if (node && typeof node === 'object') {
    const t = node['@type'];
    if (t) (Array.isArray(t) ? t : [t]).forEach((x) => out.push({ type: String(x), node }));
    if (node['@graph']) flatTypes(node['@graph'], out);
  }
  return out;
}

/**
 * @param $    cheerio instance loaded BEFORE scripts and styles were stripped
 * @param html raw HTML
 * @param url  the page URL
 * @param make finding(id, category, severity, title, why, fix, extra)
 */
export function seoRules($, html, url, make) {
  const out = [];
  const add = (...a) => out.push(make(...a));
  const base = abs(url);
  const meta = (name) => ($(`meta[name="${name}"]`).attr('content') || '').trim();
  const prop = (p) => ($(`meta[property="${p}"]`).attr('content') || '').trim();

  /* ------------------------------------------------------------ indexability */
  const robots = meta('robots').toLowerCase();
  if (/(^|[,\s])noindex/.test(robots)) {
    add('page-noindex', 'SEO', 'critical', 'This page tells Google not to list it (noindex)',
      'A noindex tag removes the page from search results. It is sometimes left on after a site is built or moved.',
      'Remove "noindex" from the robots meta tag, unless this page is meant to stay out of search.', { evidence: robots });
  }

  const canon = $('link[rel="canonical"]');
  if (canon.length > 1) {
    add('canonical-multiple', 'SEO', 'medium', canon.length + ' canonical tags on one page',
      'Conflicting canonicals make Google choose for itself, and it may choose the wrong address.', 'Keep exactly one <link rel="canonical"> per page.');
  } else if (canon.length === 1) {
    const href = (canon.attr('href') || '').trim();
    const c = abs(href, url);
    if (!href) add('canonical-invalid', 'SEO', 'medium', 'Canonical tag is empty', 'An empty canonical is ignored.', 'Set it to the full address of this page, e.g. ' + (base ? base.origin + base.pathname : 'https://example.com/page') + '.');
    else if (!/^https?:\/\//i.test(href)) add('canonical-invalid', 'SEO', 'low', 'Canonical uses a relative address', 'Search engines expect a full address; a relative one can be misread.', 'Use the full https:// address in the canonical tag.', { evidence: href });
    else if (c && base && c.protocol !== base.protocol) add('canonical-invalid', 'SEO', 'medium', 'Canonical points at a different protocol (' + c.protocol + ')', 'The page asks Google to use the ' + (c.protocol === 'http:' ? 'insecure' : 'other') + ' version.', 'Make the canonical use https:// like the page.', { evidence: href });
  }

  /* ------------------------------------------------------------ head hygiene */
  if ($('title').length > 1) add('multiple-titles', 'SEO', 'medium', $('title').length + ' title tags on one page', 'Google picks one, often not the one you want.', 'Keep a single <title> in the head.');
  if ($('meta[name="description"]').length > 1) add('multiple-descriptions', 'SEO', 'low', $('meta[name="description"]').length + ' meta descriptions', 'Duplicates can be ignored or the wrong one used.', 'Keep a single meta description.');
  if (!/^\s*<!doctype html/i.test(html)) add('missing-doctype', 'SEO', 'low', 'Missing <!DOCTYPE html>', 'Browsers fall back to quirks mode, which can break layout and some tools.', 'Start the document with <!DOCTYPE html>.');
  if (!$('meta[charset], meta[http-equiv="Content-Type" i]').length) add('missing-charset', 'SEO', 'low', 'No character set declared', 'Accents, currency symbols and emoji can show as garbage.', 'Add <meta charset="utf-8"> as the first tag in <head>.');
  if (/lorem ipsum|dolor sit amet/i.test($('body').text())) add('lorem-ipsum', 'SEO', 'high', 'Placeholder "lorem ipsum" text is live', 'Visitors and Google see unfinished copy, which hurts trust and rankings.', 'Replace every placeholder block with real copy before launch.');

  /* ------------------------------------------------------------------ social */
  const ogMissing = ['og:title', 'og:description', 'og:image'].filter((p) => !prop(p));
  if (ogMissing.length && ogMissing.length < 3) add('og-incomplete', 'SEO', 'low', 'Link preview tags are incomplete (missing ' + ogMissing.join(', ') + ')', 'When the page is shared the preview card may show no picture or the wrong text.', 'Add the missing Open Graph tags; use a 1200x630 image.');
  if ($('meta[property^="og:"]').length && !meta('twitter:card')) add('no-twitter-card', 'SEO', 'low', 'No twitter:card tag', 'X and some apps will not show a large preview.', 'Add <meta name="twitter:card" content="summary_large_image">.');

  /* ---------------------------------------------------------- structured data */
  const ld = $('script[type="application/ld+json"]').toArray();
  let broken = 0;
  const lacking = [];
  for (const s of ld) {
    let data;
    try { data = JSON.parse($(s).contents().text() || $(s).text()); } catch { broken++; continue; }
    for (const { type, node } of flatTypes(data)) {
      const need = REQUIRED[type];
      if (!need) continue;
      const missing = need.filter((k) => node[k] == null || node[k] === '');
      if (missing.length) lacking.push(type + ' is missing ' + missing.join(', '));
    }
  }
  if (broken) add('jsonld-invalid', 'SEO', 'high', broken + ' structured data block' + (broken > 1 ? 's' : '') + ' cannot be read (invalid JSON)', 'Google ignores structured data it cannot parse, so rich results never appear.', 'Fix the JSON syntax (commas, quotes) and test it in Google\'s Rich Results Test.');
  if (lacking.length) add('schema-fields-missing', 'SEO', 'medium', 'Structured data is missing required fields', lacking.slice(0, 4).join('. ') + '. Google may refuse to show rich results without them.', 'Add the missing fields to the JSON-LD. Check with the Rich Results Test.', { evidence: lacking.slice(0, 6) });

  /* ------------------------------------------------------------------ i18n */
  const hrefl = $('link[rel="alternate"][hreflang]').toArray().map((e) => ({ lang: ($(e).attr('hreflang') || '').toLowerCase(), href: $(e).attr('href') || '' }));
  if (hrefl.length) {
    const self = hrefl.some((h) => { const u = abs(h.href, url); return u && base && u.href.replace(/\/$/, '') === base.href.replace(/\/$/, ''); });
    if (!self) add('hreflang-no-self', 'SEO', 'medium', 'Language versions do not include this page itself', 'Each language page must list itself and its siblings, or the set is ignored.', 'Add a self-referencing hreflang tag, plus x-default.');
    if (!hrefl.some((h) => h.lang === 'x-default')) add('hreflang-no-default', 'SEO', 'low', 'No x-default language fallback', 'Visitors from other countries get no recommended version.', 'Add hreflang="x-default" pointing at the main version.');
    const htmlLang = ($('html').attr('lang') || '').toLowerCase().split('-')[0];
    if (htmlLang && !hrefl.some((h) => h.lang.split('-')[0] === htmlLang)) add('hreflang-lang-mismatch', 'SEO', 'low', 'The page language does not appear in its hreflang tags', 'The html lang is "' + htmlLang + '" but no hreflang matches it.', 'Make the page\'s lang attribute and hreflang tags agree.');
  }

  /* --------------------------------------------------------------- redirects */
  if ($('meta[http-equiv="refresh" i]').length) add('meta-refresh', 'SEO', 'medium', 'Page redirects with a meta refresh tag', 'Slow and unreliable for search engines compared with a server redirect.', 'Replace it with a 301 redirect at the server.');
  const inline = $('script:not([src])').toArray().map((s) => $(s).html() || '').join('\n');
  if (/(^|\s)(window\.)?location\.(replace|href)\s*=|location\.replace\(/.test(inline.slice(0, 20000)) && $('body').text().trim().length < 400) {
    add('js-redirect', 'SEO', 'medium', 'Page sends visitors on with JavaScript', 'Search engines may not follow script redirects, and the page flashes first.', 'Use a server-side 301 redirect.');
  }

  /* ---------------------------------------------------------- url structure */
  if (base) {
    const bad = [];
    if (/[A-Z]/.test(base.pathname)) bad.push('capital letters');
    if (/_/.test(base.pathname)) bad.push('underscores');
    if (url.length > 115) bad.push('very long (' + url.length + ' characters)');
    if ([...base.searchParams.keys()].length > 3) bad.push('many query parameters');
    if (/(sessionid|phpsessid|jsessionid|sid)=/i.test(base.search)) bad.push('a session id');
    if (bad.length) add('url-structure', 'SEO', 'low', 'Page address is not clean (' + bad.join(', ') + ')', 'Short, lowercase, hyphenated addresses are easier to read, share and rank.', 'Use lowercase words separated by hyphens, and redirect the old address.', { evidence: url });
  }

  /* ------------------------------------------------------------------ content */
  const bodyClone = $('body').clone();
  bodyClone.find('script,style,noscript,nav,footer,header').remove();
  const text = bodyClone.text().replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ') : [];
  const isHome = base && (base.pathname === '/' || base.pathname === '');
  if (words.length < 150 && words.length > 0 && !isHome) add('thin-content', 'SEO', 'medium', 'Very little text on this page (' + words.length + ' words)', 'Pages with almost no text rarely rank, and AI assistants have nothing to quote.', 'Add useful, specific copy: who it is for, what is offered, prices or process, and common questions.', { count: words.length });
  if (words.length > 120) {
    const freq = new Map();
    for (const w of words.map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((x) => x.length > 4)) freq.set(w, (freq.get(w) || 0) + 1);
    const [top, n] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (n && n / words.length > 0.06) add('keyword-stuffing', 'SEO', 'low', '"' + top + '" makes up ' + Math.round((n / words.length) * 100) + '% of the text', 'Repeating one word this often reads as spam to Google and to people.', 'Rewrite naturally and use related words instead.', { evidence: top + ' x' + n });
  }
  const h1 = ($('h1').first().text() || '').replace(/\s+/g, ' ').trim();
  const ttl = ($('title').first().text() || '').replace(/\s+/g, ' ').trim();
  if (h1 && ttl && h1.toLowerCase() === ttl.toLowerCase()) add('title-equals-h1', 'SEO', 'low', 'Title and main heading are identical', 'It is a missed chance to rank for a second phrase.', 'Keep the heading for visitors and write the title for search results.', { evidence: ttl });
  const htmlLen = html.length;
  if (htmlLen > 20000 && text.length / htmlLen < 0.04) add('low-text-ratio', 'SEO', 'low', 'Almost all of the page is code, not text (' + Math.round((text.length / htmlLen) * 100) + '% text)', 'Pages heavy on markup and light on words are slower and give search engines less to read.', 'Remove unused code and add real content.');
  const metaDesc = meta('description');
  if (ttl && ttl.length * 8.5 > 600) add('title-too-wide', 'SEO', 'low', 'Title is likely cut off in search results', 'Google shows about 580 pixels, roughly 60 characters.', 'Shorten the title and put the key words first.', { evidence: ttl });
  if (metaDesc && /^(welcome|home|just another)/i.test(metaDesc)) add('generic-description', 'SEO', 'low', 'Meta description looks like a default', 'It will not make anyone click.', 'Write one sentence on what the page offers and why to choose it.', { evidence: metaDesc });

  /* ----------------------------------------------------------------- images */
  const imgs = $('img').toArray();
  const names = imgs.map((i) => (($(i).attr('src') || '').split('?')[0].split('/').pop() || '')).filter((n) => STOP_NAMES.test(n));
  if (names.length >= 3) add('image-filenames', 'SEO', 'low', names.length + ' images have camera or placeholder file names', 'File names like IMG_2043.jpg tell search nothing; descriptive names help image search.', 'Rename to what the picture shows, e.g. 3-bedroom-villa-hyderabad.jpg.', { evidence: names.slice(0, 3) });
  const longAlt = imgs.filter((i) => ($(i).attr('alt') || '').length > 125).length;
  if (longAlt) add('alt-too-long', 'Accessibility', 'low', longAlt + ' image description' + (longAlt > 1 ? 's are' : ' is') + ' very long', 'Screen readers read it all out; keep it to a short sentence.', 'Trim alt text to under 125 characters.');

  /* ------------------------------------------------------------ accessibility */
  const vp = meta('viewport').toLowerCase();
  if (/user-scalable\s*=\s*(no|0)/.test(vp) || /maximum-scale\s*=\s*(0?\.\d+|1(\.0)?)(?!\d)/.test(vp)) add('zoom-disabled', 'Accessibility', 'medium', 'Pinch-zoom is switched off', 'People with low vision cannot enlarge the page (WCAG 1.4.4).', 'Remove user-scalable=no and maximum-scale from the viewport tag.', { evidence: vp, wcag: '1.4.4' });
  if (/width\s*=\s*\d{3,}/.test(vp)) add('fixed-viewport', 'SEO', 'medium', 'Viewport is locked to a fixed width', 'Phones show a zoomed-out desktop page.', 'Use width=device-width, initial-scale=1.');
  const firstLinks = $('a[href^="#"]').slice(0, 5).toArray().map((a) => ($(a).text() + ' ' + ($(a).attr('class') || '')).toLowerCase());
  if (!firstLinks.some((t) => /skip|main content/.test(t)) && $('a[href]').length > 12) add('no-skip-link', 'Accessibility', 'low', 'No "skip to content" link', 'Keyboard users must tab through the whole menu on every page (WCAG 2.4.1).', 'Add a first link, <a href="#main">Skip to content</a>, and show it on focus.', { wcag: '2.4.1' });
  if ($('main').length && !$('nav').length && $('a[href]').length > 12) add('no-nav-landmark', 'Accessibility', 'low', 'No <nav> landmark around the menu', 'Screen-reader users cannot jump to the navigation.', 'Wrap the main menu in <nav>.');
  const vague = $('a').toArray().filter((a) => GENERIC_LINK.test($(a).text().replace(/\s+/g, ' ').trim()) && !($(a).attr('aria-label') || '').trim()).length;
  if (vague >= 3) add('vague-link-text', 'Accessibility', 'low', vague + ' links say only "read more" or "click here"', 'Screen readers list links out of context, and Google uses link text to understand the target.', 'Describe the destination: "Read the pricing guide".', { count: vague, wcag: '2.4.4' });
  const noHead = $('table').toArray().filter((t) => !$(t).find('th').length && $(t).find('tr').length > 1).length;
  if (noHead) add('table-no-headers', 'Accessibility', 'low', noHead + ' data table' + (noHead > 1 ? 's' : '') + ' without header cells', 'Screen readers cannot tell which column a value belongs to.', 'Use <th> for header cells.', { wcag: '1.3.1' });

  /* ------------------------------------------------------------- performance */
  const blocking = $('head script[src]').toArray().filter((s) => !$(s).attr('async') && !$(s).attr('defer') && ($(s).attr('type') || '') !== 'module').length;
  if (blocking >= 3) add('render-blocking-scripts', 'Performance', 'medium', blocking + ' scripts block the page from showing', 'The browser stops drawing until each one downloads and runs, so visitors see a blank screen longer.', 'Add defer (or async) to scripts in the head, or move them to the end of the body.', { count: blocking });
  const thirdParty = new Set($('script[src],link[href][rel="stylesheet"]').toArray().map((e) => abs($(e).attr('src') || $(e).attr('href'), url)).filter((u) => u && base && u.hostname !== base.hostname).map((u) => u.origin));
  const pre = new Set($('link[rel="preconnect"],link[rel="dns-prefetch"]').toArray().map((e) => (abs($(e).attr('href'), url) || {}).origin));
  if (thirdParty.size >= 3 && ![...thirdParty].some((o) => pre.has(o))) add('no-preconnect', 'Performance', 'low', 'Outside services load without a head start (' + thirdParty.size + ' domains)', 'Warming up connections saves a few hundred milliseconds per service.', 'Add <link rel="preconnect"> for the two or three most important outside domains (fonts, analytics).', { evidence: [...thirdParty].slice(0, 4) });
  const faces = (html.match(/@font-face\s*{[^}]*}/g) || []);
  if (faces.length && faces.some((f) => !/font-display/i.test(f))) add('font-display', 'Performance', 'low', 'Web fonts can make text invisible while loading', 'Without font-display, some browsers hide text until the font arrives.', 'Add font-display: swap to each @font-face rule.');

  /* ---------------------------------------------------------------- trust */
  const linkTexts = $('a[href]').toArray().map((a) => $(a).text().toLowerCase());
  if (!linkTexts.some((t) => /\babout\b/.test(t)) && isHome) add('no-about-link', 'Trust', 'low', 'No "About" page linked', 'Visitors and Google look for who is behind a business (E-E-A-T).', 'Add an About page with real people, history and credentials, and link it from the menu.');
  if (!linkTexts.some((t) => /terms|conditions|disclaimer/.test(t)) && isHome) add('no-terms-link', 'Trust', 'low', 'No terms or disclaimer link', 'Business sites normally state their terms, and some advertising and payment tools require it.', 'Add a short terms page and link it from the footer.');

  /* --------------------------------------------------------------- links */
  const local = $('a[href]').toArray().filter((a) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test($(a).attr('href') || '')).length;
  if (local) add('localhost-links', 'SEO', 'high', local + ' link' + (local > 1 ? 's point' : ' points') + ' at localhost', 'These links are broken for every visitor. They are leftovers from development.', 'Replace them with the live addresses.', { count: local });
  const external = $('a[href^="http"]').toArray().filter((a) => { const u = abs($(a).attr('href'), url); return u && base && u.hostname !== base.hostname; }).length;
  if (external > 100) add('many-external-links', 'SEO', 'low', external + ' outbound links on one page', 'Too many can dilute the page and look spammy.', 'Keep only the links that help the reader.', { count: external });
  if (/(?:src|href)=["']\/\/[a-z0-9]/i.test(html)) add('protocol-relative', 'Security', 'low', 'Some files are loaded with "//" web addresses', 'Protocol-relative URLs are an outdated pattern and can load over http.', 'Write the full https:// address.');

  return out;
}
