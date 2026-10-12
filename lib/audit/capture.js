import * as cheerio from 'cheerio';
import { fetchTimeout, USER_AGENT } from '../util.js';

// Reads a client's page and splits it into the sections a visitor would see.
//
// Works from the server-rendered HTML, which is what Framer, Webflow,
// WordPress, Next.js and hand-built sites all ship. The splitting rule was
// tuned against real pages (a hand-built site, a Next.js site, framer.com and
// webflow.com) rather than guessed:
//
//   1. Walk down through single-child wrappers (#__next, #main, <div><div>...).
//   2. At the first level with several meaningful children, those children
//      are candidate sections.
//   3. A candidate that holds a large share of the page and has several
//      headed children is a wrapper too, so open it up — unless its children
//      are a run of similar small cards (a carousel, a logo wall), which is
//      one section, not twelve.
//   4. Merge runs of tiny headless fragments (a nav split into three divs)
//      and drop specks (a floating button) so the list reads like a page.

const MAX_SECTIONS = 18;
const MEDIA = 'img,picture,video,canvas,iframe,form';

export async function fetchPage(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  new URL(url); // throws on nonsense

  let res;
  try {
    res = await fetchTimeout(
      url,
      { headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' } },
      15000
    );
  } catch (e) {
    throw new Error('Could not reach the site (' + (e.name === 'TimeoutError' ? 'timed out' : e.message) + ')');
  }
  if (!res.ok) throw new Error('The site returned ' + res.status);
  const type = res.headers.get('content-type') || '';
  if (!type.includes('html')) throw new Error('That URL is not a web page (' + type.split(';')[0] + ')');

  const html = (await res.text()).slice(0, 4_000_000);
  return { html, url: res.url || url };
}

/* ------------------------------------------------------------ site style */

function count(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

function detectFramework($, html) {
  const gen = ($('meta[name="generator"]').attr('content') || '').toLowerCase();
  if (gen.includes('framer') || html.includes('data-framer-')) return 'Framer';
  if (gen.includes('webflow') || html.includes('data-wf-site')) return 'Webflow';
  if (gen.includes('wordpress') || html.includes('/wp-content/')) return 'WordPress';
  if (gen.includes('wix') || html.includes('static.wixstatic.com')) return 'Wix';
  if (html.includes('cdn.shopify.com')) return 'Shopify';
  if (gen.includes('squarespace') || html.includes('squarespace')) return 'Squarespace';
  if (html.includes('__NEXT_DATA__') || html.includes('/_next/')) return 'Next.js';
  if (html.includes('/_astro/')) return 'Astro';
  if (html.includes('data-reactroot') || html.includes('id="root"')) return 'React';
  return 'Custom';
}

/** Fonts, colours, framework and basic page health, read before styles are stripped. */
function siteStyle($, html) {
  const fonts = new Map();
  const colours = new Map();

  $('link[href*="fonts.googleapis.com"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    for (const m of href.matchAll(/family=([^&:]+)/g)) {
      count(fonts, decodeURIComponent(m[1]).replace(/\+/g, ' '));
    }
  });

  const css = $('style').map((_, el) => $(el).html() || '').get().join('\n').slice(0, 600_000);
  for (const m of css.matchAll(/font-family\s*:\s*["']?([^;"',}]+)/gi)) {
    const f = m[1].trim();
    if (!/^(inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system|var\()/i.test(f)) count(fonts, f);
  }
  for (const m of (css + ' ' + html.slice(0, 400_000)).matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    count(colours, '#' + h);
  }

  const imgs = $('img');
  const noAlt = imgs.filter((_, el) => !($(el).attr('alt') || '').trim()).length;

  return {
    framework: detectFramework($, html),
    fonts: top(fonts, 4),
    colours: top(colours, 8),
    theme_colour: $('meta[name="theme-color"]').attr('content') || null,
    lang: $('html').attr('lang') || null,
    has_viewport: $('meta[name="viewport"]').length > 0,
    meta_description: ($('meta[name="description"]').attr('content') || '').trim().slice(0, 300) || null,
    og_image: $('meta[property="og:image"]').attr('content') || null,
    h1_count: $('h1').length,
    images: imgs.length,
    images_missing_alt: noAlt,
    forms: $('form').length,
    videos: $('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length,
  };
}

/* -------------------------------------------------------------- segments */

function segment($) {
  const txt = (el) => $(el).text().replace(/\s+/g, ' ').trim();
  const body = $('body').get(0);
  if (!body) return [];
  const total = txt(body).length || 1;

  const tagOf = (el) => (el.name || el.tagName || '').toLowerCase();
  const meaningful = (el) =>
    $(el).children().get().filter((c) => txt(c).length > 20 || $(c).is(MEDIA) || $(c).find(MEDIA).length > 0);
  const hasHead = (el) => /^(h1|h2|h3|header|nav|footer)$/.test(tagOf(el)) || $(el).find('h1,h2,h3').length > 0;
  const sig = (el) => tagOf(el) + '.' + (($(el).attr('class') || '').trim().split(/\s+/)[0] || '');
  const cardList = (kids) => {
    if (kids.length < 3) return false;
    const m = new Map();
    kids.forEach((c) => count(m, sig(c)));
    const avg = kids.reduce((s, c) => s + txt(c).length, 0) / kids.length;
    return Math.max(...m.values()) / kids.length >= 0.6 && avg < 600;
  };

  const out = [];
  const expand = (el, depth) => {
    const kids = meaningful(el);
    if (kids.length === 1 && depth < 25) return expand(kids[0], depth);
    const root = el === body || tagOf(el) === 'main';
    const share = txt(el).length / total;
    const open = root || (share > 0.4 && kids.filter(hasHead).length >= 2 && !cardList(kids));
    if (depth < 6 && kids.length >= 2 && open) kids.forEach((c) => expand(c, depth + 1));
    else out.push(el);
  };
  expand(body, 0);

  // Merge runs of small headless fragments; drop specks.
  const groups = [];
  for (const el of out) {
    const len = txt(el).length;
    const headed = $(el).find('h1,h2,h3').length > 0;
    const media = $(el).is(MEDIA) || $(el).find(MEDIA).length > 0;
    if (len < 80 && !headed && !media) continue;
    const prev = groups[groups.length - 1];
    if (prev && !headed && !prev.headed && len < 400 && prev.len < 400) {
      prev.els.push(el);
      prev.len += len;
    } else {
      groups.push({ els: [el], len, headed });
    }
  }

  return groups.slice(0, MAX_SECTIONS).map((g, position) => describe($, g.els, position, txt));
}

function hintOf($, el) {
  const $el = $(el);
  return [
    $el.attr('id'),
    $el.attr('data-framer-name'),
    $el.attr('aria-label'),
    ($el.attr('class') || '').split(/\s+/).filter((c) => c && !/^framer-[a-z0-9]+$/i.test(c)).slice(0, 3).join(' '),
  ]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 120) || null;
}

function describe($, els, position, txt) {
  const $all = $(els);
  const find = (sel) => $all.find(sel).add($all.filter(sel));
  const headings = find('h1,h2,h3').map((_, h) => txt(h)).get().filter(Boolean);
  const text = els.map(txt).join(' ').trim();

  const buttons = find('button, [role="button"], a[class*="btn"], a[class*="button"], a[class*="cta"]').length;
  const animated = find(
    '[data-aos], [data-framer-appear-id], [data-scroll], [class*="animate"], [class*="reveal"], [class*="motion"], [data-gsap]'
  ).length;
  const bgImage = find('[style*="background-image"]').length;

  return {
    position,
    tag: (els[0].name || '').toLowerCase(),
    name_hint: hintOf($, els[0]),
    heading: (headings[0] || '').slice(0, 200) || null,
    headings: headings.slice(0, 5).map((h) => h.slice(0, 120)),
    text_excerpt: text.slice(0, 700),
    signals: {
      words: text ? text.split(/\s+/).length : 0,
      headings: headings.length,
      images: find('img, picture').length,
      images_missing_alt: find('img').filter((_, el) => !($(el).attr('alt') || '').trim()).length,
      buttons,
      links: find('a[href]').length,
      forms: find('form').length,
      inputs: find('input, textarea, select').length,
      video: find('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length,
      canvas: find('canvas').length,
      svg: find('svg').length,
      list_items: find('li').length,
      background_images: bgImage,
      animation_hints: animated,
    },
  };
}

/** Fetch + split + site style, all in one. */
export async function capture(rawUrl) {
  const { html, url } = await fetchPage(rawUrl);
  const $ = cheerio.load(html);

  const title = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || '').trim().slice(0, 200) || null;
  const site = siteStyle($, html);

  $('script, style, noscript, template, link, meta').remove();
  const sections = segment($);

  return {
    url,
    title,
    description: site.meta_description,
    site: {
      ...site,
      words: $('body').text().replace(/\s+/g, ' ').trim().split(/\s+/).length,
      section_count: sections.length,
      // Rendered in the visitor's browser, not fetched here, so a slow
      // screenshot service never eats the function's time budget.
      screenshot: 'https://api.microlink.io/?url=' + encodeURIComponent(url) +
        '&screenshot=true&fullPage=true&meta=false&embed=screenshot.url&viewport.width=1440',
      screenshot_fallback: 'https://image.thum.io/get/width/1200/crop/3200/' + url,
    },
    sections,
  };
}
