// How to fix what an audit finds: short steps, copy-ready code, docs and a
// way to check the fix. Plain data, no network, safe to import in the browser.
// Keyed by technical check id (the part after "check:" in a plan item key).

const MDN = 'https://developer.mozilla.org/en-US/docs/Web/';
const HDR = (name, value) => ({
  Cloudflare: 'Cloudflare → Rules → Transform Rules → Modify Response Header → Set static\n  Header name:  ' + name + '\n  Value:        ' + value,
  Vercel: '// vercel.json\n{ "headers": [{ "source": "/(.*)", "headers": [\n  { "key": "' + name + '", "value": "' + value.replace(/"/g, '\\"') + '" }\n] }] }',
  Nginx: 'add_header ' + name + ' "' + value + '" always;',
});

export function verifyLinks(ctx) {
  const host = ctx.host, url = ctx.url;
  return {
    headers: ['Scan security headers', 'https://securityheaders.com/?q=' + encodeURIComponent(host) + '&followRedirects=on', 'Grades every response header'],
    ssl: ['SSL Labs report', 'https://www.ssllabs.com/ssltest/analyze.html?d=' + encodeURIComponent(host), 'Certificate and TLS setup'],
    psi: ['PageSpeed Insights', 'https://pagespeed.web.dev/analysis?url=' + encodeURIComponent(url), 'Speed, weight and Core Web Vitals'],
    wave: ['Scan with WAVE', 'https://wave.webaim.org/report#/' + url, 'Accessibility errors on the page'],
    validator: ['W3C validator', 'https://validator.w3.org/nu/?doc=' + encodeURIComponent(url), 'Checks the markup'],
    gsc: ['Google Search Console', 'https://search.google.com/search-console', 'Indexing and search queries'],
    rich: ['Rich results test', 'https://search.google.com/test/rich-results?url=' + encodeURIComponent(url), 'Structured data check'],
    dmarc: ['DMARC lookup', 'https://mxtoolbox.com/SuperTool.aspx?action=dmarc%3a' + encodeURIComponent(host), 'Email spoofing protection'],
    squoosh: ['Compress in Squoosh', 'https://squoosh.app/', 'Free, runs in your browser'],
    safebrowsing: ['Safe Browsing report', 'https://transparencyreport.google.com/safe-browsing/search?url=' + encodeURIComponent(url), 'What Google says about the site'],
    schema: ['Schema.org validator', 'https://validator.schema.org/#url=' + encodeURIComponent(url), 'Reads the structured data on the page'],
    robots: ['Open robots.txt', url.replace(/\/$/, '') + '/robots.txt', 'See exactly what bots are told'],
    llms: ['Open llms.txt', url.replace(/\/$/, '') + '/llms.txt', 'Should show the text once added'],
    share: ['Check the share preview', 'https://www.opengraph.xyz/url/' + encodeURIComponent(url), 'How links look when shared'],
  };
}

// Which verify links suit each check, by name.
const VERIFY = {
  'no-hsts': ['headers', 'ssl'], 'weak-hsts': ['headers', 'ssl'], 'no-csp': ['headers'], 'weak-csp': ['headers'],
  'no-frame-protection': ['headers'], 'missing-minor-headers': ['headers'], 'server-version-exposed': ['headers'],
  'cors-open-credentials': ['headers'], 'insecure-cookies': ['headers'], 'tls-invalid': ['ssl'], 'tls-expiring': ['ssl'], 'old-tls': ['ssl'],
  'no-http-redirect': ['ssl', 'headers'], 'www-duplicate': ['headers'], 'mixed-content': ['headers', 'psi'],
  'heavy-images': ['psi', 'squoosh'], 'legacy-image-formats': ['psi', 'squoosh'], 'img-not-lazy': ['psi'], 'img-no-dimensions': ['psi'],
  'slow-server': ['psi'], 'no-compression': ['psi'], 'no-compression-assets': ['psi'], 'weak-caching': ['psi'], 'many-scripts': ['psi'], 'heavy-html': ['psi'],
  'labels-not-linked': ['wave'], 'unlabeled-inputs': ['wave'], 'heading-skips': ['wave'], 'no-h1': ['wave'], 'multiple-h1': ['wave'], 'img-no-alt': ['wave'],
  'empty-buttons': ['wave'], 'empty-links': ['wave'], 'no-lang': ['wave', 'validator'], 'no-main-landmark': ['wave'],
  'no-meta-description': ['gsc'], 'meta-description-length': ['gsc'], 'no-title': ['gsc'], 'title-length': ['gsc'], 'no-canonical': ['gsc'],
  'no-sitemap': ['gsc'], 'no-robots': ['gsc'], 'robots-blocks-all': ['gsc'], 'soft-404': ['gsc'], 'no-structured-data': ['rich'],
  'no-share-preview': ['share'], 'no-spf': ['dmarc'], 'no-dmarc': ['dmarc'], 'weak-dmarc': ['dmarc'], 'broken-links': ['psi'],
};
const CATEGORY_VERIFY = { 'AI visibility': ['schema'], Security: ['headers'], Privacy: ['headers'], SEO: ['gsc'], Performance: ['psi'], Accessibility: ['wave'], Trust: ['headers'] };

const DOCS = {
  'no-hsts': [['MDN: Strict-Transport-Security', MDN + 'HTTP/Reference/Headers/Strict-Transport-Security'], ['hstspreload.org', 'https://hstspreload.org/']],
  'no-csp': [['MDN: CSP guide', MDN + 'HTTP/Guides/CSP'], ['CSP evaluator', 'https://csp-evaluator.withgoogle.com/']],
  'no-frame-protection': [['MDN: frame-ancestors', MDN + 'HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors'], ['OWASP: Clickjacking defense', 'https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html']],
  'missing-minor-headers': [['MDN: Referrer-Policy', MDN + 'HTTP/Reference/Headers/Referrer-Policy'], ['MDN: Permissions-Policy', MDN + 'HTTP/Reference/Headers/Permissions-Policy']],
  'no-security-txt': [['securitytxt.org generator', 'https://securitytxt.org/'], ['RFC 9116', 'https://www.rfc-editor.org/rfc/rfc9116']],
  'heavy-images': [['web.dev: choose an image format', 'https://web.dev/articles/choose-the-right-image-format'], ['MDN: responsive images', MDN + 'HTML/Guides/Responsive_images']],
  'labels-not-linked': [['W3C: Labeling controls', 'https://www.w3.org/WAI/tutorials/forms/labels/'], ['MDN: the label element', MDN + 'HTML/Reference/Elements/label']],
  'heading-skips': [['W3C: Headings', 'https://www.w3.org/WAI/tutorials/page-structure/headings/']],
  'img-no-alt': [['W3C: Images tutorial', 'https://www.w3.org/WAI/tutorials/images/']],
  'no-meta-description': [['Google: meta descriptions', 'https://developers.google.com/search/docs/appearance/snippet']],
  'no-sitemap': [['Google: build a sitemap', 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap']],
  'no-structured-data': [['Google: structured data intro', 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data']],
  'no-dmarc': [['dmarc.org overview', 'https://dmarc.org/overview/']],
};
const ALIAS = {
  'weak-hsts': 'no-hsts', 'weak-csp': 'no-csp', 'legacy-image-formats': 'heavy-images', 'unlabeled-inputs': 'labels-not-linked',
  'no-h1': 'heading-skips', 'multiple-h1': 'heading-skips', 'weak-dmarc': 'no-dmarc', 'no-spf': 'no-dmarc', 'meta-description-length': 'no-meta-description',
};
for (const [alias, to] of Object.entries(ALIAS)) DOCS[alias] = DOCS[to];

const STEPS = {
  'no-hsts': [['Confirm https works everywhere', 'The certificate must be valid and http must already redirect to https.'], ['Start with a short lifetime', 'Use max-age=86400 for a day, then raise it.'], ['Raise to one year', 'Switch to max-age=31536000; includeSubDomains once every subdomain uses https.']],
  'no-csp': [['Run it in report-only', 'The browser logs what would be blocked without blocking anything.'], ['Fix the violations', 'Allow your own domain, analytics, fonts and maps.'], ['Enforce', 'Rename the header to Content-Security-Policy once the console is quiet for a week.']],
  'no-frame-protection': [['Decide who may frame the site', 'Usually nobody. Allow only your own domain if you embed your own pages.'], ['Add the header', 'frame-ancestors in CSP is the modern way; X-Frame-Options covers old browsers.'], ['Re-scan', 'The framing warning should clear.']],
  'missing-minor-headers': [['Add the headers', 'They can share one rule with HSTS.'], ['Re-scan', 'The grade should move up a step.']],
  'no-security-txt': [['Create the file', 'Put it at /.well-known/security.txt.'], ['Set an expiry', 'Renew it once a year.']],
  'heavy-images': [['Find the heavy images', 'Run PageSpeed Insights and open "Properly size images".'], ['Resize and compress', 'Export at the displayed width as WebP or AVIF, quality around 75.'], ['Lazy-load below the fold', 'Add loading="lazy" plus width and height to avoid layout shift.']],
  'legacy-image-formats': [['Convert', 'Use Squoosh or your build tool to make AVIF and WebP copies.'], ['Serve with a fallback', 'Wrap them in picture so older browsers still get a JPEG.']],
  'labels-not-linked': [['Find the fields', 'Open each form and list every input.'], ['Connect each label', 'Give the input an id and point the label at it with for.'], ['Re-scan', 'Run WAVE; the orphaned label errors should be gone.']],
  'heading-skips': [['List the headings', 'Use a headings outline extension or the WAVE structure tab.'], ['Close the gaps', 'Never jump more than one level; restyle with CSS instead of changing the tag.']],
  'no-dmarc': [['Publish SPF and DKIM first', 'Your email provider lists the exact records.'], ['Add a DMARC record', 'Start with p=none and a report address, then move to quarantine.']],
  'no-sitemap': [['Generate a sitemap', 'Most site builders and frameworks can produce sitemap.xml.'], ['Submit it', 'Add the URL in Search Console and reference it from robots.txt.']],
  'no-meta-description': [['Write one per page', 'About 120 to 155 characters, naming the offer and place.'], ['Add it to the head', 'One meta description tag per page.']],
};
for (const [alias, to] of Object.entries(ALIAS)) if (!STEPS[alias]) STEPS[alias] = STEPS[to];

const CSP = HDR('Content-Security-Policy-Report-Only', "default-src 'self'; img-src 'self' data: https:; script-src 'self' https://www.googletagmanager.com; frame-ancestors 'self'");
const HSTS = HDR('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
const IMG = { HTML: '<img src="hero-1200.webp"\n     srcset="hero-640.webp 640w, hero-1200.webp 1200w"\n     sizes="(max-width: 700px) 100vw, 1200px"\n     width="1200" height="675" loading="lazy" alt="Describe the picture">' };
const LABEL = { HTML: '<label for="phone">Phone or WhatsApp</label>\n<input id="phone" name="phone" type="tel" autocomplete="tel">', React: '<label htmlFor="phone">Phone or WhatsApp</label>\n<input id="phone" name="phone" type="tel" autoComplete="tel" />' };
const CODE = {
  'no-hsts': HSTS, 'weak-hsts': HSTS, 'no-csp': CSP, 'weak-csp': CSP,
  'no-frame-protection': HDR('Content-Security-Policy', "frame-ancestors 'self'"),
  'missing-minor-headers': {
    Cloudflare: 'X-Content-Type-Options: nosniff\nReferrer-Policy: strict-origin-when-cross-origin\nPermissions-Policy: camera=(), microphone=(), geolocation=()',
    Vercel: '{ "key": "X-Content-Type-Options", "value": "nosniff" },\n{ "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },\n{ "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }',
    Nginx: 'add_header X-Content-Type-Options "nosniff" always;\nadd_header Referrer-Policy "strict-origin-when-cross-origin" always;\nadd_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
  },
  'heavy-images': IMG,
  'legacy-image-formats': { HTML: '<picture>\n  <source srcset="photo.avif" type="image/avif">\n  <source srcset="photo.webp" type="image/webp">\n  <img src="photo.jpg" alt="Describe the picture" width="1200" height="800">\n</picture>' },
  'labels-not-linked': LABEL, 'unlabeled-inputs': LABEL,
  'heading-skips': { HTML: '<h2>How it works</h2>\n  <h3>Step 1: Share your brief</h3>  <!-- not h4 -->' },
  'no-meta-description': { HTML: '<meta name="description" content="Plain-language summary of this page, 120 to 155 characters.">' },
  'img-no-alt': { HTML: '<img src="estate.jpg" alt="Coffee estate walkway at sunrise">' },
};


// What each problem means for the client's business, in words they would use.
const MEANING = {
  'no-hsts': 'On shared Wi-Fi, a visitor can be silently pushed to a fake copy of your site. They lose trust in you, not in the Wi-Fi.',
  'weak-hsts': 'The https promise to browsers is too short-lived to protect repeat visitors.',
  'no-csp': 'If a plugin or ad script is ever compromised, it can read what your visitors type into your enquiry form.',
  'weak-csp': 'The browser-side safety net exists but has gaps a compromised script could use.',
  'no-frame-protection': 'Someone can disguise your site inside theirs and steer visitors into clicking things they did not mean to.',
  'missing-minor-headers': 'Small leaks of visitor information and browser features you do not use. Low risk, quick to close.',
  'no-security-txt': 'If someone finds a hole in your site, they have no way to tell you privately.',
  'heavy-images': 'Phone visitors on mobile data wait longer for the first screen. Many leave before they see your offer.',
  'legacy-image-formats': 'Your pictures are bigger than they need to be, so every page loads slower than it could.',
  'labels-not-linked': 'Screen-reader users cannot tell what each form box is for, and tapping a label does not select its box. Fewer finished enquiries.',
  'unlabeled-inputs': 'Visitors using assistive tools cannot fill in your form. That is lost enquiries and a legal risk.',
  'heading-skips': 'Screen-reader users and Google find the page harder to follow, which can cost search ranking.',
  'no-h1': 'Google gets no clear statement of what the page is about, so it ranks it less confidently.',
  'multiple-h1': 'The page sends Google mixed signals about its main topic.',
  'img-no-alt': 'Pictures are invisible to Google image search and to blind visitors.',
  'no-meta-description': 'Google writes its own search snippet, usually a worse one, so fewer people click through.',
  'no-sitemap': 'Google finds new pages more slowly, so updates take longer to show in search.',
  'no-robots': 'Search engines have no instructions on what to crawl.',
  'robots-blocks-all': 'The site is asking search engines to ignore it. This can remove you from Google.',
  'no-structured-data': 'Google cannot show stars, prices, opening hours or business details in results.',
  'no-spf': 'Anyone can send email that appears to come from your domain, and your real emails may land in spam.',
  'no-dmarc': 'Scam emails pretending to be you will not be stopped, and your genuine emails are more likely to hit spam.',
  'weak-dmarc': 'Scam emails pretending to be you are reported but not blocked.',
  'tls-expiring': 'When the certificate expires, browsers show a red warning and visitors will not get through to your site.',
  'tls-invalid': 'Browsers are warning visitors the site is not safe. Most will leave.',
  'no-http-redirect': 'Visitors who type the address without https can land on an insecure copy.',
  'slow-server': 'The site starts slowly before anything appears. Visitors and Google both notice.',
  'broken-links': 'Visitors hit dead ends, and Google reads broken links as a neglected site.',
  'trackers-no-consent': 'Tracking visitors without asking can breach privacy law and erode trust.',
  'no-privacy-policy': 'Visitors, and the law, expect to see how you handle their details when they send an enquiry.',
  'weak-caching': 'Returning visitors re-download things they already have, so the site feels slower every time.',
  'no-compression': 'Pages travel at full size, so they load slower than they need to.',
  'mixed-content': 'Browsers may block parts of the page or show a warning that it is not fully secure.',
};
const CATEGORY_MEANING = {
  'AI visibility': 'AI assistants such as ChatGPT, Claude, Perplexity and Google\'s AI pick a few sources to quote. This affects how often yours is one of them.',
  Security: 'A weakness that makes it easier for someone to misuse the site or its visitors.',
  Privacy: 'A gap in how visitor details are handled, with trust and legal risk.',
  SEO: 'Google understands the site less well, which costs visits from search.',
  Performance: 'The site loads slower than it should, and slow sites lose visitors.',
  Accessibility: 'Some visitors cannot use part of the site, which means lost enquiries.',
};


/* ------------------------------------------------------------- AI visibility */

const AI = {
  verify: {
    'ai-search-blocked-robots': ['robots'], 'ai-search-blocked-firewall': ['headers'], 'no-bot-protection': [],
    'no-llms-txt': ['llms'], 'no-jsonld': ['schema', 'rich'], 'no-entity-schema': ['schema', 'rich'], 'no-faq-schema': ['schema', 'rich'],
    'no-qa-headings': [], 'no-direct-answers': [], 'ai-js-only': ['psi'], 'ai-nosnippet': ['headers'], 'no-author-dates': [], 'no-entity-links': ['schema'], 'no-nap': ['schema'],
  },
  docs: {
    'ai-search-blocked-robots': [['OpenAI crawlers and how to control them', 'https://platform.openai.com/docs/bots'], ['Perplexity crawlers', 'https://docs.perplexity.ai/guides/bots']],
    'ai-search-blocked-firewall': [['Cloudflare: bot management', 'https://developers.cloudflare.com/bots/'], ['OpenAI crawlers', 'https://platform.openai.com/docs/bots']],
    'no-bot-protection': [['Cloudflare: bot management', 'https://developers.cloudflare.com/bots/']],
    'no-llms-txt': [['llmstxt.org: the proposal', 'https://llmstxt.org/']],
    'no-jsonld': [['Google: structured data intro', 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data'], ['schema.org: LocalBusiness', 'https://schema.org/LocalBusiness']],
    'no-entity-schema': [['Google: organisation markup', 'https://developers.google.com/search/docs/appearance/structured-data/organization'], ['schema.org: LocalBusiness', 'https://schema.org/LocalBusiness']],
    'no-faq-schema': [['Google: FAQ markup', 'https://developers.google.com/search/docs/appearance/structured-data/faqpage']],
    'ai-js-only': [['Google: JavaScript and search', 'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics']],
    'ai-nosnippet': [['Google: robots meta tag', 'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag']],
    'no-qa-headings': [['Google: AI features and your site', 'https://developers.google.com/search/docs/appearance/ai-features']],
    'no-entity-links': [['schema.org: sameAs', 'https://schema.org/sameAs']],
    'no-nap': [['schema.org: LocalBusiness', 'https://schema.org/LocalBusiness']],
  },
  steps: {
    'ai-search-blocked-robots': [['Open robots.txt', 'Find the Disallow lines under the bots named above, or under "User-agent: *" with "Disallow: /".'], ['Allow the search and "user asked" bots', 'Give each its own group with Allow: /. Keep training-only bots blocked if you prefer.'], ['Check it', 'Reload /robots.txt and re-run the audit.']],
    'ai-search-blocked-firewall': [['Open your firewall or CDN bot settings', 'In Cloudflare: Security → Bots (or AI Crawl Control). Other hosts: the WAF or bot rules.'], ['Allow verified AI search bots', 'Allow by verified bot category rather than by name, so impostors do not get through.'], ['Re-run the audit', 'The bot access table should show them reachable.']],
    'no-bot-protection': [['Turn on bot management', 'Use your CDN\'s bot fight or bot management mode.'], ['Challenge generic scrapers', 'A rule that challenges requests with no name or with python, Scrapy or curl names, leaving verified bots alone.'], ['Watch for false positives', 'Check your own tools and uptime monitors still get in.']],
    'no-llms-txt': [['Create the file', 'Save the text below as llms.txt in the site\'s root so it opens at /llms.txt.'], ['Keep it short', 'Who you are, what you offer, and links to the pages that matter.']],
    'no-jsonld': [['Paste the JSON-LD', 'Add the block below in the head or at the end of the body of the homepage.'], ['Fill in the real details', 'Address, phone, opening hours and your profile links.'], ['Validate', 'Run it through the Schema.org validator and the Rich Results test.']],
    'no-entity-schema': [['Add the business block', 'Use the code below as an Organization or LocalBusiness.'], ['Validate', 'Run the Schema.org validator.']],
    'no-faq-schema': [['Copy your existing Q&A into the block', 'Use the exact question and answer text shown on the page.'], ['Validate', 'The Rich Results test shows the FAQ was read.']],
    'no-qa-headings': [['List real customer questions', 'Use enquiries, WhatsApp messages, Google "People also ask" and the questions you answer on calls.'], ['Write each as a heading with a direct answer', 'Question as an h2 or h3, then a two or three sentence answer straight underneath.'], ['Add FAQ markup', 'Then mark them up as FAQPage data.']],
    'no-direct-answers': [['Reply first', 'Open each answer with one or two sentences that fully answer the question.'], ['Then add detail', 'Examples, prices, conditions and links come after.']],
    'ai-js-only': [['Check what a bot sees', 'In Terminal: curl -s YOUR-URL | wc -w. A real page has hundreds of words.'], ['Render on the server', 'Use static or server-side rendering so text is in the first response.'], ['Re-run the audit', 'The word count should jump.']],
    'ai-nosnippet': [['Find the tag', 'View the page source and search for "nosnippet", "noindex" or "noai", or check the X-Robots-Tag response header.'], ['Remove it', 'Unless a page is meant to stay private.']],
    'no-author-dates': [['Add a visible line', 'Owner or author name, and "Last updated" with the date, on key pages.'], ['Repeat it in structured data', 'datePublished and dateModified in the JSON-LD.']],
    'no-entity-links': [['Collect your official profiles', 'Google Business Profile, LinkedIn, Facebook, Instagram, YouTube, and Wikipedia or Wikidata if you have them.'], ['Link them from the site', 'Footer or contact page, and in sameAs in the structured data.']],
    'no-nap': [['Show it as text', 'Business name, full address and phone, in the footer or contact section, not only in an image.'], ['Repeat it in LocalBusiness data', 'Use the exact same wording everywhere.']],
  },
  meaning: {
    'ai-search-blocked-robots': 'When someone asks ChatGPT, Perplexity or Google\'s AI for a recommendation, these bots cannot read your site, so they recommend someone else.',
    'ai-search-blocked-firewall': 'Your security is turning away the very assistants that would send you customers. It looks open in robots.txt but is closed in practice.',
    'no-bot-protection': 'Competitors and scrapers can copy your listings and text in bulk, and abusive crawlers use your bandwidth.',
    'no-llms-txt': 'A small free signal that makes it easier for assistants to describe your business accurately.',
    'no-jsonld': 'AI and search have to guess your business details from page text, and guesses get your name, place or services wrong.',
    'no-entity-schema': 'Assistants cannot confirm which business this is, so they hesitate to name you.',
    'no-faq-schema': 'Your answers are there but not labelled, so they are less likely to be quoted word for word.',
    'no-qa-headings': 'People ask assistants questions. A page that answers questions in their words is the one that gets quoted.',
    'no-direct-answers': 'Assistants quote the first clear sentence under a question. If it is buried, they quote a competitor.',
    'ai-js-only': 'To most AI bots your page is nearly blank, so you cannot be cited for anything on it.',
    'ai-nosnippet': 'You have told search and AI not to use the page. They are obeying.',
    'no-author-dates': 'Assistants lean on sources that show who is behind them and how current they are.',
    'no-entity-links': 'The brand is harder to recognise as one real business across the web, which lowers the chance of being named.',
    'no-nap': 'Local questions ("near me", "in town") need a clear name, address and phone to match you.',
  },
};

AI.steps['safe-browsing-flagged'] = [['See what Google found', 'Open the Safe Browsing report for the site (link below) and Search Console → Security issues.'], ['Remove the cause', 'Restore clean files from a backup, update the CMS and plugins, change passwords, and delete unknown files or scripts.'], ['Ask for a review', 'In Search Console, request a review once clean. It is usually answered within days.']];
AI.steps['field-vitals-poor'] = [['Find the slow element', 'Run the PageSpeed link below. The LCP element and the biggest savings are listed there.'], ['Fix the largest cause first', 'Resize and compress the main image, serve it as WebP or AVIF, and preload it. Remove scripts that block rendering.'], ['Check again in a month', 'This number covers the last 28 days, so it moves slowly. Re-run the audit to compare.']];
AI.steps['field-vitals-average'] = AI.steps['field-vitals-poor'];
AI.meaning['safe-browsing-flagged'] = 'Visitors see a red "deceptive site" or "dangerous" screen before your page. Almost all of them leave, and Google can remove you from results.';
AI.meaning['field-vitals-poor'] = 'This is how real customers on real phones experienced the site. It is slow enough to lose enquiries and to hold back search rankings.';
AI.meaning['field-vitals-average'] = 'Real visitors get a passable but not good experience. Fixing it helps both enquiries and rankings.';
AI.docs['safe-browsing-flagged'] = [['Google: help for hacked or flagged sites', 'https://developers.google.com/search/docs/monitor-debug/security/hacked'], ['Safe Browsing report', 'https://transparencyreport.google.com/safe-browsing/search']];
AI.docs['field-vitals-poor'] = [['web.dev: Core Web Vitals', 'https://web.dev/articles/vitals'], ['web.dev: optimise LCP', 'https://web.dev/articles/optimize-lcp']];
AI.docs['field-vitals-average'] = AI.docs['field-vitals-poor'];
AI.verify['safe-browsing-flagged'] = ['safebrowsing', 'psi'];
AI.verify['field-vitals-poor'] = ['psi'];
AI.verify['field-vitals-average'] = ['psi'];

// Security scan (security.js)
const SEC_ROTATE = ['Rotate first', 'Treat anything that was exposed as compromised. Revoke the key or password and create a new one before anything else.'];
AI.steps['exposed-git'] = [['Block the folder', 'Deny /.git in the web server config (nginx: location ~ /\\.git { deny all; }) or stop uploading the .git folder when deploying.'], SEC_ROTATE, ['Check it is closed', 'Open /.git/HEAD in a browser. It should now be a 403 or 404.']];
AI.steps['exposed-env'] = [['Remove it from the web root', 'Move .env out of the public folder and deny dotfiles in the server config.'], SEC_ROTATE, ['Check it is closed', 'Open /.env in a browser. It should be a 403 or 404.']];
AI.steps['exposed-backup'] = [['Delete the file', 'Remove backups from the public folder and store them somewhere private.'], SEC_ROTATE];
AI.steps['secrets-in-js'] = [SEC_ROTATE, ['Move the call to the server', 'Call the service from a server route or edge function and keep the key in an environment variable, never in code the browser downloads.'], ['Check history', 'Search the repository history and deployed bundles for the old key.']];
AI.steps['outdated-libraries'] = [['Update the libraries', 'Upgrade to the versions named in the finding, then test forms, menus and sliders.'], ['Remove what is unused', 'Delete old copies of libraries that nothing uses.']];
AI.steps['wp-user-enum'] = [['Block the users endpoint', 'Use a security plugin setting, or a small filter that removes /wp/v2/users for visitors who are not logged in.'], ['Harden logins', 'Use unique admin usernames, long passwords and two-factor sign-in.']];
AI.steps['error-disclosure'] = [['Turn off debug output', 'Set the production environment (NODE_ENV=production, WP_DEBUG false, display_errors off).'], ['Show a plain error page', 'Log details privately and show visitors a generic message.']];
AI.steps['directory-listing'] = [['Disable listing', 'Apache: Options -Indexes. nginx: autoindex off.'], ['Review the folder', 'Check what was in the listing and remove anything private.']];
for (const k of ['exposed-git', 'exposed-env', 'exposed-backup', 'secrets-in-js']) AI.meaning[k] = 'Anyone who finds this can use it today, no hacking skill needed. Fix and rotate it as the first job.';
AI.meaning['outdated-libraries'] = 'These versions have published security bugs. Whether one can be used against the site depends on how it is used, but updating removes the question.';
AI.meaning['wp-user-enum'] = 'Attackers get real admin usernames for free, which makes password guessing far easier.';
AI.docs['exposed-git'] = [['OWASP: information exposure through source control', 'https://owasp.org/www-project-web-security-testing-guide/']];
AI.docs['secrets-in-js'] = [['OWASP: secrets management', 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html']];
AI.docs['outdated-libraries'] = [['OWASP: vulnerable and outdated components', 'https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/']];

const dq = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
/** Ready-to-paste code for the AI findings, filled in with what the audit read. */
function aiCode(id, ctx) {
  const brand = ctx.brand || ctx.host;
  const sameAs = (ctx.sameAs && ctx.sameAs.length ? ctx.sameAs : ['https://www.facebook.com/your-page', 'https://www.linkedin.com/company/your-page', 'https://www.instagram.com/your-page']).map((u) => '"' + dq(u) + '"').join(', ');
  const org = '<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "LocalBusiness",\n  "name": "' + dq(brand) + '",\n  "url": "' + dq(ctx.url) + '",\n  "description": "' + dq(ctx.description || 'One clear sentence about what you do and where.') + '",\n  "telephone": "+91-00000-00000",\n  "address": { "@type": "PostalAddress", "streetAddress": "Street", "addressLocality": "Town", "addressRegion": "State", "postalCode": "000000", "addressCountry": "IN" },\n  "sameAs": [' + sameAs + ']\n}\n</script>';
  switch (id) {
    case 'ai-search-blocked-robots':
      return { 'robots.txt': '# Let AI search and "user asked" bots in so they can cite you\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: ChatGPT-User\nAllow: /\n\nUser-agent: Claude-SearchBot\nAllow: /\n\nUser-agent: Claude-User\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Perplexity-User\nAllow: /\n\n# Optional: keep model-training bots out\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nSitemap: ' + ctx.url.replace(/\/$/, '') + '/sitemap.xml' };
    case 'no-bot-protection':
      return {
        Cloudflare: 'Security → WAF → Custom rules → Create rule\n  Expression:\n  (http.user_agent contains "python-requests") or (http.user_agent contains "Scrapy") or (http.user_agent contains "Go-http-client") or (http.user_agent eq "")\n  and not cf.client.bot\n  Action: Managed Challenge',
        Nginx: 'map $http_user_agent $bad_bot {\n  default 0;\n  ""                     1;\n  ~*python-requests      1;\n  ~*scrapy               1;\n  ~*go-http-client       1;\n}\nserver {\n  if ($bad_bot) { return 403; }\n}',
      };
    case 'no-llms-txt': {
      const pages = (ctx.pages || []).slice(0, 12).map((p) => '- [' + (p.title || p.path) + '](' + p.url + ')').join('\n') || '- [Home](' + ctx.url + ')';
      return { 'llms.txt': '# ' + brand + '\n\n> ' + (ctx.description || 'One or two sentences on what the business does, for whom, and where.') + '\n\n## Key pages\n' + pages + '\n\n## Contact\n- Website: ' + ctx.url };
    }
    case 'no-jsonld':
    case 'no-entity-schema':
    case 'no-entity-links':
    case 'no-nap':
      return { 'JSON-LD': org };
    case 'no-faq-schema': {
      const qs = (ctx.qa && ctx.qa.length ? ctx.qa : ['How much does it cost?', 'Where are you based?']).slice(0, 3);
      return { 'JSON-LD': '<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [\n' + qs.map((q) => '    { "@type": "Question", "name": "' + dq(q) + '", "acceptedAnswer": { "@type": "Answer", "text": "The same answer text shown on the page." } }').join(',\n') + '\n  ]\n}\n</script>' };
    }
    case 'no-qa-headings':
    case 'no-direct-answers':
      return { HTML: '<h2>How much does it cost?</h2>\n<p>Direct answer in one or two sentences: from X to Y, depending on Z.</p>\n<p>Then the detail: what is included, examples, and a link to enquire.</p>' };
    case 'ai-js-only':
      return { Terminal: '# What an AI bot receives (word count of the raw HTML)\ncurl -s ' + ctx.url + ' | sed -e "s/<[^>]*>/ /g" | wc -w' };
    case 'ai-nosnippet':
      return { HTML: '<!-- remove this -->\n<meta name="robots" content="noindex, nosnippet">\n\n<!-- or use -->\n<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">' };
    case 'ai-search-blocked-firewall':
      return { Cloudflare: 'Security → Bots → Configure\n  Verified bots: Allow\n  AI bots: set to "Allow" for OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot\n(or AI Crawl Control → set those crawlers to Allow)' };
    default:
      return null;
  }
}

/** Everything the audit page needs to explain one fix, or null if we have nothing to add. */
export function howtoFor(itemKey, category, ctx) {
  const id = String(itemKey || '').startsWith('check:') ? String(itemKey).slice(6) : null;
  const links = verifyLinks(ctx);
  const names = (id && (AI.verify[id] || VERIFY[id])) || CATEGORY_VERIFY[category] || [];
  const verify = names.map((n) => links[n]).filter(Boolean);
  const steps = (id && (AI.steps[id] || STEPS[id])) || null;
  let code = (id && (aiCode(id, ctx) || CODE[id])) || null;
  if (id === 'no-security-txt') {
    code = { 'security.txt': 'Contact: mailto:security@' + ctx.host + '\nExpires: ' + new Date(Date.now() + 365 * 86400000).toISOString() + '\nPreferred-Languages: en\nCanonical: https://' + ctx.host + '/.well-known/security.txt' };
  }
  const docs = (id && (AI.docs[id] || DOCS[id])) || null;
  const meaning = (id && (AI.meaning[id] || MEANING[id])) || CATEGORY_MEANING[category] || null;
  if (!steps && !code && !docs && !verify.length && !meaning) return null;
  return { steps, code, docs, verify, meaning };
}
