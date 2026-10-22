// A white-hat backlink plan for one audited site. Pure and offline: it uses
// what the audit already knows (name, industry cues, existing profile links,
// structured data) to produce a ranked list of places to earn links, the exact
// Google searches that find real prospects, and outreach templates.
//
// It never promises rankings and never suggests buying links, link swaps at
// scale, private blog networks or automated posting: Google's spam policies
// treat those as violations, and they are the usual cause of manual penalties.

const INDUSTRY_CUES = {
  'real-estate': /real.?estate|propert|plots?|villas?|apartments?|realtor|builder|developer|land\b|homes?\b/i,
  hospitality: /restaurant|cafe|caf[eé]|hotel|resort|travel|tour|stay|bar\b|catering/i,
  health: /clinic|dental|doctor|hospital|wellness|fitness|gym|spa|salon|beauty|yoga|physio/i,
  professional: /law|legal|advocate|account|tax|finance|consult|advis|insurance|architect/i,
  saas: /saas|software|platform|app\b|api\b|dashboard|automation|ai\b/i,
  ecommerce: /shop|store|e-?commerce|buy online|fashion|jewel|furniture/i,
  education: /school|course|academy|tutor|coaching|training|institute|university/i,
  local: /plumb|electric|repair|cleaning|contractor|pest|movers|interior|renovat|carpent|paint/i,
  agency: /agency|studio|portfolio|design|marketing|freelanc|developer/i,
  nonprofit: /non-?profit|charity|ngo|foundation|trust\b|community|temple|church/i,
};

const NOUN = {
  'real-estate': 'real estate', hospitality: 'hospitality', health: 'healthcare', professional: 'professional services',
  saas: 'software', ecommerce: 'online store', education: 'education', local: 'local services', agency: 'creative agency', nonprofit: 'non-profit', general: 'business',
};

const PROFILE_LINKS = [
  ['Google Business Profile', 'Free. The single most valuable local listing; also feeds Maps and AI answers.', /google\.com\/maps|g\.page|business\.google/],
  ['LinkedIn page', 'A company page that links back to the site.', /linkedin\.com\/company/],
  ['Facebook page', 'Public page with the website field filled in.', /facebook\.com/],
  ['Instagram', 'Profile link in the bio.', /instagram\.com/],
  ['YouTube channel', 'Channel About page links to the site.', /youtube\.com|youtu\.be/],
  ['X / Twitter', 'Profile website field.', /(twitter|x)\.com\//],
];

const INDUSTRY_CHANNELS = {
  'real-estate': [
    ['Property portals', 'List projects on the major property portals (99acres, MagicBricks, Housing.com) with the site linked on the developer profile.', 'quick', 'high'],
    ['Industry and regulator bodies', 'Membership pages of builder and agent associations (for example CREDAI or NAREDCO chapters) and your state RERA listing link to member sites.', 'half-day', 'high'],
    ['Local area guides', 'Publish neighbourhood and price-trend pages worth citing, then pitch them to local news and community blogs.', 'bigger', 'high'],
  ],
  hospitality: [
    ['Review and travel sites', 'Claim Tripadvisor, Zomato, Google and local food-blog listings, each with the website field filled in.', 'quick', 'high'],
    ['Local food and travel bloggers', 'Invite local creators for a visit; ask for an honest write-up with a link.', 'half-day', 'medium'],
  ],
  health: [
    ['Health directories', 'Claim the clinic on the main medical directories (Practo, Justdial Health or your country\'s equivalents) with the website filled in.', 'quick', 'high'],
    ['Expert quotes', 'Offer doctor-reviewed quotes to health writers; a link to the practitioner page is the usual credit.', 'half-day', 'high'],
  ],
  professional: [
    ['Professional bodies', 'Bar council, institute and chamber of commerce member directories link to member sites.', 'half-day', 'high'],
    ['Legal and finance guides', 'Publish a clear guide to a question clients ask, then pitch it as a resource to local journalists and associations.', 'bigger', 'high'],
  ],
  saas: [
    ['Software directories', 'Submit to G2, Capterra, Product Hunt, AlternativeTo and relevant "awesome" lists on GitHub.', 'quick', 'high'],
    ['Integration and partner pages', 'Ask every tool you integrate with for a listing in their marketplace or partner directory.', 'half-day', 'high'],
    ['Free tool or template', 'A genuinely useful calculator or template earns links without outreach.', 'bigger', 'high'],
  ],
  ecommerce: [
    ['Supplier and brand pages', 'Brands you stock often have a "where to buy" page that links to retailers.', 'quick', 'high'],
    ['Gift guides and roundups', 'Pitch your product to bloggers who publish seasonal gift guides.', 'half-day', 'medium'],
  ],
  education: [
    ['Education directories', 'Course and institute listings, scholarship and career-guidance sites.', 'quick', 'medium'],
    ['Alumni and partner links', 'Ask partner companies, alumni and affiliated bodies to link to the programme page.', 'half-day', 'medium'],
  ],
  local: [
    ['Home-services directories', 'Justdial, Sulekha, UrbanClap-style marketplaces and local chamber listings (use whichever are active in the client\'s country).', 'quick', 'high'],
    ['Supplier and manufacturer pages', 'Brands whose products you install often list approved installers with a link.', 'quick', 'high'],
  ],
  agency: [
    ['Case-study backlinks', 'Every client site you built can credit you in the footer with a short, honest "site by" link, plus a case study on your own site.', 'quick', 'high'],
    ['Design galleries', 'Submit finished work to design showcase and award sites.', 'half-day', 'medium'],
  ],
  nonprofit: [
    ['Community and government pages', 'Local council, university and volunteer-matching sites often link to registered organisations.', 'half-day', 'high'],
  ],
};

export function detectIndustry(text) {
  let best = 'general', n = 0;
  for (const [k, re] of Object.entries(INDUSTRY_CUES)) {
    const m = String(text || '').match(new RegExp(re.source, 'gi'));
    if (m && m.length > n) { best = k; n = m.length; }
  }
  return best;
}

const BRAND_SPLIT = /\s*[|–—]\s*|\s+-\s+|:\s+/;

/**
 * @param audit { url, title, site: { ai, pages } }
 * @param opts  { industry?, city? }
 */
export function backlinkPlan(audit, opts = {}) {
  const site = audit.site || {};
  const host = (() => { try { return new URL(audit.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const parts = String(audit.title || '').split(BRAND_SPLIT).map((x) => x.trim()).filter(Boolean);
  const brand = site.ai?.prompts?.brand || parts[parts.length - 1] || host;
  const cue = [audit.title, host, ...(site.pages || []).map((p) => p.title || '')].join(' ');
  const industry = opts.industry && NOUN[opts.industry] ? opts.industry : detectIndustry(cue);
  const noun = NOUN[industry];
  const city = opts.city || '[city]';

  // Profiles the site already links (from the AI-visibility read) vs not.
  const have = new Set((site.ai?.same_as || []).map(String));
  const haveAny = (re) => [...have].some((u) => re.test(u));
  const profiles = PROFILE_LINKS.map(([name, why, re]) => ({ name, why, done: haveAny(re) }));

  const channels = [];
  const push = (id, title, why, how, effort, impact, queries = []) => channels.push({ id, title, why, how, effort, impact, queries });

  push('profiles', 'Claim every official profile and link both ways',
    'These are the easiest links to get, and they tell Google and AI assistants your business is one real, consistent entity.',
    'Create or claim each profile below, use the exact same name, address and phone everywhere, put the site in the website field, then link back to each profile from the site footer and list them in the Organization sameAs structured data.',
    'quick', 'high');
  push('citations', 'Local business citations (name, address, phone)',
    'Consistent listings on trusted directories support local rankings, and each carries a link.',
    'Pick 10–15 real directories for the client\'s country and category. Keep the name, address and phone identical to the Google Business Profile. Skip bulk-submission services and low-quality directories.',
    'half-day', 'high',
    [`"${noun}" "add your business" ${city}`, `"${noun}" directory ${city} "submit"`]);
  for (const [t, how, effort, impact] of INDUSTRY_CHANNELS[industry] || []) {
    push('industry-' + t.toLowerCase().replace(/[^a-z]+/g, '-'), t, 'Specific to ' + noun + ' sites, so the links are relevant as well as trusted.', how, effort, impact);
  }
  push('unlinked-mentions', 'Turn mentions into links',
    'If someone already wrote about the business without linking, a polite request is the highest-converting outreach there is.',
    'Search for the brand name excluding the site itself, open each result, and ask the author to add a link where the name appears.',
    'quick', 'high',
    [`"${brand}" -site:${host}`, `intext:"${brand}" -site:${host} -inurl:facebook -inurl:instagram`]);
  push('competitor-links', 'Copy links your competitors already have',
    'Any site that links to two or three competitors is a proven prospect.',
    'Search Console\'s Links report shows who links to you. For competitors, use the free prospect searches below, or a free Ahrefs Webmaster Tools account for your own verified site. Then pitch the sites that list or link the others.',
    'half-day', 'high',
    [`"${noun}" ${city} "best" OR "top" OR "list of" -site:${host}`, `intitle:"${noun}" ${city} "resources" OR "useful links"`]);
  push('resource-pages', 'Get listed on resource and "useful links" pages',
    'Curated resource pages exist to link out. They are a natural fit when the client\'s page really is useful.',
    'Find the pages with the searches below, check the page is maintained, and suggest one specific page of the client\'s site with one sentence on why readers would want it.',
    'half-day', 'medium',
    [`intitle:"resources" "${noun}" ${city}`, `inurl:links "${noun}" ${city}`, `"useful links" "${noun}" ${city}`]);
  push('broken-links', 'Replace dead links with yours',
    'Webmasters like being told about a broken link, especially when you offer a working replacement.',
    'On resource pages found above, check the links (a free browser extension such as Check My Links does it), then email the owner the dead link and your closest page.',
    'half-day', 'medium');
  push('guest-content', 'Guest articles and expert quotes',
    'A real article or quote on a relevant site is a durable, editorial link.',
    'Offer one specific topic the client knows better than anyone, with a clear angle. Only write for sites you would be proud to be seen on. Use journalist-request services to answer reporters\' questions with real expertise.',
    'bigger', 'high',
    [`"${noun}" "write for us" ${city}`, `"${noun}" "guest post" "contribute"`, `"${noun}" "submit an article" ${city}`]);
  push('link-asset', 'Create one piece worth linking to',
    'Links come to pages that offer something others cannot copy: local data, a calculator, a checklist, a survey, a guide with original photos.',
    'Pick one asset for the client (see ideas below), publish it on the site with clear sources, then promote it to the prospects found above.',
    'bigger', 'high');
  push('partners', 'Links from real relationships',
    'Suppliers, customers, partners, associations and local events already know the business. These links are earned in a message, not a campaign.',
    'List every supplier, partner, charity, sponsorship and event the business is part of. Ask each to link from their partner, sponsor or members page.',
    'quick', 'high');

  const ideas = {
    'real-estate': ['Price per square foot by area, updated quarterly', 'A buyer\'s checklist for legal and registration steps in ' + city, 'Map of upcoming infrastructure projects near each development', 'EMI and stamp-duty calculator'],
    hospitality: ['A local food or travel guide with original photos', 'Seasonal menu or festival calendar for ' + city, 'Behind-the-scenes sourcing story with named suppliers'],
    health: ['Doctor-reviewed guide to a common question patients ask', 'Symptom or recovery timeline explainer', 'Free self-check checklist with sources'],
    professional: ['Plain-English guide to a rule that changed this year', 'Cost calculator or document checklist', 'Annual survey of local clients with published results'],
    saas: ['Free calculator or template', 'Public benchmark report from anonymised usage data', 'Integration guides other tools can link to'],
    ecommerce: ['Buying guide with real comparison photos', 'Size, care or compatibility chart', 'Annual trends report from your own sales data'],
    education: ['Career-path or salary guide for the subject', 'Free study plan or syllabus download', 'Alumni outcomes report'],
    local: ['Cost guide for common jobs in ' + city, 'Seasonal maintenance checklist', 'Before-and-after case studies with permission'],
    agency: ['Open case study with results', 'Free template or audit checklist', 'Original research on the clients\' industry'],
    nonprofit: ['Annual impact report with numbers', 'Volunteer guide', 'Local needs data others can cite'],
    general: ['A guide that answers the question customers ask most', 'Original local data or survey', 'A free calculator or checklist'],
  }[industry];

  const templates = [
    {
      name: 'Unlinked mention',
      subject: 'Quick favour about your ' + brand + ' mention',
      body: `Hi [name],\n\nThanks for mentioning ${brand} in "[article title]". I noticed the name isn't linked to our site. Would you mind adding a link to ${audit.url}? It helps readers find us.\n\nThanks again,\n[your name]`,
    },
    {
      name: 'Resource page',
      subject: 'A suggestion for your [page title] page',
      body: `Hi [name],\n\nI was using your page "[page title]" and found it genuinely useful. We published [specific page] at [URL], which covers [one-sentence benefit] and might suit your readers.\n\nNo worries if it isn't a fit. Thanks for keeping the list up to date.\n\n[your name], ${brand}`,
    },
    {
      name: 'Broken link',
      subject: 'Broken link on [page title]',
      body: `Hi [name],\n\nWhile reading "[page title]" I found a link that no longer works: [dead URL]. In case it helps, our page [URL] covers the same topic and could replace it.\n\nHope that's useful,\n[your name]`,
    },
  ];

  const avoid = [
    'Buying links or paying for "guest posts" on link farms. Google\'s spam policies cover this, and manual penalties are slow to lift.',
    'Private blog networks, link exchanges at scale and comment or forum spam.',
    'Bulk directory submission services and any tool that posts automatically.',
    'Exact-match keyword anchor text everywhere. Most links should simply use the brand name or the page title.',
    'Promising the client a ranking or a link count. Report what was earned and the pages that grew.',
  ];

  const measure = [
    'Google Search Console → Links: new linking sites each month',
    'Search Console → Performance: impressions and clicks for the pages you promoted',
    'Google Business Profile: calls, direction requests and website clicks',
    'A simple sheet of every prospect: site, date contacted, result, link URL',
  ];

  return { brand, host, industry, noun, city_known: city !== '[city]', profiles, channels, ideas, templates, avoid, measure };
}
