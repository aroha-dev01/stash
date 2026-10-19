// Two public Google signals that need no access to the client's accounts:
//
//  * Chrome UX Report (CrUX): how real Chrome visitors experienced the site
//    over the last 28 days (Core Web Vitals at the 75th percentile). Only
//    exists for sites with enough traffic, so "no data" is a normal answer.
//  * Safe Browsing: whether Google flags the site (or any page we read) as
//    malware, phishing, unwanted software or harmful.
//
// Uses GOOGLE_API_KEY, or the PageSpeed key if that one is allowed to call
// these two APIs too. Never throws; every failure becomes a note.

const KEY = () => process.env.GOOGLE_API_KEY || process.env.PAGESPEED_API_KEY || '';
export const googleEnabled = () => !!KEY();

const CRUX = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
const SAFE = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

// good <= first, poor > second
const LIMITS = {
  largest_contentful_paint: { name: 'LCP', good: 2500, poor: 4000, unit: 'ms' },
  interaction_to_next_paint: { name: 'INP', good: 200, poor: 500, unit: 'ms' },
  cumulative_layout_shift: { name: 'CLS', good: 0.1, poor: 0.25, unit: '' },
  first_contentful_paint: { name: 'FCP', good: 1800, poor: 3000, unit: 'ms' },
  experimental_time_to_first_byte: { name: 'TTFB', good: 800, poor: 1800, unit: 'ms' },
};
const rate = (v, l) => (v == null ? null : v <= l.good ? 'good' : v <= l.poor ? 'needs work' : 'poor');

async function queryCrux(body, ms = 9000) {
  try {
    const res = await fetch(CRUX + '?key=' + encodeURIComponent(KEY()), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 404) return { none: true };
    if (!res.ok) return { error: res.status + ': ' + String(j?.error?.message || '').slice(0, 140) };
    return { record: j.record };
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'timed out' : e.message };
  }
}

function readRecord(rec) {
  const metrics = {};
  for (const [id, l] of Object.entries(LIMITS)) {
    const m = rec?.metrics?.[id];
    const raw = m?.percentiles?.p75;
    if (raw == null) continue;
    const v = Number(raw);
    const h = (m.histogram || []).map((b) => Math.round((Number(b.density) || 0) * 100));
    metrics[l.name] = { p75: id === 'cumulative_layout_shift' ? Math.round(v * 1000) / 1000 : Math.round(v), unit: l.unit, rating: rate(v, l), good_pct: h[0] ?? null, poor_pct: h[2] ?? null };
  }
  const p = rec?.collectionPeriod;
  const d = (x) => (x ? x.year + '-' + String(x.month).padStart(2, '0') + '-' + String(x.day).padStart(2, '0') : null);
  return { metrics, period: p ? { from: d(p.firstDate), to: d(p.lastDate) } : null };
}

/** Field data for one form factor: the exact page first, then the whole site. */
async function fieldFor(url, formFactor) {
  const origin = new URL(url).origin;
  const metrics = Object.keys(LIMITS);
  let r = await queryCrux({ url, formFactor, metrics });
  let level = 'page';
  if (r.none) { r = await queryCrux({ origin, formFactor, metrics }); level = 'site'; }
  if (r.error) return { error: r.error };
  if (r.none) return { none: true };
  return { level, ...readRecord(r.record) };
}

export async function safeBrowsing(urls, ms = 9000) {
  const list = [...new Set(urls)].slice(0, 40);
  try {
    const res = await fetch(SAFE + '?key=' + encodeURIComponent(KEY()), {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(ms),
      body: JSON.stringify({
        client: { clientId: 'stash-audit', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: list.map((url) => ({ url })),
        },
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { checked: 0, error: res.status + ': ' + String(j?.error?.message || '').slice(0, 140) };
    return {
      checked: list.length,
      flagged: (j.matches || []).map((m) => ({ url: m.threat?.url, type: m.threatType })),
    };
  } catch (e) {
    return { checked: 0, error: e.name === 'TimeoutError' ? 'timed out' : e.message };
  }
}

const SB_NAME = { MALWARE: 'malware', SOCIAL_ENGINEERING: 'phishing or deceptive content', UNWANTED_SOFTWARE: 'unwanted software', POTENTIALLY_HARMFUL_APPLICATION: 'a harmful application' };
const finding = (id, category, severity, title, why, fix, extra = {}) => ({ id, category, severity, title, why, fix, ...extra });

/**
 * @param url   the audited homepage
 * @param pages every page URL read in this audit
 * @returns { facts, findings }
 */
export async function googleIntel(url, pages = []) {
  if (!googleEnabled()) return { facts: { skipped: 'No Google API key set.' }, findings: [] };
  const [phone, desktop, safe] = await Promise.all([fieldFor(url, 'PHONE'), fieldFor(url, 'DESKTOP'), safeBrowsing([url, ...pages])]);
  const facts = { fetched_at: new Date().toISOString(), field: { phone, desktop }, safe };
  const findings = [];

  if (safe.flagged?.length) {
    const types = [...new Set(safe.flagged.map((m) => SB_NAME[m.type] || m.type))];
    findings.push(finding('safe-browsing-flagged', 'Security', 'critical', 'Google flags this site as unsafe (' + types.join(', ') + ')',
      'Chrome and other browsers show a full-page red warning to visitors, and Google can drop the site from search. Almost nobody clicks past it.',
      'Find and remove the cause (a hacked file, injected script or a deceptive page). Then request a review in Google Search Console under Security issues.',
      { pages: [...new Set(safe.flagged.map((m) => m.url).filter(Boolean))] }));
  }

  const f = phone.metrics ? phone : null;
  if (f) {
    const bad = Object.entries(f.metrics).filter(([n, m]) => ['LCP', 'INP', 'CLS'].includes(n) && m.rating === 'poor');
    const mid = Object.entries(f.metrics).filter(([n, m]) => ['LCP', 'INP', 'CLS'].includes(n) && m.rating === 'needs work');
    const show = (arr) => arr.map(([n, m]) => n + ' ' + m.p75 + m.unit).join(', ');
    if (bad.length) {
      findings.push(finding('field-vitals-poor', 'Performance', 'high', 'Real visitors on phones have a poor experience (' + show(bad) + ')',
        'This is measured from real Chrome users over the last 28 days, not a lab test. Google uses it as a ranking signal, and slow pages lose enquiries.',
        'Start with the largest image or text block above the fold (LCP), then layout jumps (CLS) and slow taps (INP). The speed findings below point to the causes.'));
    } else if (mid.length) {
      findings.push(finding('field-vitals-average', 'Performance', 'medium', 'Real visitors on phones get a middling experience (' + show(mid) + ')',
        'Measured from real Chrome users over the last 28 days. Below the "good" line Google looks for.',
        'Compress and size the main image, reserve space for images and embeds, and trim scripts that run on load.'));
    }
  }
  return { facts, findings };
}
