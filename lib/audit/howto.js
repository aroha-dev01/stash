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
const CATEGORY_VERIFY = { Security: ['headers'], Privacy: ['headers'], SEO: ['gsc'], Performance: ['psi'], Accessibility: ['wave'], Trust: ['headers'] };

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
  Security: 'A weakness that makes it easier for someone to misuse the site or its visitors.',
  Privacy: 'A gap in how visitor details are handled, with trust and legal risk.',
  SEO: 'Google understands the site less well, which costs visits from search.',
  Performance: 'The site loads slower than it should, and slow sites lose visitors.',
  Accessibility: 'Some visitors cannot use part of the site, which means lost enquiries.',
};

/** Everything the audit page needs to explain one fix, or null if we have nothing to add. */
export function howtoFor(itemKey, category, ctx) {
  const id = String(itemKey || '').startsWith('check:') ? String(itemKey).slice(6) : null;
  const links = verifyLinks(ctx);
  const names = (id && VERIFY[id]) || CATEGORY_VERIFY[category] || [];
  const verify = names.map((n) => links[n]).filter(Boolean);
  const steps = (id && STEPS[id]) || null;
  let code = (id && CODE[id]) || null;
  if (id === 'no-security-txt') {
    code = { 'security.txt': 'Contact: mailto:security@' + ctx.host + '\nExpires: ' + new Date(Date.now() + 365 * 86400000).toISOString() + '\nPreferred-Languages: en\nCanonical: https://' + ctx.host + '/.well-known/security.txt' };
  }
  const docs = (id && DOCS[id]) || null;
  const meaning = (id && MEANING[id]) || CATEGORY_MEANING[category] || null;
  if (!steps && !code && !docs && !verify.length && !meaning) return null;
  return { steps, code, docs, verify, meaning };
}
