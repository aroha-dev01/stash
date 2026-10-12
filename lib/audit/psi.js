// Real-browser measurement through Google PageSpeed Insights (Lighthouse).
//
// This covers what reading HTML cannot: how fast the page actually loads on a
// phone, Core Web Vitals, rendered colour contrast, tap-target sizes, and a
// mobile screenshot. Google renders the page in real Chrome, so there is no
// headless browser to run here.
//
// Needs PAGESPEED_API_KEY (free, from Google Cloud). Without one, the public
// keyless quota is shared by everyone on the internet and is exhausted most
// of the day, so the step is skipped and the audit says so.

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CATEGORIES = ['performance', 'accessibility', 'seo', 'best-practices'];

const VITALS = {
  'largest-contentful-paint': 'LCP',
  'cumulative-layout-shift': 'CLS',
  'total-blocking-time': 'TBT',
  'first-contentful-paint': 'FCP',
  'speed-index': 'Speed Index',
};

export const psiEnabled = () => !!process.env.PAGESPEED_API_KEY;

export async function measure(url, timeoutMs = 40000) {
  if (!psiEnabled()) return { skipped: 'Add PAGESPEED_API_KEY in Vercel to measure speed, contrast and mobile layout.' };

  const qs = new URLSearchParams({ url, strategy: 'mobile', key: process.env.PAGESPEED_API_KEY });
  CATEGORIES.forEach((c) => qs.append('category', c));

  let res;
  try {
    res = await fetch(ENDPOINT + '?' + qs.toString(), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { skipped: 'PageSpeed did not answer in time (' + (e.name === 'TimeoutError' ? 'timed out' : e.message) + ').' };
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { skipped: 'PageSpeed error ' + res.status + ': ' + String(j?.error?.message || '').slice(0, 160) };

  const lh = j.lighthouseResult || {};
  const audits = lh.audits || {};
  const cats = lh.categories || {};

  const scores = {};
  for (const c of CATEGORIES) {
    if (cats[c]?.score != null) scores[c] = Math.round(cats[c].score * 100);
  }

  const vitals = {};
  for (const [id, name] of Object.entries(VITALS)) {
    if (audits[id]) vitals[name] = { value: audits[id].displayValue || null, score: audits[id].score };
  }

  // Failing audits, grouped by the category that references them, keeping the
  // ones a client would feel: performance opportunities with real savings,
  // every accessibility failure (contrast, tap targets, names), SEO failures.
  const failing = [];
  for (const c of CATEGORIES) {
    for (const ref of cats[c]?.auditRefs || []) {
      const a = audits[ref.id];
      if (!a || a.score == null || a.score >= 0.9) continue;
      if (['informative', 'notApplicable', 'manual'].includes(a.scoreDisplayMode)) continue;
      if (c === 'performance' && ref.group === 'metrics') continue; // vitals shown separately
      const savingsMs = a.details?.overallSavingsMs ?? null;
      failing.push({
        id: a.id,
        category: c,
        title: a.title,
        display: a.displayValue || null,
        score: a.score,
        savings_ms: savingsMs ? Math.round(savingsMs) : null,
        items: Array.isArray(a.details?.items) ? a.details.items.length : null,
      });
    }
  }
  const order = { accessibility: 0, performance: 1, seo: 2, 'best-practices': 3 };
  failing.sort((x, y) => (order[x.category] - order[y.category]) || ((y.savings_ms || 0) - (x.savings_ms || 0)) || (x.score - y.score));

  const shot = audits['final-screenshot']?.details?.data || null;

  return {
    strategy: 'mobile',
    fetched_at: new Date().toISOString(),
    scores,
    vitals,
    failing: failing.slice(0, 20),
    // A small data-URI JPEG of the page on a phone, as Lighthouse saw it.
    mobile_screenshot: shot && shot.length < 250_000 ? shot : null,
  };
}
