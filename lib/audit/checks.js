// Deterministic checks a web designer runs on every client site.
//
// These are facts, not opinions, so they are done in code: no model is asked
// whether an image has alt text. Each finding carries a category, a severity,
// a plain-language explanation of why it matters to the client's business,
// and the concrete fix. Accessibility items cite WCAG 2.2 and follow the
// WebAIM "most common failures" list (contrast, alt text, labels, empty
// links/buttons, lang, headings). Contrast itself needs a rendered page, so it
// comes from the Lighthouse step instead.

const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

function finding(id, category, severity, title, why, fix, extra = {}) {
  return { id, category, severity, title, why, fix, ...extra };
}

/** Runs every check against the raw page. `$` must be loaded BEFORE scripts/styles are stripped. */
export function runChecks($, html, url) {
  const out = [];
  const add = (...a) => out.push(finding(...a));
  const text = (el) => $(el).text().replace(/\s+/g, ' ').trim();

  /* ---------------------------------------------------------- trust/basics */
  if (!/^https:\/\//i.test(url)) {
    add('no-https', 'Trust', 'critical', 'Site is not served over HTTPS',
      'Browsers mark it "Not secure", which scares visitors off and hurts search ranking.',
      'Turn on HTTPS at the host (free on Vercel, Netlify, Cloudflare) and redirect http to https.');
  }

  const title = ($('title').first().text() || '').trim();
  if (!title) {
    add('no-title', 'SEO', 'high', 'Page has no title',
      'The title is the blue link in Google and the browser tab label. Without it the page looks broken in search.',
      'Add a <title> of 30–60 characters: what the business does + where + brand.');
  } else if (title.length < 20 || title.length > 65) {
    add('title-length', 'SEO', 'low', 'Page title is ' + (title.length < 20 ? 'too short' : 'too long') + ' (' + title.length + ' chars)',
      title.length < 20 ? 'A very short title wastes the most valuable words in search results.' : 'Google cuts titles off around 60 characters, so the end is lost.',
      'Rewrite to 30–60 characters, leading with the service and location.', { evidence: title });
  }

  const desc = ($('meta[name="description"]').attr('content') || '').trim();
  if (!desc) {
    add('no-meta-description', 'SEO', 'medium', 'No meta description',
      'Google will guess a snippet from random page text, which usually reads badly and gets fewer clicks.',
      'Add a 120–160 character description that says who it is for and what to do next.');
  } else if (desc.length > 170 || desc.length < 60) {
    add('meta-description-length', 'SEO', 'low', 'Meta description is ' + (desc.length < 60 ? 'too short' : 'too long') + ' (' + desc.length + ' chars)',
      'Search results show about 155 characters; outside 60–160 it is either thin or truncated.',
      'Rewrite to 120–160 characters.', { evidence: desc.slice(0, 200) });
  }

  if (!$('meta[name="viewport"]').length) {
    add('no-viewport', 'Mobile', 'critical', 'Not set up for phones (no viewport tag)',
      'On a phone the page renders as a shrunken desktop site. Most client traffic is mobile.',
      'Add <meta name="viewport" content="width=device-width, initial-scale=1"> and check the layout on a phone.');
  }

  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (!ogImage || !ogTitle) {
    add('no-share-preview', 'Trust', 'medium', 'Link previews are ' + (!ogImage ? 'missing an image' : 'missing a title'),
      'When the link is shared on WhatsApp, LinkedIn or Instagram it shows as a bare URL instead of a rich card — the main way local businesses get referred.',
      'Add og:title, og:description and a 1200×630 og:image.');
  }

  if (!$('link[rel~="icon"], link[rel="apple-touch-icon"]').length) {
    add('no-favicon', 'Trust', 'low', 'No favicon',
      'The browser tab and bookmarks show a blank icon, which looks unfinished.',
      'Add a favicon and an apple-touch-icon (180×180).');
  }

  if (!$('link[rel="canonical"]').length) {
    add('no-canonical', 'SEO', 'low', 'No canonical URL',
      'If the page is reachable at several URLs, search engines may split its ranking between them.',
      'Add <link rel="canonical" href="https://…"> pointing at the preferred URL.');
  }

  const jsonld = $('script[type="application/ld+json"]').map((_, el) => $(el).html() || '').get().join(' ');
  if (!jsonld) {
    add('no-structured-data', 'SEO', 'medium', 'No structured data',
      'Structured data (schema.org) is what makes Google show the business name, rating, hours and location as a rich result.',
      'Add JSON-LD for the business type (LocalBusiness / Organization / Product), with name, address, phone and opening hours.');
  }

  const contact = $('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href*="whatsapp://"]').length;
  const forms = $('form').length;
  if (!contact && !forms) {
    add('no-contact-path', 'Conversion', 'high', 'No one-tap way to get in touch',
      'There is no clickable phone, email, WhatsApp link or form. Interested visitors have to copy details by hand — many will not.',
      'Add tap-to-call (tel:), a WhatsApp link (wa.me) and/or a short enquiry form, visible near the top and in the footer.');
  }

  /* ---------------------------------------------------------- accessibility */
  if (!$('html').attr('lang')) {
    add('no-lang', 'Accessibility', 'high', 'Page language is not declared',
      'Screen readers pronounce the whole page in the wrong accent/language. WCAG 3.1.1 (Level A).',
      'Set <html lang="en"> (or the right language code).', { wcag: '3.1.1 A' });
  }

  const h1 = $('h1').length;
  if (h1 === 0) {
    add('no-h1', 'SEO', 'high', 'No main heading (H1)',
      'Search engines and screen readers use the H1 to understand what the page is about.',
      'Make the hero headline an <h1> — exactly one per page.', { wcag: '1.3.1 A' });
  } else if (h1 > 1) {
    add('multiple-h1', 'SEO', 'medium', h1 + ' main headings (H1) on one page',
      'Several H1s blur what the page is about for search engines and screen-reader users.',
      'Keep one H1 (the hero headline); turn the others into H2s.', { wcag: '1.3.1 A', count: h1 });
  }

  let skips = 0;
  let prev = 0;
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const lvl = Number((el.name || '').slice(1));
    if (prev && lvl > prev + 1) skips++;
    prev = lvl;
  });
  if (skips) {
    add('heading-skips', 'Accessibility', 'low', 'Heading levels skip (' + skips + ' place' + (skips > 1 ? 's' : '') + ')',
      'Jumping from H2 to H4 breaks the outline screen-reader users navigate by. WCAG 1.3.1.',
      'Use headings in order (H2 → H3); style them with CSS rather than picking a level for its size.', { wcag: '1.3.1 A', count: skips });
  }

  const imgs = $('img');
  const noAlt = imgs.filter((_, el) => $(el).attr('alt') === undefined).length;
  if (noAlt) {
    add('img-no-alt', 'Accessibility', noAlt > 5 ? 'high' : 'medium', noAlt + ' image' + (noAlt > 1 ? 's have' : ' has') + ' no alt text',
      'Screen readers read out the file name instead, and Google Images cannot index them. WCAG 1.1.1 (Level A) — the 2nd most common failure on the web.',
      'Describe meaningful images in alt="…"; give purely decorative ones alt="".', { wcag: '1.1.1 A', count: noAlt });
  }

  const noSize = imgs.filter((_, el) => !$(el).attr('width') && !$(el).attr('height') && !/width|height|aspect/i.test($(el).attr('style') || '')).length;
  if (noSize >= 3) {
    add('img-no-dimensions', 'Performance', 'low', noSize + ' images without width/height',
      'The page jumps around as images load (layout shift), which feels janky and counts against Core Web Vitals.',
      'Set width and height (or aspect-ratio) on every image.', { count: noSize });
  }

  const eager = imgs.filter((_, el) => $(el).attr('loading') !== 'lazy').length;
  if (imgs.length >= 8 && eager > imgs.length * 0.7) {
    add('img-not-lazy', 'Performance', 'low', eager + ' of ' + imgs.length + ' images load immediately',
      'Images far down the page are downloaded before the visitor scrolls, slowing the first screen on mobile data.',
      'Add loading="lazy" to images below the first screen (keep the hero image eager).', { count: eager });
  }

  const emptyLinks = $('a[href]').filter((_, el) => !text(el) && !$(el).attr('aria-label') && !$(el).attr('title') && !$(el).find('img[alt]:not([alt=""]), svg title, [aria-label]').length).length;
  if (emptyLinks) {
    add('empty-links', 'Accessibility', 'high', emptyLinks + ' link' + (emptyLinks > 1 ? 's have' : ' has') + ' no readable name',
      'Usually icon links (social icons, arrows). Screen readers announce them as just "link". WCAG 2.4.4 (Level A).',
      'Add aria-label="Instagram" (etc.) or visually hidden text inside each icon link.', { wcag: '2.4.4 A', count: emptyLinks });
  }

  const emptyButtons = $('button').filter((_, el) => !text(el) && !$(el).attr('aria-label') && !$(el).attr('title') && !$(el).find('[aria-label], img[alt]:not([alt=""])').length).length;
  if (emptyButtons) {
    add('empty-buttons', 'Accessibility', 'high', emptyButtons + ' button' + (emptyButtons > 1 ? 's have' : ' has') + ' no readable name',
      'Icon-only buttons (menu, close, play) are announced as just "button". WCAG 4.1.2 (Level A).',
      'Add aria-label to every icon-only button.', { wcag: '4.1.2 A', count: emptyButtons });
  }

  // Two different failures, measured on real sites: a field with no label at
  // all, and a field whose visible label is not connected to it in code (a
  // <label> or caption next to it without for=/id). The second looks fine to
  // sighted visitors but screen readers announce just "edit text".
  let noLabel = 0;
  let unlinked = 0;
  $('input, select, textarea').each((_, el) => {
    const $el = $(el);
    const type = ($el.attr('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;
    const id = $el.attr('id');
    if (id && $('label[for="' + id + '"]').length) return;
    if ($el.closest('label').length) return;
    if ($el.attr('aria-label') || $el.attr('aria-labelledby') || $el.attr('title')) return;
    const nearby = $el.parent().find('label').length || $el.parent().clone().children('input,select,textarea,option').remove().end().text().trim().length > 1;
    if (nearby) unlinked++;
    else noLabel++;
  });
  if (noLabel) {
    add('unlabeled-inputs', 'Accessibility', 'critical', noLabel + ' form field' + (noLabel > 1 ? 's have' : ' has') + ' no label at all',
      'Placeholder text is not a label: it vanishes on typing and screen readers may skip it, so the enquiry form can be impossible to fill. WCAG 1.3.1 / 3.3.2 (Level A).',
      'Give every field a visible <label for="…">.', { wcag: '1.3.1 A', count: noLabel });
  }
  if (unlinked) {
    add('labels-not-linked', 'Accessibility', 'high', unlinked + ' form field' + (unlinked > 1 ? 's\' labels are' : '\'s label is') + ' not connected to the field',
      'The label is visible, but not tied to its field in code, so screen readers announce only "edit text" and tapping the label does not focus the field. WCAG 1.3.1 (Level A).',
      'Give each field an id and its label a matching for="…" (or wrap the field inside the <label>).', { wcag: '1.3.1 A', count: unlinked });
  }

  if (!$('main, [role="main"]').length) {
    add('no-main-landmark', 'Accessibility', 'low', 'No <main> landmark',
      'Screen-reader users jump straight to the main content using landmarks; without <main> they must wade through the menu every time.',
      'Wrap the page content in <main>, and use <header>/<nav>/<footer> for the rest.', { wcag: '1.3.1 A' });
  }

  const unsafeBlank = $('a[target="_blank"]').filter((_, el) => !/noopener|noreferrer/.test($(el).attr('rel') || '')).length;
  if (unsafeBlank) {
    add('blank-no-noopener', 'Trust', 'low', unsafeBlank + ' new-tab link' + (unsafeBlank > 1 ? 's' : '') + ' without rel="noopener"',
      'Links that open a new tab without noopener let the other site control this tab (a known phishing trick).',
      'Add rel="noopener noreferrer" to every target="_blank" link.', { count: unsafeBlank });
  }

  /* ------------------------------------------------------------ page weight */
  const kb = Math.round(html.length / 1024);
  if (kb > 600) {
    add('heavy-html', 'Performance', 'medium', 'Very large page HTML (' + kb + ' KB)',
      'The browser has to download and parse all of this before showing much, which is slow on mobile data.',
      'Remove unused markup and inlined data; load heavy sections on demand.', { count: kb });
  }
  const scripts = $('script[src]').length;
  if (scripts > 25) {
    add('many-scripts', 'Performance', 'medium', scripts + ' separate script files',
      'Each script is another request and more work for the phone before the page is usable.',
      'Remove unused plugins/trackers and bundle the rest.', { count: scripts });
  }

  return out.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}

export { SEV_RANK };
