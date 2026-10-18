// How ready a site is to be found, read and cited by AI assistants (AEO and
// GEO: answer-engine and generative-engine optimisation), and which crawlers
// it lets in or keeps out.
//
// Everything is passive and ordinary: robots.txt, llms.txt, the homepage HTML
// and a handful of plain GETs of the homepage that differ only in their
// User-Agent. A User-Agent can be faked and real bots are verified by network
// address, so the live test shows what the site's firewall does with the
// *name*, which is what most bot rules key on. It does not prove what the real
// bot would receive, and the results say so.

const SEV = { high: 3, medium: 2, low: 1 };
const ms = (n) => AbortSignal.timeout(n);

/* ----------------------------------------------------------------- bots */

// role: 'search' = fetches pages to answer a user and can cite you,
//       'user'   = fetches a page because a person asked an assistant about it,
//       'training' = collects pages to train models.
export const AI_BOTS = [
  { name: 'OAI-SearchBot', vendor: 'OpenAI (ChatGPT search)', role: 'search', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot', live: true },
  { name: 'ChatGPT-User', vendor: 'OpenAI (ChatGPT, user asked)', role: 'user', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', live: true },
  { name: 'Claude-SearchBot', vendor: 'Anthropic (Claude search)', role: 'search', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)', live: true },
  { name: 'Claude-User', vendor: 'Anthropic (Claude, user asked)', role: 'user', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)', live: false },
  { name: 'PerplexityBot', vendor: 'Perplexity', role: 'search', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', live: true },
  { name: 'Perplexity-User', vendor: 'Perplexity (user asked)', role: 'user', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)', live: false },
  { name: 'Googlebot', vendor: 'Google (Search, AI Overviews, AI Mode)', role: 'search', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', live: true },
  { name: 'Bingbot', vendor: 'Microsoft (Bing, Copilot)', role: 'search', ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', live: true },
  { name: 'DuckAssistBot', vendor: 'DuckDuckGo AI answers', role: 'search', ua: 'DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)', live: false },
  { name: 'Applebot', vendor: 'Apple (Siri, Spotlight)', role: 'search', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)', live: false },
  { name: 'GPTBot', vendor: 'OpenAI (model training)', role: 'training', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot', live: true },
  { name: 'ClaudeBot', vendor: 'Anthropic (model training)', role: 'training', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', live: true },
  { name: 'Google-Extended', vendor: 'Google (Gemini training, robots.txt token)', role: 'training', token: true, live: false },
  { name: 'Applebot-Extended', vendor: 'Apple (AI training, robots.txt token)', role: 'training', token: true, live: false },
  { name: 'CCBot', vendor: 'Common Crawl (feeds many AI models)', role: 'training', ua: 'CCBot/2.0 (https://commoncrawl.org/faq/)', live: true },
  { name: 'Meta-ExternalAgent', vendor: 'Meta (AI training)', role: 'training', ua: 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)', live: true },
  { name: 'Amazonbot', vendor: 'Amazon (Alexa, AI)', role: 'training', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/600.2.5 (KHTML, like Gecko) Version/8.0.2 Safari/600.2.5 (Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)', live: false },
  { name: 'Bytespider', vendor: 'ByteDance (AI training, known for heavy crawling)', role: 'training', ua: 'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)', live: true },
];

// Tools that scrape sites with no permission or purpose they will state.
const SCRAPERS = [
  { name: 'python-requests', ua: 'python-requests/2.31.0' },
  { name: 'Scrapy', ua: 'Scrapy/2.11 (+https://scrapy.org)' },
  { name: 'curl', ua: 'curl/8.4.0' },
  { name: 'Go-http-client', ua: 'Go-http-client/1.1' },
  { name: 'Headless Chrome', ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36' },
  { name: 'No User-Agent', ua: '' },
];

/* --------------------------------------------------------------- robots */

/** robots.txt into groups of agents and their rules. */
export function parseRobots(txt) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else if ((k === 'allow' || k === 'disallow') && cur) {
      cur.rules.push({ allow: k === 'allow', path: v });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  return groups;
}

/** What robots.txt says to this bot about the whole site: blocked, partly blocked, or allowed. */
export function robotsVerdict(groups, name) {
  const n = name.toLowerCase();
  let g = groups.find((x) => x.agents.includes(n));
  let via = 'its own rule';
  if (!g) { g = groups.find((x) => x.agents.includes('*')); via = 'the rule for all bots'; }
  if (!g) return { verdict: 'allowed', via: 'no rule' };
  const rules = g.rules.filter((r) => r.path !== '' || !r.allow);
  const blocksAll = rules.some((r) => !r.allow && (r.path === '/' || r.path === '/*'));
  const allowsRoot = rules.some((r) => r.allow && (r.path === '/' || r.path === '/*'));
  if (blocksAll && !allowsRoot) return { verdict: 'blocked', via };
  const some = rules.some((r) => !r.allow && r.path && r.path !== '/');
  return { verdict: some ? 'partly' : 'allowed', via };
}

/* ------------------------------------------------------------- live test */

async function liveStatus(url, ua, timeout = 6000) {
  try {
    const headers = { accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' };
    if (ua) headers['user-agent'] = ua; else headers['user-agent'] = '';
    const res = await fetch(url, { redirect: 'follow', signal: ms(timeout), headers });
    const status = res.status;
    const challenge = /challenge|captcha/i.test(res.headers.get('cf-mitigated') || '') || /just a moment/i.test(res.headers.get('server-timing') || '');
    try { await res.body?.cancel(); } catch { /* not read on purpose */ }
    const blocked = [401, 403, 406, 429, 451].includes(status) || challenge || status === 503 && /cloudflare|sucuri|akamai/i.test(res.headers.get('server') || '');
    return { status, result: blocked ? 'blocked' : status >= 200 && status < 400 ? 'allowed' : 'error' };
  } catch (e) {
    return { status: null, result: 'error', error: e.name === 'TimeoutError' ? 'timed out' : 'no answer' };
  }
}

/* ------------------------------------------------------------ html signals */

const TYPE_RE = /"@type"\s*:\s*(\[[^\]]*\]|"[^"]+")/g;

function jsonLd($) {
  const types = new Set();
  const same = new Set();
  let phone = false, address = false, dates = false, faq = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text() || '';
    let m;
    TYPE_RE.lastIndex = 0;
    while ((m = TYPE_RE.exec(raw))) (m[1].match(/"([^"]+)"/g) || []).forEach((t) => types.add(t.replace(/"/g, '')));
    try {
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (n.sameAs) [].concat(n.sameAs).forEach((u) => typeof u === 'string' && same.add(u));
        if (n.telephone) phone = true;
        if (n.address) address = true;
        if (n.datePublished || n.dateModified) dates = true;
        Object.values(n).forEach(walk);
      };
      walk(JSON.parse(raw));
    } catch { /* invalid JSON-LD still counts as present; the types above were read from the text */ }
  });
  faq = types.has('FAQPage');
  return { types: [...types], sameAs: [...same], phone, address, dates, faq, present: types.size > 0 };
}

const QUESTION = /^(who|what|when|where|why|how|can|could|do|does|did|is|are|should|which|will|am|has|have)\b/i;

function contentSignals($, html) {
  const heads = $('h2, h3').map((_, h) => $(h).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
  const qa = [];
  $('h2, h3').each((_, h) => {
    const t = $(h).text().replace(/\s+/g, ' ').trim();
    if (t && t.length < 150 && (/\?\s*$/.test(t) || QUESTION.test(t))) qa.push({ el: h, t });
  });
  let direct = 0;
  for (const q of qa) {
    const p = $(q.el).nextAll('p, div').first().text().replace(/\s+/g, ' ').trim();
    const w = p ? p.split(/\s+/).length : 0;
    if (w >= 12 && w <= 80) direct++;
  }
  const details = $('details').length;
  const faqEls = $('[class*="faq" i], [id*="faq" i], [itemtype*="FAQPage"]').length;
  const lists = $('ul, ol').length, tables = $('table').length;
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const words = bodyText ? bodyText.split(/\s+/).length : 0;
  const links = $('a[href]').map((_, a) => String($(a).attr('href') || '')).get();
  const social = links.filter((h) => /linkedin\.com|facebook\.com|instagram\.com|youtube\.com|twitter\.com|x\.com\/|wikipedia\.org|wikidata\.org|g\.page|maps\.app\.goo\.gl|google\.[a-z.]+\/maps|pinterest\.com|tiktok\.com/i.test(h));
  const about = links.some((h) => /(^|\/)(about|team|our-story|story|contact)(\/|\.|$|#)/i.test(h));
  const byline = $('[rel="author"], [itemprop="author"], .author, .byline, meta[name="author"]').length > 0 || /\b(written|reviewed|posted|by)\s+[A-Z][a-z]+ [A-Z][a-z]+/.test(bodyText.slice(0, 6000));
  const dates = $('time[datetime], meta[property="article:published_time"], meta[property="article:modified_time"]').length > 0 || /\b(updated|published|last modified)\b.{0,20}\b(20\d\d)\b/i.test(bodyText.slice(0, 6000));
  const tel = $('a[href^="tel:"]').length > 0 || /\+?\d[\d\s().-]{8,}\d/.test(bodyText.slice(0, 4000));
  const addr = $('address, [itemprop="address"]').length > 0;
  const robotsMeta = ($('meta[name="robots"], meta[name="googlebot"]').map((_, m) => $(m).attr('content') || '').get().join(',') || '').toLowerCase();
  const blocksSnippets = /nosnippet|noindex|noai|noimageai|max-snippet:\s*0/.test(robotsMeta) || $('[data-nosnippet]').length > 3;
  const scripts = $('script[src]').length;
  return {
    headings: heads.length, qa: qa.length, qa_samples: qa.slice(0, 4).map((x) => x.t), direct_answers: direct,
    details, faq_blocks: faqEls, lists, tables, words, scripts, social: [...new Set(social)].slice(0, 8), about, byline, dates, tel, addr,
    robots_meta: robotsMeta || null, blocks_snippets: blocksSnippets,
  };
}

/* ----------------------------------------------------------------- probe */

const finding = (id, severity, title, why, fix, extra = {}) => ({ id, category: 'AI visibility', severity, title, why, fix, ...extra });

/**
 * @param ctx { url, html, $, headers }  the homepage as already fetched
 * @returns { findings, facts }  facts go to site.ai; never throws
 */
export async function probeAI(ctx, capMs = 12000) {
  const url = ctx.url;
  let base;
  try { base = new URL(url).origin; } catch { return { findings: [], facts: null }; }
  const $ = ctx.$;

  const sig = contentSignals($, ctx.html || '');
  const ld = jsonLd($);
  const xrobots = String(ctx.headers?.['x-robots-tag'] || '').toLowerCase();
  if (/nosnippet|noindex|noai/.test(xrobots)) sig.blocks_snippets = true;

  // robots.txt, llms.txt and the live User-Agent test, all at once.
  const getText = async (path) => { try { const r = await fetch(base + path, { signal: ms(6000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; StashBot/1.0)' } }); return r.ok ? (await r.text()).slice(0, 400000) : null; } catch { return null; } };
  const jobs = [getText('/robots.txt'), getText('/llms.txt'), getText('/llms-full.txt')];
  const liveBots = AI_BOTS.filter((b) => b.live);
  const baseline = liveStatus(url, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
  const botJobs = liveBots.map((b) => liveStatus(url, b.ua));
  const scrapeJobs = SCRAPERS.map((s) => liveStatus(url, s.ua));

  const all = Promise.all([Promise.all(jobs), baseline, Promise.all(botJobs), Promise.all(scrapeJobs)]);
  const done = await Promise.race([all, new Promise((r) => setTimeout(() => r(null), capMs))]);
  const [[robotsTxt, llms, llmsFull], base0, botLive, scrapeLive] = done || [[null, null, null], null, [], []];

  const groups = parseRobots(robotsTxt);
  const baselineOk = base0?.result === 'allowed';
  const bots = AI_BOTS.map((b) => {
    const rb = robotsTxt == null ? { verdict: 'allowed', via: 'no robots.txt' } : robotsVerdict(groups, b.name);
    const li = liveBots.indexOf(b);
    const live = li >= 0 && baselineOk && botLive[li] ? botLive[li] : null;
    const reachable = rb.verdict !== 'blocked' && (!live || live.result !== 'blocked');
    return { name: b.name, vendor: b.vendor, role: b.role, robots: rb.verdict, robots_via: rb.via, live: live ? live.result : null, status: live?.status ?? null, reachable };
  });
  const scrapers = SCRAPERS.map((s, i) => ({ name: s.name, result: baselineOk && scrapeLive[i] ? scrapeLive[i].result : null, status: scrapeLive[i]?.status ?? null }));
  const scrapersTested = scrapers.filter((s) => s.result);
  const scrapersBlocked = scrapersTested.filter((s) => s.result === 'blocked').length;

  const cite = bots.filter((b) => b.role === 'search' || b.role === 'user');
  const robotsBlockedCite = cite.filter((b) => b.robots === 'blocked');
  const firewallBlockedCite = cite.filter((b) => b.robots !== 'blocked' && b.live === 'blocked');

  /* ------------------------------ findings */
  const f = [];
  if (robotsBlockedCite.length) {
    f.push(finding('ai-search-blocked-robots', 'high', 'robots.txt tells AI search bots to stay out (' + robotsBlockedCite.map((b) => b.name).join(', ') + ')',
      'These bots fetch pages to answer people\'s questions and link to the source. If they are told no, the site cannot be cited by them.',
      'Allow the search and "user asked" bots in robots.txt. You can still block training-only bots separately.', { evidence: robotsBlockedCite.map((b) => b.name + ': ' + b.robots_via).join('; ') }));
  }
  if (firewallBlockedCite.length) {
    f.push(finding('ai-search-blocked-firewall', 'high', 'The site\'s firewall turns away bots named ' + firewallBlockedCite.map((b) => b.name).join(', '),
      'robots.txt allows them, but a request using their name got an error or a challenge page (' + firewallBlockedCite.map((b) => b.name + ' ' + (b.status || '')).join(', ') + '). Real bots can be treated differently, but this is the usual cause of "AI never cites us".',
      'In the firewall or CDN bot settings, allow verified AI search and user-agent bots (in Cloudflare: Security → Bots, or AI Crawl Control).', { evidence: firewallBlockedCite.map((b) => b.name + ' → ' + b.status).join(', ') }));
  }
  if (scrapersTested.length >= 4 && scrapersBlocked === 0) {
    f.push(finding('no-bot-protection', 'low', 'Scrapers and unnamed bots get the page without any check',
      'Generic scraping tools (python-requests, Scrapy, curl, headless browsers, requests with no name) were all served the page. Anyone can copy the content in bulk, and abusive AI crawlers look the same.',
      'Turn on bot management in your CDN or host, or rate-limit and challenge generic scraper User-Agents. Keep verified search and AI bots allowed.', { evidence: scrapersTested.map((s) => s.name + ' ' + s.status).join(', ') }));
  }
  if (!llms) {
    f.push(finding('no-llms-txt', 'low', 'No llms.txt guide for AI assistants',
      'llms.txt is a plain-text summary of the site (who you are, your key pages) that AI assistants can read in one go. It is not required and not every assistant uses it yet, but it is cheap and gives them a clean description of the business.',
      'Add /llms.txt with a short description and links to the key pages (a ready-made one is in this audit).'));
  }
  if (!ld.present) {
    f.push(finding('no-jsonld', 'high', 'No structured data (JSON-LD) on the homepage',
      'Structured data states facts in a form machines read exactly: business name, address, hours, services, FAQs. Without it AI and search engines have to guess from the page text.',
      'Add JSON-LD for the business (LocalBusiness or Organization) and for FAQs and services where they exist.'));
  } else if (!ld.types.some((t) => /^(Organization|LocalBusiness|RealEstateAgent|Store|Restaurant|ProfessionalService|Corporation|Person|HomeAndConstructionBusiness|TravelAgency|LodgingBusiness|Hotel)$/i.test(t))) {
    f.push(finding('no-entity-schema', 'medium', 'Structured data does not describe the business itself',
      'There is JSON-LD (' + ld.types.slice(0, 4).join(', ') + ') but nothing that says who the business is. That is the first thing an AI uses to decide if you are the right answer.',
      'Add an Organization or LocalBusiness block with name, address, phone, logo and links to your profiles (sameAs).'));
  }
  if ((sig.details + sig.faq_blocks >= 2 || sig.qa >= 3) && !ld.faq) {
    f.push(finding('no-faq-schema', 'low', 'Questions and answers on the page are not marked up as FAQ data',
      'You already answer questions on the page. Marking them up lets search and AI read each question and answer as a pair.',
      'Wrap the Q&A in FAQPage JSON-LD (a snippet is included in the fix).'));
  }
  if (sig.qa < 2) {
    f.push(finding('no-qa-headings', 'medium', 'The page does not answer questions in the way people ask them',
      'AI answer engines look for headings phrased as questions ("How much does it cost?") followed by a short, direct answer. Pages written only as brand statements are passed over.',
      'Add a section of 5 to 8 real customer questions as headings, each followed by a 2 to 3 sentence direct answer.'));
  } else if (sig.direct_answers === 0) {
    f.push(finding('no-direct-answers', 'low', 'Question headings are not followed by a short direct answer',
      'An answer engine quotes the first clear sentence or two under a question. Long lead-ins or no text beneath the heading make the page hard to quote.',
      'Start each answer with a one or two sentence direct reply, then add detail.'));
  }
  if (sig.words < 150) {
    f.push(finding('ai-js-only', 'high', 'Almost no text is in the page\'s raw HTML (' + sig.words + ' words)',
      'Most AI crawlers read the HTML as sent and do not run JavaScript. If the content only appears after scripts run, to them the page is nearly empty.',
      'Render the text on the server (static or server-side rendering) so the words are in the HTML the crawler receives.', { evidence: sig.words + ' words, ' + sig.scripts + ' scripts' }));
  }
  if (sig.blocks_snippets) {
    f.push(finding('ai-nosnippet', 'high', 'The page tells search and AI not to quote or index it',
      'A robots meta tag or header (' + (sig.robots_meta || xrobots || 'nosnippet / noindex') + ') stops snippets, previews or indexing. That also stops AI answers from using the page.',
      'Remove nosnippet, noindex, noai and max-snippet:0 from the robots meta tag and the X-Robots-Tag header.'));
  }
  if (!sig.byline && !sig.dates && !ld.dates) {
    f.push(finding('no-author-dates', 'low', 'No author, owner or "last updated" signal',
      'AI systems prefer sources that show who is behind the information and how fresh it is.',
      'Add a visible owner or author line and a "last updated" date on key pages, and datePublished / dateModified in the structured data.'));
  }
  const links = new Set([...ld.sameAs, ...sig.social]);
  if (links.size < 2) {
    f.push(finding('no-entity-links', 'medium', 'Few links tying the brand to its profiles (' + links.size + ' found)',
      'AI assistants confirm a business is real by matching it across the web: Google Business Profile, LinkedIn, Facebook, Instagram, YouTube, Wikipedia. Without those links the brand is harder to recognise as one entity.',
      'Link to every official profile from the site, and list them in sameAs in the Organization structured data.'));
  }
  if (!sig.tel && !sig.addr && !ld.phone && !ld.address) {
    f.push(finding('no-nap', 'low', 'No business name, address and phone in a form machines can read',
      'Assistants that answer local questions ("near me", "in Chikmagalur") look for a consistent name, address and phone number.',
      'Show the address and phone as text on the page, and repeat them in LocalBusiness structured data.'));
  }

  /* ------------------------------ readiness score */
  const okCite = cite.filter((b) => b.reachable).length;
  const access = cite.length ? Math.round(35 * okCite / cite.length) : 35;
  const typeBonus = (re) => ld.types.some((t) => re.test(t));
  const structured = Math.min(20, (typeBonus(/Organization|LocalBusiness|Agent|Store|Business|Service|Hotel|Restaurant|Corporation/i) ? 8 : 0)
    + (typeBonus(/^WebSite$/i) ? 2 : 0) + (ld.faq ? 4 : 0) + (typeBonus(/Breadcrumb/i) ? 2 : 0) + (typeBonus(/Article|Product|Service|Review|Offer|Place/i) ? 4 : 0));
  const answer = Math.min(20, (sig.qa >= 3 ? 8 : sig.qa >= 1 ? 4 : 0) + (sig.direct_answers >= 2 ? 6 : sig.direct_answers ? 3 : 0) + (sig.lists + sig.tables >= 2 ? 3 : 0) + (sig.details + sig.faq_blocks >= 2 ? 3 : 0));
  const trust = Math.min(15, ((sig.byline || sig.dates || ld.dates) ? 5 : 0) + (links.size >= 2 ? 5 : links.size ? 2 : 0) + ((sig.tel || ld.phone) && (sig.addr || ld.address) ? 3 : (sig.tel || ld.phone) ? 1 : 0) + (sig.about ? 2 : 0));
  const crawl = Math.min(10, (sig.words >= 300 ? 5 : sig.words >= 150 ? 3 : 0) + (sig.blocks_snippets ? 0 : 3) + (llms ? 2 : 0));
  const score = access + structured + answer + trust + crawl;

  const brand = (ctx.title || '').split(/\s*[|–—]\s*|\s+-\s+|:\s+/).map((x) => x.trim()).filter(Boolean);
  const facts = {
    score,
    parts: {
      access: { got: access, of: 35, label: 'Bots can reach you' },
      structured: { got: structured, of: 20, label: 'Machine-readable facts' },
      answer: { got: answer, of: 20, label: 'Answer-ready content' },
      trust: { got: trust, of: 15, label: 'Trust and identity' },
      crawl: { got: crawl, of: 10, label: 'Crawlable content' },
    },
    bots,
    scrapers,
    baseline: base0 ? { status: base0.status, ok: baselineOk } : null,
    llms_txt: !!llms,
    llms_full: !!llmsFull,
    robots_found: robotsTxt != null,
    schema_types: ld.types.slice(0, 12),
    same_as: [...links].slice(0, 8),
    signals: { qa: sig.qa, qa_samples: sig.qa_samples, direct_answers: sig.direct_answers, faq: sig.details + sig.faq_blocks, lists: sig.lists, tables: sig.tables, words: sig.words, byline: sig.byline, dates: sig.dates || ld.dates, phone: sig.tel || ld.phone, address: sig.addr || ld.address, about_links: sig.about, robots_meta: sig.robots_meta },
    prompts: brand.length ? { category: brand[0], brand: brand[brand.length > 1 ? brand.length - 1 : 0] } : null,
  };
  f.sort((a, b) => (SEV[b.severity] || 0) - (SEV[a.severity] || 0));
  return { findings: f, facts };
}
