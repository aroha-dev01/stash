import { capture } from './capture.js';

// A quick scan of a rival's site: the same page read, headers, certificate,
// DNS and link checks as an audit, scored the same way, but no vision model,
// no Jev and no redesign work, so three rivals fit in one request.

const W = { critical: 35, high: 20, medium: 10, low: 4 };

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return u; } };

export function normaliseUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null;
    return url.origin + (url.pathname === '/' ? '' : url.pathname);
  } catch { return null; }
}

/** Same scoring as an audit: 100 minus a weight per finding in that area. */
export function scoresFromChecks(checks, hasNetwork) {
  const area = (cat) => Math.max(0, 100 - (checks || []).filter((c) => c.category === cat).reduce((s, c) => s + (W[c.severity] || 0), 0));
  const out = { seo: area('SEO'), performance_checks: area('Performance') };
  if (hasNetwork) { out.security = area('Security'); out.privacy = area('Privacy'); }
  return out;
}

/** One rival → a compact, storable summary. Never throws. */
export async function scanRival(rawUrl, ms = 40000) {
  const url = normaliseUrl(rawUrl);
  if (!url) return { url: String(rawUrl || ''), host: String(rawUrl || ''), error: 'Not a valid web address' };
  try {
    const cap = await Promise.race([
      capture(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Took too long to scan')), ms)),
    ]);
    const net = cap.site?.network || null;
    const sev = { critical: 0, high: 1, medium: 2, low: 3 };
    return {
      url: cap.url || url,
      host: hostOf(cap.url || url),
      title: cap.title || null,
      scanned_at: new Date().toISOString(),
      scores: scoresFromChecks(cap.checks, !!net),
      facts: {
        ttfb_ms: net?.ttfb_ms != null ? Math.round(net.ttfb_ms) : null,
        cdn: net?.cdn || null,
        tls_days_left: net?.tls?.days_left ?? null,
        trackers: (net?.trackers || []).length,
        sections: cap.sections?.length ?? null,
        words: cap.site?.words ?? null,
        images: cap.site?.images ?? null,
        framework: cap.site?.framework || null,
        findings: (cap.checks || []).length,
      },
      top_issues: (cap.checks || [])
        .slice().sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9))
        .slice(0, 5).map((c) => ({ title: c.title, category: c.category, severity: c.severity })),
    };
  } catch (e) {
    return { url, host: hostOf(url), error: String(e.message || e).slice(0, 160) };
  }
}
