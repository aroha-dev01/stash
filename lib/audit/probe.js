import tls from 'node:tls';
import { USER_AGENT } from '../util.js';

// The "outside the HTML" half of the technical audit: how the site is served.
//
// Everything here is PASSIVE and polite: ordinary GET/HEAD requests to the
// page's own public URLs, the files every site publishes (robots.txt,
// sitemap.xml, security.txt), a TLS handshake, and public DNS lookups. It
// never sends exploit payloads, guesses credentials, or probes for private
// files, so it is fine to run on any client site.
//
// All findings use the same shape as checks.js, so they flow into the same
// plan, report and MCP output. Facts that are not problems (server, CDN,
// certificate expiry, TTFB, trackers) are returned separately as `facts`.

const SEV = { critical: 4, high: 3, medium: 2, low: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finding(id, category, severity, title, why, fix, extra = {}) {
  return { id, category, severity, title, why, fix, ...extra };
}

async function get(url, { method = 'GET', ms = 7000, redirect = 'follow', headers = {} } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method, redirect,
      signal: AbortSignal.timeout(ms),
      headers: { 'user-agent': USER_AGENT, ...headers },
    });
    return { res, ms: Date.now() - t0 };
  } catch (e) {
    return { error: e };
  }
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

/* ---------------------------------------------------------------- headers */

function headerFindings(h, cookies, url, add) {
  const https = /^https:/i.test(url);
  const csp = h['content-security-policy'] || '';

  if (https) {
    const hsts = h['strict-transport-security'];
    if (!hsts) {
      add('no-hsts', 'Security', 'medium', 'No HSTS header (browsers are not told to always use HTTPS)',
        'Without it a visitor on public Wi-Fi can be silently downgraded to an insecure connection and have the page tampered with.',
        'Send Strict-Transport-Security: max-age=31536000; includeSubDomains (one line in your host or CDN settings).');
    } else {
      const age = Number((/max-age=(\d+)/i.exec(hsts) || [])[1] || 0);
      if (age < 15552000) {
        add('weak-hsts', 'Security', 'low', 'HSTS lifetime is short (' + Math.round(age / 86400) + ' days)',
          'A short lifetime means the protection lapses quickly between visits.',
          'Raise max-age to at least 15552000 (180 days), ideally 31536000.', { evidence: hsts });
      }
    }
  }

  if (!csp) {
    add('no-csp', 'Security', 'medium', 'No Content-Security-Policy',
      'A CSP is the main safety net against injected scripts (cross-site scripting), which can steal enquiries or show visitors fake forms.',
      'Add a Content-Security-Policy header. Start in report-only mode, list the script sources you actually use, then enforce it.');
  } else if (/'unsafe-eval'/.test(csp) || /script-src[^;]*'unsafe-inline'(?![^;]*'nonce-)/.test(csp)) {
    add('weak-csp', 'Security', 'low', "Content-Security-Policy allows 'unsafe-inline' or 'unsafe-eval' scripts",
      'That largely cancels the protection a CSP is there to give.',
      "Move inline scripts to files or give them nonces, then remove 'unsafe-inline' / 'unsafe-eval'.", { evidence: csp.slice(0, 200) });
  }

  if (!h['x-frame-options'] && !/frame-ancestors/i.test(csp)) {
    add('no-frame-protection', 'Security', 'medium', 'Page can be embedded in other sites (clickjacking)',
      'Someone can load your site invisibly inside their page and trick visitors into clicking buttons on it.',
      "Send X-Frame-Options: SAMEORIGIN, or a CSP with frame-ancestors 'self'.");
  }

  const minor = [];
  if ((h['x-content-type-options'] || '').toLowerCase() !== 'nosniff') minor.push('X-Content-Type-Options: nosniff');
  if (!h['referrer-policy']) minor.push('Referrer-Policy: strict-origin-when-cross-origin');
  if (!h['permissions-policy']) minor.push('Permissions-Policy (turn off camera, microphone, geolocation you do not use)');
  if (minor.length) {
    add('missing-minor-headers', 'Security', 'low', minor.length + ' small hardening headers are missing',
      'Each is a cheap extra layer: stops browsers guessing file types, limits what URL info leaks to other sites, and switches off unused browser features.',
      'Add: ' + minor.join('; ') + '.', { evidence: minor.join(' · ') });
  }

  const leaks = [];
  const server = h.server || '';
  if (/\d+\.\d+/.test(server)) leaks.push('Server: ' + server);
  if (h['x-powered-by']) leaks.push('X-Powered-By: ' + h['x-powered-by']);
  if (leaks.length) {
    add('server-version-exposed', 'Security', 'low', 'Server software and version are advertised',
      'Attackers search for sites running specific old versions; there is no benefit in telling them.',
      'Remove or blank the Server (version) and X-Powered-By headers in the server or CDN config.', { evidence: leaks.join(' · ') });
  }

  if ((h['access-control-allow-origin'] || '') === '*' && /true/i.test(h['access-control-allow-credentials'] || '')) {
    add('cors-open-credentials', 'Security', 'high', 'CORS allows every origin together with credentials',
      'Any website could make logged-in requests to this one and read the answers.',
      'Return a specific allowed origin instead of *, or drop Access-Control-Allow-Credentials.');
  }

  const weak = [];
  let sessionLike = false;
  for (const c of cookies) {
    const name = c.split('=')[0].trim();
    const low = c.toLowerCase();
    const miss = [];
    if (https && !/;\s*secure/.test(low)) miss.push('Secure');
    if (!/;\s*httponly/.test(low)) miss.push('HttpOnly');
    if (!/;\s*samesite=/.test(low)) miss.push('SameSite');
    if (miss.length) {
      weak.push(name + ' (no ' + miss.join(', ') + ')');
      if (/sess|token|auth|jwt|login|sid/i.test(name)) sessionLike = true;
    }
  }
  if (weak.length) {
    add('insecure-cookies', 'Security', sessionLike ? 'high' : 'medium', weak.length + ' cookie' + (weak.length > 1 ? 's' : '') + ' set without safe flags',
      'Cookies without Secure/HttpOnly/SameSite can be read by scripts, sent over insecure connections, or abused from other sites.',
      'Set Secure, HttpOnly and SameSite=Lax (or Strict) on every cookie; session cookies first.', { evidence: weak.slice(0, 4).join('; ') });
  }
}

/* ------------------------------------------------------------ html-level */

const TRACKERS = [
  [/googletagmanager\.com|google-analytics\.com|gtag\(/i, 'Google Analytics / Tag Manager'],
  [/connect\.facebook\.net|fbq\(/i, 'Meta Pixel'],
  [/static\.hotjar\.com|hotjar/i, 'Hotjar'],
  [/clarity\.ms/i, 'Microsoft Clarity'],
  [/snap\.licdn\.com|linkedin\.com\/px/i, 'LinkedIn Insight'],
  [/analytics\.tiktok\.com/i, 'TikTok Pixel'],
  [/doubleclick\.net|googleadservices\.com/i, 'Google Ads'],
  [/cdn\.segment\.com|mixpanel\.com|amplitude\.com/i, 'Product analytics'],
];
const CONSENT = /cookiebot|onetrust|cookieyes|termly|osano|iubenda|complianz|cookie-?consent|cookie-?notice|cookie-?banner|we use cookies|uses cookies|accept (all )?cookies/i;

function htmlFindings($, html, url, add, facts) {
  const https = /^https:/i.test(url);
  const host = hostOf(url);

  if (https) {
    const mixed = [];
    let active = false;
    $('script[src],link[rel="stylesheet"][href],iframe[src]').each((_, el) => {
      const v = $(el).attr('src') || $(el).attr('href') || '';
      if (/^http:\/\//i.test(v)) { mixed.push(v); active = true; }
    });
    $('img[src],source[src],video[src],audio[src]').each((_, el) => {
      const v = $(el).attr('src') || '';
      if (/^http:\/\//i.test(v)) mixed.push(v);
    });
    if (mixed.length) {
      add('mixed-content', 'Security', active ? 'high' : 'medium', mixed.length + ' resource' + (mixed.length > 1 ? 's load' : ' loads') + ' over insecure HTTP on a secure page',
        active ? 'Browsers block these scripts/styles, so parts of the site silently break, and the padlock may disappear.' : 'Browsers warn or drop the padlock, which makes visitors doubt the site.',
        'Change every http:// address to https:// (or protocol-relative) and re-upload the asset if the host has no HTTPS.', { evidence: mixed.slice(0, 3).join(', ') });
    }
    const badForms = [];
    $('form[action]').each((_, el) => { const a = $(el).attr('action') || ''; if (/^http:\/\//i.test(a)) badForms.push(a); });
    if (badForms.length) {
      add('insecure-form-action', 'Security', 'critical', 'A form sends visitors\' details over insecure HTTP',
        'Names, phone numbers and messages travel unencrypted and can be read or altered in transit.',
        'Point the form action to an https:// address.', { evidence: badForms[0] });
    }
  }

  const noSri = [];
  const thirdHosts = new Set();
  $('script[src],link[rel="stylesheet"][href]').each((_, el) => {
    const v = $(el).attr('src') || $(el).attr('href') || '';
    let h;
    try { h = new URL(v, url).hostname; } catch { return; }
    if (!h || h === host) return;
    thirdHosts.add(h);
    if (!$(el).attr('integrity') && /cdn|unpkg|jsdelivr|cdnjs|bootstrapcdn|code\.jquery/i.test(h)) noSri.push(h);
  });
  facts.third_party_hosts = [...thirdHosts].slice(0, 25);
  if (noSri.length) {
    add('third-party-no-sri', 'Security', 'low', noSri.length + ' library file' + (noSri.length > 1 ? 's are' : ' is') + ' loaded from a public CDN without an integrity check',
      'If that CDN were ever compromised, malicious code would run on your site and nothing would notice.',
      'Add integrity="sha384-…" and crossorigin="anonymous" to those script/link tags, or host the files yourself.', { evidence: [...new Set(noSri)].join(', ') });
  }

  // Privacy: trackers and consent.
  const blob = $('script').map((_, el) => ($(el).attr('src') || '') + ' ' + ($(el).html() || '').slice(0, 2000)).get().join(' ');
  const found = TRACKERS.filter(([re]) => re.test(blob)).map(([, n]) => n);
  facts.trackers = found;
  const consent = CONSENT.test(blob) || CONSENT.test($('body').text().slice(0, 40000)) || $('[id*="cookie" i],[class*="cookie" i],[id*="consent" i]').length > 0;
  facts.consent_banner = consent;
  if (found.length && !consent) {
    add('trackers-no-consent', 'Privacy', 'medium', 'Tracking tools run with no sign of a cookie-consent notice',
      'Analytics and ad pixels (' + found.join(', ') + ') collect visitor data. Privacy laws such as GDPR and India\'s DPDP Act expect people to be told and, in many cases, to opt in.',
      'Add a consent banner that blocks those scripts until visitors accept, and describe them in the privacy policy.', { evidence: found.join(', ') });
  }
  const hasPolicy = $('a[href]').filter((_, el) => /privacy/i.test(($(el).attr('href') || '') + ' ' + $(el).text())).length > 0;
  facts.privacy_policy = hasPolicy;
  if (!hasPolicy && ($('form').length || found.length)) {
    add('no-privacy-policy', 'Privacy', 'medium', 'No privacy policy link',
      'The site collects personal details (a form and/or analytics) but never tells visitors what happens to them. Many ad platforms and payment providers also require one.',
      'Publish a privacy policy covering what is collected, why, and who to contact, and link it from the footer and next to every form.');
  }
}

/* --------------------------------------------------------------- network */

function certInfo(host) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const s = tls.connect({ host, port: 443, servername: host, timeout: 6000 }, () => {
        const c = s.getPeerCertificate();
        const info = {
          protocol: s.getProtocol(),
          authorized: s.authorized,
          error: s.authorizationError ? String(s.authorizationError) : null,
          valid_to: c?.valid_to || null,
          issuer: c?.issuer?.O || c?.issuer?.CN || null,
          days_left: c?.valid_to ? Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86400000) : null,
        };
        s.end();
        finish(info);
      });
      s.on('error', () => finish(null));
      s.on('timeout', () => { s.destroy(); finish(null); });
    } catch {
      finish(null);
    }
  });
}

async function tlsFindings(host, add, facts) {
  const c = await certInfo(host);
  if (!c) return;
  facts.tls = { protocol: c.protocol, issuer: c.issuer, days_left: c.days_left, valid_to: c.valid_to };
  if (c.authorized === false) {
    add('tls-invalid', 'Security', 'critical', 'Security certificate is not trusted',
      'Visitors see a full-page browser warning ("Your connection is not private") and most will leave.',
      'Reissue the certificate (free from Let\'s Encrypt or your host) and make sure it covers this exact domain.', { evidence: c.error || undefined });
  } else if (c.days_left != null && c.days_left < 14) {
    add('tls-expiring', 'Security', c.days_left < 0 ? 'critical' : 'high', c.days_left < 0 ? 'Security certificate has expired' : 'Security certificate expires in ' + c.days_left + ' days',
      'When it lapses every visitor gets a browser warning and the site effectively goes offline.',
      'Renew now and turn on automatic renewal at the host.');
  } else if (c.days_left != null && c.days_left < 30) {
    add('tls-expiring', 'Security', 'medium', 'Security certificate expires in ' + c.days_left + ' days',
      'If auto-renewal is not working, the site will start showing warnings.',
      'Check that automatic renewal is on.');
  }
  if (c.protocol && /TLSv1(\.0|\.1)?$/.test(c.protocol)) {
    add('old-tls', 'Security', 'high', 'Server still accepts an outdated encryption protocol (' + c.protocol + ')',
      'Old TLS versions have known weaknesses and are rejected by compliance standards.',
      'Disable TLS 1.0/1.1 and allow only TLS 1.2 and 1.3.');
  }
}

async function redirectFindings(url, add, facts) {
  const u = new URL(url);
  if (u.protocol !== 'https:') return;
  const [plain, other] = await Promise.all([
    get('http://' + u.host + '/', { redirect: 'manual', ms: 6000 }),
    (() => {
      if (/^\d+\.\d+\.\d+\.\d+$|localhost/.test(u.hostname)) return null;
      const alt = u.hostname.startsWith('www.') ? u.hostname.slice(4) : u.hostname.split('.').length === 2 ? 'www.' + u.hostname : null;
      return alt ? get('https://' + alt + '/', { redirect: 'manual', ms: 6000 }).then((r) => ({ ...r, alt })) : null;
    })(),
  ]);
  if (plain?.res) {
    const s = plain.res.status;
    const loc = plain.res.headers.get('location') || '';
    facts.http_redirect = s >= 300 && s < 400 ? (/^https:/i.test(loc) ? 'to https' : 'elsewhere') : s === 200 ? 'serves http' : String(s);
    if (s === 200) {
      add('no-http-redirect', 'Security', 'high', 'The insecure http:// address still opens the site',
        'Anyone who types the plain address or follows an old link lands on the unprotected version, and search engines may index both.',
        'Redirect every http:// request to https:// with a permanent (301/308) redirect.');
    }
  }
  if (other?.res && other.res.status === 200) {
    add('www-duplicate', 'SEO', 'medium', 'Both ' + u.hostname + ' and ' + other.alt + ' serve the site without redirecting',
      'Google sees two copies of every page, which splits ranking and can cause duplicate-content problems.',
      'Pick one version and 301-redirect the other to it.');
  }
}

async function indexFindings(url, add, facts) {
  const base = new URL(url).origin;
  const [robots, nf, sec] = await Promise.all([
    get(base + '/robots.txt', { ms: 6000 }),
    get(base + '/stash-404-' + Math.random().toString(36).slice(2, 8), { ms: 6000, redirect: 'manual' }),
    get(base + '/.well-known/security.txt', { ms: 6000 }),
  ]);

  let sitemapUrl = base + '/sitemap.xml';
  if (robots.res?.ok && /text|plain/.test(robots.res.headers.get('content-type') || 'text/plain')) {
    const txt = (await robots.res.text().catch(() => '')).slice(0, 50000);
    if (/<html/i.test(txt)) {
      add('no-robots', 'SEO', 'low', 'No robots.txt file', 'Search engines look for it first; without it you cannot point them at your sitemap or keep private areas out of results.', 'Add /robots.txt with a Sitemap: line.');
    } else {
      const groups = txt.split(/\n(?=\s*user-agent:)/i);
      const star = groups.find((g) => /user-agent:\s*\*/i.test(g)) || '';
      if (/^\s*disallow:\s*\/\s*$/im.test(star) && !/^\s*allow:\s*\//im.test(star)) {
        add('robots-blocks-all', 'SEO', 'critical', 'robots.txt blocks search engines from the whole site',
          'Google is told not to crawl any page, so the site will not appear in search results.',
          'Remove "Disallow: /" for User-agent: * (it is often left over from the staging site).', { evidence: 'Disallow: /' });
      }
      const m = /^\s*sitemap:\s*(\S+)/im.exec(txt);
      if (m) sitemapUrl = m[1];
      facts.robots_has_sitemap = !!m;
    }
  } else if (robots.res) {
    add('no-robots', 'SEO', 'low', 'No robots.txt file', 'Search engines look for it first; without it you cannot point them at your sitemap or keep private areas out of results.', 'Add /robots.txt with a Sitemap: line.');
  }

  const sm = await get(sitemapUrl, { ms: 7000 });
  let urls = 0;
  if (sm.res?.ok) {
    const xml = (await sm.res.text().catch(() => '')).slice(0, 2_000_000);
    if (/<urlset|<sitemapindex/i.test(xml)) urls = (xml.match(/<loc>/gi) || []).length;
    // The first pages listed, so the audit can read them too (child sitemaps are skipped).
    facts.sitemap_list = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]).filter((u) => !/\.xml(\?|$)/i.test(u)).slice(0, 80);
  }
  facts.sitemap_urls = urls;
  if (!urls) {
    add('no-sitemap', 'SEO', 'medium', 'No working sitemap.xml',
      'A sitemap tells Google every page that exists and when it changed; without one new or deep pages can take weeks to be found.',
      'Generate /sitemap.xml (most builders have a switch for it) and list it in robots.txt and Search Console.');
  }

  if (nf.res && nf.res.status === 200) {
    add('soft-404', 'SEO', 'medium', 'Missing pages return "200 OK" instead of 404',
      'Google may index endless empty URLs and treats the site as lower quality; visitors who mistype a link are not shown a helpful page.',
      'Make unknown URLs return a real 404 status with a friendly "page not found" page.');
  }

  const secTxt = sec.res?.ok ? (await sec.res.text().catch(() => '')).slice(0, 2000) : '';
  facts.security_txt = /contact:/i.test(secTxt);
  if (!facts.security_txt) {
    add('no-security-txt', 'Security', 'low', 'No security.txt contact file',
      'Researchers who find a vulnerability have no way to tell you privately, so it may go public or unreported.',
      'Publish /.well-known/security.txt with a Contact: line (an email address is enough).');
  }
}

const TWO_LEVEL = /\.(co|com|org|net|gov|ac|edu|nic)\.(in|uk|au|nz|za|jp)$/i;
async function doh(name, type) {
  const { res } = await get('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(name) + '&type=' + type, { headers: { accept: 'application/dns-json' }, ms: 5000 });
  if (!res?.ok) return null;
  const j = await res.json().catch(() => null);
  return (j?.Answer || []).map((a) => String(a.data || '').replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
}

async function emailFindings(host, add, facts) {
  const h = host.replace(/^www\./, '');
  const labels = h.split('.');
  // Only the organisation's own domain: subdomains inherit its records.
  if (labels.length !== 2 && !(labels.length === 3 && TWO_LEVEL.test(h))) return;
  const [mx, txt, dmarc] = await Promise.all([doh(h, 'MX'), doh(h, 'TXT'), doh('_dmarc.' + h, 'TXT')]);
  if (mx == null || txt == null || dmarc == null) return;
  const spf = txt.find((t) => /^v=spf1/i.test(t));
  const dm = dmarc.find((t) => /^v=DMARC1/i.test(t));
  facts.dns = { mx: mx.length > 0, spf: !!spf, dmarc: dm ? (/p=(\w+)/i.exec(dm) || [])[1] || 'present' : null };
  if (!mx.length) return; // the domain does not receive mail; nothing to protect here
  if (!spf) {
    add('no-spf', 'Security', 'medium', 'No SPF record: anyone can send email pretending to be your domain',
      'Scammers can send invoices or "payment changed" emails that appear to come from you, and your real emails are more likely to land in spam.',
      'Add a TXT record "v=spf1 include:<your mail provider> ~all" at your DNS host.');
  }
  if (!dm) {
    add('no-dmarc', 'Security', 'medium', 'No DMARC record',
      'Without DMARC, receiving mail servers cannot be told to reject forged email from your domain. Gmail and Yahoo now expect it for reliable delivery.',
      'Add a TXT record at _dmarc.' + h + ': "v=DMARC1; p=none; rua=mailto:you@' + h + '", then move to p=quarantine once reports look clean.');
  } else if (/p=none/i.test(dm)) {
    add('weak-dmarc', 'Security', 'low', 'DMARC is in monitor-only mode (p=none)',
      'It reports forged email but does not stop it.',
      'After a few weeks of clean reports, change to p=quarantine, then p=reject.', { evidence: dm.slice(0, 120) });
  }
}

/* ----------------------------------------------------------------- speed */

async function speedFindings(ctx, add, facts) {
  const { $, url, headers, ttfb, html } = ctx;
  const origin = new URL(url).origin;

  if (ttfb != null) {
    facts.ttfb_ms = ttfb;
    if (ttfb > 2500) add('slow-server', 'Performance', 'high', 'Server is slow to respond (' + Math.round(ttfb) + ' ms)', 'Every page waits this long before anything starts loading; Google wants under 800 ms.', 'Check hosting plan and caching; put a CDN in front; cache the HTML where possible. (Measured from our server, so treat it as indicative.)');
    else if (ttfb > 1200) add('slow-server', 'Performance', 'medium', 'Server response is on the slow side (' + Math.round(ttfb) + ' ms)', 'Google recommends under 800 ms before the page even starts to load.', 'Add a CDN or page caching. (Measured from our server, so treat it as indicative.)');
  }
  const enc = headers['content-encoding'];
  facts.compression = enc || 'none';
  if (!enc && html.length > 15000) {
    add('no-compression', 'Performance', 'medium', 'The page is sent uncompressed',
      'The HTML is several times larger over the wire than it needs to be, which hurts mobile visitors most.',
      'Enable gzip or Brotli at the host / CDN (usually one switch).');
  }
  facts.server = headers.server || null;
  facts.cdn = headers['cf-ray'] ? 'Cloudflare' : headers['x-vercel-id'] ? 'Vercel' : headers['x-amz-cf-id'] ? 'CloudFront' : headers['x-served-by'] && /cache/i.test(headers['x-served-by']) ? 'Fastly' : headers['x-nf-request-id'] ? 'Netlify' : null;
  facts.http_cache = headers['cache-control'] || null;

  // Sample real assets.
  const abs = (v) => { try { return new URL(v, url).href; } catch { return null; } };
  const imgs = [...new Set($('img[src]').map((_, el) => abs($(el).attr('src'))).get().filter((u) => u && /^https?:/.test(u) && !u.startsWith('data:')))].slice(0, 8);
  const code = [...new Set($('script[src],link[rel="stylesheet"][href]').map((_, el) => abs($(el).attr('src') || $(el).attr('href'))).get().filter(Boolean))].filter((u) => u.startsWith(origin)).slice(0, 6);
  const probeOne = async (u) => {
    let r = await get(u, { method: 'HEAD', ms: 6000 });
    if (!r.res || r.res.status === 405 || r.res.status === 403) r = await get(u, { method: 'GET', ms: 6000, headers: { range: 'bytes=0-0' } });
    if (!r.res) return null;
    const h = r.res.headers;
    const range = /\/(\d+)$/.exec(h.get('content-range') || '');
    return {
      url: u, status: r.res.status,
      bytes: Number(range ? range[1] : h.get('content-length') || 0) || null,
      type: (h.get('content-type') || '').split(';')[0],
      cache: h.get('cache-control') || '',
      enc: h.get('content-encoding') || '',
    };
  };
  const probed = (await Promise.all([...imgs, ...code].map(probeOne))).filter(Boolean);
  const ownCache = probed.filter((p) => p.url.startsWith(origin) && p.status < 400);
  const maxAge = (c) => Number((/max-age=(\d+)/i.exec(c) || [])[1] || 0);

  const heavy = probed.filter((p) => /^image\//.test(p.type) && p.bytes && p.bytes > 400_000).sort((a, b) => b.bytes - a.bytes);
  if (heavy.length) {
    add('heavy-images', 'Performance', 'medium', heavy.length + ' image' + (heavy.length > 1 ? 's are' : ' is') + ' over 400 KB',
      'Large images are the most common reason pages feel slow on phones, and they eat visitors\' mobile data.',
      'Resize to the display size and export as WebP or AVIF; aim for under 150 KB each.', { evidence: heavy.slice(0, 3).map((p) => p.url.split('/').pop().slice(0, 40) + ' ' + Math.round(p.bytes / 1024) + ' KB').join(', ') });
  }
  const raster = probed.filter((p) => /image\/(jpeg|png)/.test(p.type));
  const modern = probed.filter((p) => /image\/(webp|avif)/.test(p.type));
  if (raster.length >= 3 && !modern.length) {
    add('legacy-image-formats', 'Performance', 'low', 'Images are all JPEG/PNG; none use modern formats',
      'WebP and AVIF are typically 25–50% smaller at the same quality.',
      'Convert photos to WebP/AVIF (most builders and CDNs can do this automatically) with a JPEG fallback.');
  }
  const uncached = ownCache.filter((p) => maxAge(p.cache) < 86400 && !/immutable/i.test(p.cache));
  if (ownCache.length >= 3 && uncached.length >= Math.ceil(ownCache.length / 2)) {
    add('weak-caching', 'Performance', 'medium', 'Images, scripts and styles are not cached for long',
      'Returning visitors re-download everything on every visit, so the site is slower than it should be and costs more bandwidth.',
      'Send Cache-Control: public, max-age=31536000, immutable for versioned assets (and a shorter lifetime for unversioned ones).', { evidence: uncached.slice(0, 2).map((p) => p.url.split('/').pop().slice(0, 30) + ': ' + (p.cache || 'no cache header')).join('; ') });
  }
  const uncompressed = probed.filter((p) => /javascript|css|svg|json/.test(p.type) && p.bytes && p.bytes > 20_000 && !p.enc && p.url.startsWith(origin));
  if (uncompressed.length) {
    add('no-compression-assets', 'Performance', 'medium', 'Scripts or styles are served without compression',
      'Text files compress 70–80%; sending them raw makes the page load slower for no reason.',
      'Enable gzip/Brotli for JS, CSS and SVG at the host or CDN.', { evidence: uncompressed[0].url.split('/').pop() });
  }
  facts.assets_sampled = probed.length;
}

/* ---------------------------------------------------------- broken links */

async function linkFindings(ctx, add, facts) {
  const { $, url } = ctx;
  const host = hostOf(url);
  const seen = new Set();
  const links = [];
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || /^(mailto:|tel:|javascript:|#|sms:|whatsapp:)/i.test(href)) return;
    let u;
    try { u = new URL(href, url); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || u.hostname !== host) return;
    u.hash = '';
    const k = u.href;
    if (seen.has(k) || k === url) return;
    seen.add(k);
    links.push(k);
  });
  const sample = links.slice(0, 16);
  facts.links_checked = sample.length;
  const out = [];
  let i = 0;
  const worker = async () => {
    while (i < sample.length) {
      const u = sample[i++];
      let r = await get(u, { method: 'HEAD', ms: 6000 });
      if (!r.res || r.res.status === 405 || r.res.status === 403 || r.res.status === 501) r = await get(u, { method: 'GET', ms: 6000 });
      if (r.res && (r.res.status === 404 || r.res.status === 410 || r.res.status >= 500)) out.push(u.replace(/^https?:\/\/[^/]+/, '') + ' → ' + r.res.status);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  facts.broken_links = out.length;
  if (out.length) {
    add('broken-links', 'SEO', out.length > 2 ? 'high' : 'medium', out.length + ' internal link' + (out.length > 1 ? 's lead' : ' leads') + ' to missing pages',
      'Visitors hit "page not found" dead ends and Google reads broken links as a sign of a neglected site.',
      'Fix or redirect each broken address (list in the evidence).', { evidence: out.slice(0, 5).join('; ') + (links.length > sample.length ? ' (checked ' + sample.length + ' of ' + links.length + ' links)' : '') });
  }
}

/* ------------------------------------------------------------------ main */

/**
 * Runs every outside-the-HTML check in parallel under one time cap.
 * ctx = { url, html, $, headers, cookies, ttfb } where `$` still has its
 * scripts. Returns { findings, facts }; always resolves, partial on timeout.
 */
export async function probe(ctx, capMs = 14000) {
  const findings = [];
  const facts = {};
  const add = (...a) => findings.push(finding(...a));
  const url = ctx.url;
  const host = hostOf(url);
  const safe = (fn) => Promise.resolve().then(fn).catch(() => {});

  // Synchronous, header- and HTML-based checks first: they cannot time out.
  headerFindings(ctx.headers || {}, ctx.cookies || [], url, add);
  htmlFindings(ctx.$, ctx.html, url, add, facts);

  const jobs = [
    safe(() => (/^https:/i.test(url) ? tlsFindings(host, add, facts) : null)),
    safe(() => redirectFindings(url, add, facts)),
    safe(() => indexFindings(url, add, facts)),
    safe(() => emailFindings(host, add, facts)),
    safe(() => speedFindings(ctx, add, facts)),
    safe(() => linkFindings(ctx, add, facts)),
  ];
  await Promise.race([Promise.allSettled(jobs), sleep(capMs)]);

  findings.sort((a, b) => SEV[b.severity] - SEV[a.severity]);
  return { findings: [...findings], facts: { ...facts } };
}
