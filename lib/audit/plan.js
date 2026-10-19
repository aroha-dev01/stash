import { chatJSON } from '../llm.js';
import { jevDecide, jevEnabled } from '../models.js';

// Turns everything an audit found into one answer to "what do I fix first?".
//
//   1. Gather: technical checks, Lighthouse failures, and section problems
//      become uniform fix items (deduped where they overlap).
//   2. Judge: Jev scores each item's impact on the client's visitors and
//      enquiries — a Score, because impact is a degree (TypeSafe guidance:
//      a Noul near 0.5 would mean "unsure", not "medium").
//   3. Decide: code combines impact with effort into a priority and a tier.
//      Weights live here, visible and editable; no model picks the order.
//   4. Explain: DeepSeek writes a short overview for the designer and a
//      jargon-free summary that can go straight to the client.

const IMPACT_LEVELS = [
  'Invisible to almost every visitor; a technical nicety with no effect on trust or enquiries.',
  'A few visitors notice, or it slightly weakens how the site shows up in search.',
  'Many visitors are affected, or it clearly weakens trust, search ranking or enquiries.',
  'Stops visitors understanding the offer or getting in touch, or makes the site look broken or unsafe.',
];

const SEV_IMPACT = { critical: 3, high: 2.2, medium: 1.4, low: 0.6 };
const EASE = { quick: 1, 'half-day': 0.7, bigger: 0.45 };

// Plain-language versions of the Lighthouse findings clients feel most.
const LH = {
  'color-contrast': ['Accessibility', 'Text is hard to read against its background', 'Low-contrast text is the most common failure on the web; older visitors and anyone outdoors on a phone struggle to read it. WCAG 1.4.3 (AA).', 'Darken the text or lighten the background until contrast is at least 4.5:1 (3:1 for large headings).', 'quick'],
  'target-size': ['Mobile', 'Buttons and links are too small or too close to tap', 'Visitors on phones hit the wrong thing. WCAG 2.5.8 (AA).', 'Make tap targets at least 24×24px (ideally 44×44) with space between them.', 'quick'],
  'tap-targets': ['Mobile', 'Buttons and links are too small or too close to tap', 'Visitors on phones hit the wrong thing.', 'Make tap targets at least 44×44px with space between them.', 'quick'],
  'uses-responsive-images': ['Performance', 'Images are much larger than they display', 'Phones download desktop-size images, slowing the page on mobile data.', 'Serve resized images (srcset / an image CDN) at the size they are shown.', 'half-day'],
  'offscreen-images': ['Performance', 'Images below the fold load straight away', 'They compete with the first screen for bandwidth.', 'Lazy-load images below the first screen.', 'quick'],
  'modern-image-formats': ['Performance', 'Images are not in a modern format', 'WebP/AVIF are typically 25–50% smaller than JPEG/PNG for the same quality.', 'Convert images to WebP or AVIF.', 'quick'],
  'uses-optimized-images': ['Performance', 'Images are not compressed', 'Uncompressed images are the most common cause of a slow first load.', 'Compress images (e.g. 80% quality) before uploading.', 'quick'],
  'render-blocking-resources': ['Performance', 'Scripts and styles block the page from showing', 'The visitor stares at a blank screen while these load.', 'Defer non-critical scripts and inline the critical CSS.', 'half-day'],
  'unused-javascript': ['Performance', 'Lots of JavaScript is downloaded but never used', 'The phone downloads and processes code the page does not need.', 'Remove unused libraries/plugins and split code by page.', 'half-day'],
  'unused-css-rules': ['Performance', 'Lots of CSS is downloaded but never used', 'Extra weight on every page load.', 'Purge unused CSS (most frameworks do this at build time).', 'quick'],
  'font-display': ['Performance', 'Text stays invisible while fonts load', 'Visitors see blank space instead of words for a moment.', 'Add font-display: swap to web fonts.', 'quick'],
  'largest-contentful-paint-element': ['Performance', 'The main content appears late', 'Largest Contentful Paint is a Core Web Vital Google ranks on.', 'Preload the hero image/font and make it smaller.', 'half-day'],
  'is-crawlable': ['SEO', 'Search engines are blocked from the page', 'The page cannot appear in Google at all.', 'Remove the noindex directive / robots block.', 'quick'],
  'crawlable-anchors': ['SEO', 'Some links cannot be followed by search engines', 'Google may not discover the pages behind them.', 'Use real <a href="…"> links instead of click handlers.', 'quick'],
  'errors-in-console': ['Trust', 'The page throws browser errors', 'Something on the page is broken behind the scenes.', 'Open the browser console, fix the listed errors.', 'half-day'],
};

// Lighthouse audits that duplicate a technical check — the check wins.
const DUPLICATES = {
  'image-alt': 'img-no-alt', 'document-title': 'no-title', 'meta-description': 'no-meta-description',
  'html-has-lang': 'no-lang', label: 'labels-not-linked', 'link-name': 'empty-links', 'button-name': 'empty-buttons',
  viewport: 'no-viewport', 'heading-order': 'heading-skips', 'is-on-https': 'no-https',
};

const CHECK_EFFORT = {
  'no-https': 'quick', 'no-viewport': 'quick', 'no-lang': 'quick', 'no-title': 'quick', 'title-length': 'quick',
  'no-meta-description': 'quick', 'meta-description-length': 'quick', 'no-share-preview': 'quick', 'no-favicon': 'quick',
  'no-canonical': 'quick', 'no-structured-data': 'half-day', 'no-contact-path': 'quick', 'no-h1': 'quick',
  'multiple-h1': 'quick', 'heading-skips': 'quick', 'img-no-alt': 'quick', 'img-no-dimensions': 'quick',
  'img-not-lazy': 'quick', 'empty-links': 'quick', 'empty-buttons': 'quick', 'unlabeled-inputs': 'quick',
  'labels-not-linked': 'quick', 'no-main-landmark': 'quick', 'blank-no-noopener': 'quick',
  'heavy-html': 'bigger', 'many-scripts': 'half-day',
  // outside-the-HTML checks (probe.js)
  'no-hsts': 'quick', 'weak-hsts': 'quick', 'no-csp': 'half-day', 'weak-csp': 'half-day', 'no-frame-protection': 'quick',
  'missing-minor-headers': 'quick', 'server-version-exposed': 'quick', 'cors-open-credentials': 'quick',
  'insecure-cookies': 'half-day', 'mixed-content': 'quick', 'insecure-form-action': 'quick', 'third-party-no-sri': 'quick',
  'tls-invalid': 'quick', 'tls-expiring': 'quick', 'old-tls': 'quick', 'no-http-redirect': 'quick', 'www-duplicate': 'quick',
  'no-robots': 'quick', 'robots-blocks-all': 'quick', 'no-sitemap': 'quick', 'soft-404': 'half-day', 'no-security-txt': 'quick',
  // AI visibility (aeo.js)
  'ai-search-blocked-robots': 'quick', 'ai-search-blocked-firewall': 'quick', 'no-bot-protection': 'half-day', 'no-llms-txt': 'quick',
  'no-jsonld': 'half-day', 'no-entity-schema': 'quick', 'no-faq-schema': 'quick', 'no-qa-headings': 'half-day', 'no-direct-answers': 'quick',
  'ai-js-only': 'bigger', 'ai-nosnippet': 'quick', 'no-author-dates': 'quick', 'no-entity-links': 'quick', 'no-nap': 'quick', 'safe-browsing-flagged': 'half-day', 'field-vitals-poor': 'bigger', 'field-vitals-average': 'half-day',
  'no-spf': 'quick', 'no-dmarc': 'quick', 'weak-dmarc': 'quick', 'slow-server': 'bigger', 'no-compression': 'quick',
  'heavy-images': 'half-day', 'legacy-image-formats': 'half-day', 'weak-caching': 'quick', 'no-compression-assets': 'quick',
  'broken-links': 'quick', 'trackers-no-consent': 'half-day', 'no-privacy-policy': 'half-day',
};

const LABEL = (s) => (s === 'cta' || s === 'faq' ? s.toUpperCase() : String(s || 'Section').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));

export function gatherItems(audit) {
  const items = [];
  const checkIds = new Set();

  for (const c of audit.checks || []) {
    checkIds.add(c.id);
    items.push({
      key: 'check:' + c.id, source: 'check', category: c.category, severity: c.severity,
      title: c.title + ((c.pages || []).length > 1 ? ' (' + c.pages.length + ' pages)' : ''), why: c.why, fix: c.fix, effort: CHECK_EFFORT[c.id] || 'quick', wcag: c.wcag || null,
      pages: c.pages || undefined,
    });
  }

  for (const f of audit.psi?.failing || []) {
    if (DUPLICATES[f.id] && checkIds.has(DUPLICATES[f.id])) continue;
    const known = LH[f.id];
    const sev = f.category === 'accessibility' ? 'high' : f.score < 0.5 ? 'high' : 'medium';
    items.push({
      key: 'lh:' + f.id, source: 'lighthouse', severity: sev,
      category: known ? known[0] : { performance: 'Performance', accessibility: 'Accessibility', seo: 'SEO', 'best-practices': 'Trust' }[f.category],
      title: known ? known[1] : f.title,
      why: (known ? known[2] : 'Flagged by Google Lighthouse on mobile.') + (f.display ? ' (' + f.display + ')' : ''),
      fix: known ? known[3] : 'See the Lighthouse report for the affected elements.',
      effort: known ? known[4] : 'half-day',
    });
  }

  for (const s of audit.sections || []) {
    if (s.status !== 'designed' || !s.suggestion?.diagnosis) continue;
    const d = s.suggestion.directions?.[s.picked ?? 0] || s.suggestion.directions?.[0];
    items.push({
      key: 'section:' + s.id, source: 'section', section_id: s.id, section_position: s.position,
      category: (s.issues || []).some((i) => /copy|headline/i.test(i)) ? 'Copy' : 'Design',
      severity: Number(s.needs_work) >= 0.7 ? 'high' : 'medium',
      title: LABEL(s.type) + (s.signals?.page_path && s.signals.page_path !== '/' ? ' on ' + s.signals.page_path : '') + ' (#' + ((s.signals?.page_pos ?? s.position) + 1) + '): ' + (s.issues?.[0] || 'can be stronger'),
      why: s.suggestion.diagnosis,
      fix: d ? d.title + ' — ' + d.idea : 'See the redesign directions for this section.',
      effort: d?.effort || 'half-day',
      needs_work: Number(s.needs_work) || 0,
    });
  }
  return items;
}

async function impactsJev(items, audit) {
  const questions = {};
  items.forEach((it, i) => {
    questions['i' + i] = {
      type: 'score',
      instructions: {
        issue: { title: it.title, why_it_matters: it.why, area: it.category },
        question: 'For a `website.business_type` business whose visitors should `website.main_contact_goal`, how much does `issue` hurt the business: lost visitors and enquiries, lower search ranking, or exposure to hacking, scams and legal trouble?',
      },
      criteria: IMPACT_LEVELS,
    };
  });
  const j = audit.site?.judgement || {};
  const answers = await jevDecide(
    {
      website: {
        title: audit.title, url: audit.url, about: audit.description, platform: audit.site?.framework,
        business_type: j.business_type, main_contact_goal: j.contact_goal,
      },
    },
    questions,
    15000
  );
  return items.map((_, i) => answers['i' + i]?.score ?? null);
}

/**
 * Policy in code: 70% impact, 30% ease.
 *
 * Tiers are relative, not a fixed cut-off. On audit #9 Jev's impact scores
 * all landed between 1.6 and 2.0, just under a fixed "2.0 = fix now" line,
 * so a site with real problems showed zero "Fix now" items. Now the top
 * third by priority is "now" (anything that blocks contact or looks broken,
 * impact ≥ 2.5, always is), the next third "next", the rest "later" — and
 * nothing trivial (impact < 1) is ever "now".
 */
function prioritise(items, impacts) {
  const scored = items
    .map((it, i) => {
      let impact = impacts?.[i];
      if (impact == null) impact = it.source === 'section' ? it.needs_work * 3 : SEV_IMPACT[it.severity] ?? 1;
      const priority = 0.7 * (impact / 3) + 0.3 * (EASE[it.effort] ?? 0.7);
      return { ...it, impact: Number(impact.toFixed(2)), priority: Number(priority.toFixed(3)) };
    })
    .sort((a, b) => b.priority - a.priority);

  const third = Math.max(1, Math.ceil(scored.length / 3));
  return scored.map((it, rank) => {
    let tier = rank < third ? 'now' : rank < third * 2 ? 'next' : 'later';
    if (it.impact >= 2.5) tier = 'now';
    if (tier === 'now' && it.impact < 1) tier = 'next';
    return { ...it, tier, client_fix: clientFix(it) };
  });
}

// What the client reads under "What we will do" — no code, no acronyms.
const CLIENT_FIX = {
  'no-https': 'Switch the site to a secure (padlock) connection.',
  'no-title': 'Write a clear page title for Google and the browser tab.',
  'title-length': 'Tighten the page title so it shows in full on Google.',
  'no-meta-description': 'Write the short description Google shows under your link.',
  'meta-description-length': 'Rewrite the short description Google shows under your link.',
  'no-viewport': 'Set the site up properly for phones.',
  'no-share-preview': 'Add a proper preview image and title for when your link is shared on WhatsApp and social media.',
  'no-favicon': 'Add your logo icon to the browser tab.',
  'no-canonical': 'Tell search engines which address is the main one for this page.',
  'no-structured-data': 'Add your business details in the format Google uses for rich results (name, location, hours).',
  'no-contact-path': 'Add one-tap ways to reach you — call, WhatsApp or a short form.',
  'no-lang': 'Mark the page language so screen readers read it correctly.',
  'no-h1': 'Give the page one clear main heading.',
  'multiple-h1': 'Keep one main heading and turn the others into sub-headings.',
  'heading-skips': 'Put the page headings in a clean order.',
  'img-no-alt': 'Add short descriptions to images, for visually impaired visitors and Google Images.',
  'img-no-dimensions': 'Stop the page from jumping around while images load.',
  'img-not-lazy': 'Load lower images only when visitors scroll to them, so the page opens faster.',
  'empty-links': 'Label icon links (like social icons) so everyone knows where they go.',
  'empty-buttons': 'Label icon buttons so everyone knows what they do.',
  'unlabeled-inputs': 'Add clear labels to every form field.',
  'labels-not-linked': 'Connect each form label to its field so the form works for everyone and is easier to tap on phones.',
  'no-main-landmark': 'Mark up the main content so assistive technology can jump to it.',
  'blank-no-noopener': 'Make links that open new tabs safe.',
  'heavy-html': 'Slim down the page so it loads faster on mobile data.',
  'many-scripts': 'Remove unused add-ons that slow the page down.',
  'no-hsts': 'Tell browsers to always use the secure version of your site.',
  'weak-hsts': 'Make the "always use secure connection" rule last longer.',
  'no-csp': 'Add a protection layer that stops unauthorised scripts running on your pages.',
  'weak-csp': 'Tighten the rule that controls which scripts may run on your pages.',
  'no-frame-protection': 'Stop other websites from embedding yours to trick visitors.',
  'missing-minor-headers': 'Switch on a few small browser protections that cost nothing.',
  'server-version-exposed': 'Stop the server from announcing its software version to attackers.',
  'cors-open-credentials': 'Restrict which other websites can talk to your site\'s data.',
  'insecure-cookies': 'Lock down the small files the site stores in visitors\' browsers.',
  'mixed-content': 'Make every image, script and style on the page load securely.',
  'insecure-form-action': 'Make the enquiry form send details securely.',
  'third-party-no-sri': 'Add tamper-checks to external code the site loads.',
  'tls-invalid': 'Fix the security certificate so visitors stop seeing a warning.',
  'tls-expiring': 'Renew the security certificate and turn on automatic renewal.',
  'old-tls': 'Turn off outdated encryption on the server.',
  'no-http-redirect': 'Send everyone who uses the old insecure address to the secure one.',
  'www-duplicate': 'Make "www" and non-"www" point to one main address so Google sees a single site.',
  'no-robots': 'Add the small file that guides search engines around your site.',
  'robots-blocks-all': 'Unblock search engines so the site can appear on Google.',
  'no-sitemap': 'Publish a sitemap so Google finds every page quickly.',
  'ai-search-blocked-robots': 'Let ChatGPT, Claude, Perplexity and Google\'s AI read the site so they can recommend you.',
  'ai-search-blocked-firewall': 'Stop the site\'s security from turning away the AI assistants that could recommend you.',
  'no-bot-protection': 'Switch on bot protection so copycats cannot scrape the site, while search and AI assistants still get in.',
  'no-llms-txt': 'Add a short plain-text summary of the business for AI assistants.',
  'no-jsonld': 'Add hidden business details (name, address, services, questions) that search and AI read exactly.',
  'no-entity-schema': 'Add the business\'s own details in a form search and AI understand.',
  'no-faq-schema': 'Mark up the questions already on the page so search and AI can quote them.',
  'no-qa-headings': 'Add a section answering the questions customers really ask, in their words.',
  'no-direct-answers': 'Start each answer with a clear one or two sentence reply.',
  'ai-js-only': 'Make the text load with the page, so AI assistants can read it.',
  'ai-nosnippet': 'Remove the setting that stops Google and AI from quoting the page.',
  'safe-browsing-flagged': 'We will clean the site, remove the cause of the warning and ask Google to lift it.',
  'field-vitals-poor': 'We will speed up the pages real visitors find slow on their phones.',
  'field-vitals-average': 'We will tune the page so it loads comfortably fast for real visitors.',
  'no-author-dates': 'Show who is behind the information and when it was last updated.',
  'no-entity-links': 'Link the site to the business\'s official profiles so AI recognises it as one brand.',
  'no-nap': 'Show the address and phone clearly, in text and in hidden business details.',
  'soft-404': 'Show a proper "page not found" page for addresses that do not exist.',
  'no-security-txt': 'Publish a contact so security researchers can report problems privately.',
  'no-spf': 'Stop scammers sending email that looks like it comes from your domain.',
  'no-dmarc': 'Protect your domain from forged email and improve inbox delivery.',
  'weak-dmarc': 'Move your email protection from "watch only" to "block forged email".',
  'slow-server': 'Speed up how quickly the server responds.',
  'no-compression': 'Compress pages so they download faster on mobile data.',
  'heavy-images': 'Shrink the heaviest images so pages open faster on phones.',
  'legacy-image-formats': 'Switch to modern, lighter image formats.',
  'weak-caching': 'Let returning visitors reuse files instead of downloading them again.',
  'no-compression-assets': 'Compress scripts and styles so they download faster.',
  'broken-links': 'Fix links that lead to missing pages.',
  'trackers-no-consent': 'Add a cookie-consent notice and hold tracking until visitors agree.',
  'no-privacy-policy': 'Publish a privacy policy and link it from the footer and forms.',
};

function clientFix(it) {
  if (it.source === 'section') return it.fix;
  if (it.source === 'check') return CLIENT_FIX[it.key.slice(6)] || 'We will fix this in the website.';
  return it.fix;
}

async function summarise(audit, ranked) {
  const top = ranked.slice(0, 12).map((r) => ({ tier: r.tier, area: r.category, issue: r.title, why: r.why, fix: r.fix, effort: r.effort }));
  const system = [
    'You are a senior web designer writing up a client website audit.',
    'Return strict JSON: { "overview": "...", "client_summary": "...", "strengths": ["..."] }',
    '- overview: 3-4 sentences for the DESIGNER. The biggest wins first, specific to this site, naming the actual sections/issues. No fluff.',
    '- client_summary: 4-6 sentences addressed to the CLIENT (the business owner). Plain words, no jargon (no "LCP", "WCAG", "H1", "schema"),',
    '  explain the effect on their visitors and enquiries, honest but encouraging, ending with what will be done first.',
    '- strengths: 2-3 short things the site already does well, from the evidence given. Empty array if nothing clear.',
    'Never invent numbers, results or facts not in the input.',
  ].join('\n');
  const user = JSON.stringify({
    site: { title: audit.title, url: audit.url, platform: audit.site?.framework },
    design_health: audit.summary?.health ?? null,
    lighthouse_mobile: audit.psi?.scores || null,
    solid_sections: (audit.sections || []).filter((s) => s.status === 'skipped').map((s) => s.type).slice(0, 8),
    top_fixes: top,
  });
  try {
    const r = await chatJSON(system, user, 30000);
    return {
      overview: String(r?.overview || '').slice(0, 900),
      client_summary: String(r?.client_summary || '').slice(0, 1400),
      strengths: (Array.isArray(r?.strengths) ? r.strengths : []).slice(0, 3).map((s) => String(s).slice(0, 160)),
    };
  } catch {
    return { overview: null, client_summary: null, strengths: [] };
  }
}

export async function buildPlan(audit) {
  const items = gatherItems(audit);
  let impacts = null;
  let engine = 'rules';
  if (jevEnabled() && items.length) {
    try {
      impacts = await impactsJev(items.slice(0, 70), audit);
      engine = 'jev';
    } catch {
      engine = 'rules (jev failed)';
    }
  }
  const ranked = prioritise(items, impacts);
  const words = await summarise(audit, ranked);
  return {
    items: ranked,
    counts: {
      now: ranked.filter((r) => r.tier === 'now').length,
      next: ranked.filter((r) => r.tier === 'next').length,
      later: ranked.filter((r) => r.tier === 'later').length,
    },
    impact_engine: engine,
    ...words,
  };
}
