import { db } from '../supabase.js';
import { engines } from '../models.js';
import { capture, capturePageLite } from './capture.js';
import { classifySections } from './decide.js';
import { matchTools, designSection } from './design.js';
import { measure, psiEnabled } from './psi.js';
import { googleIntel } from './google.js';
import { buildPlan } from './plan.js';
import { seeSite, pickVisuals } from './see.js';
import { visionEnabled } from '../vision.js';
import { previousAudit, diffAudits } from './compare.js';

// An audit is a small state machine, advanced in slices.
//
//   queued -> capturing -> measuring -> classifying -> designing -> planning -> done
//
//   capturing   read the HTML, split sections, run technical checks
//   measuring   Lighthouse on mobile via PageSpeed (skipped without a key)
//   classifying Jev (or DeepSeek) scores every section
//   designing   redesign directions for the weakest sections, one per slice
//   planning    one ranked fix-first list + written summaries
//
// Vercel stops a function at 60 seconds and a full audit takes longer, so
// each call does as much as fits in its budget and returns. Whoever is
// watching (the audit page, or the MCP tool) simply calls again. Every step
// writes its result before moving on, so a timeout never loses work.

const NEEDS_WORK = 0.5;     // sections at or above this always get redesign directions
const MIN_DESIGNED = 4;     // ...and the weakest few always do, even on a good site —
                            // the point is to push every page further, not just fix breakage
const MAX_DESIGNED = 6;     // keeps cost and time bounded on long pages
const DESIGN_SECS = 40;     // design (≥12s) + Jev verification (≤13s) + library match
const CLASSIFY_SECS = 42;   // the one-shot scoring call can take up to 40s
const MEASURE_SECS = 42;    // PageSpeed can take up to 40s
const SEE_SECS = 32;        // screenshot download + one vision call
const PICK_SECS = 28;       // up to 5 reference images + one vision call
const PLAN_SECS = 40;      // Jev impact pass + the DeepSeek write-up

export async function createAudit(url, client) {
  const { data, error } = await db
    .from('audits')
    .insert({ url: String(url).trim(), client: client ? String(client).trim().slice(0, 80) : null })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function loadAudit(id, { withTools = true } = {}) {
  const { data: audit } = await db.from('audits').select('*').eq('id', id).maybeSingle();
  if (!audit) return null;

  const { data: sections } = await db
    .from('audit_sections')
    .select('*')
    .eq('audit_id', id)
    .order('position', { ascending: true });

  let tools = {};
  if (withTools) {
    const ids = [...new Set((sections || []).flatMap((s) => s.candidates || []))];
    if (ids.length) {
      const { data: links } = await db
        .from('links')
        .select('id,title,url,image,favicon,summary,type,usage_format,sections,style_tags,effect_kind,pricing')
        .in('id', ids);
      tools = Object.fromEntries((links || []).map((l) => [l.id, l]));
    }
  }
  // Before and after, against the last finished audit of the same site.
  let compare = null;
  if (withTools && audit.status === 'done' && audit.plan) {
    try {
      const prev = await previousAudit(audit);
      if (prev?.plan) compare = diffAudits(audit, prev);
    } catch {
      // The comparison is a bonus; the audit must always load.
    }
  }
  return { ...audit, sections: sections || [], tools, compare };
}

const setAudit = (id, patch) => db.from('audits').update(patch).eq('id', id);

async function stepCapture(audit) {
  await setAudit(audit.id, { status: 'capturing', step_detail: 'Reading the homepage' });
  const cap = await capture(audit.url);
  if (!cap.sections.length) throw new Error('Could not find any sections on that page. It may render everything with JavaScript.');

  // Re-running a failed capture must not duplicate rows.
  await db.from('audit_sections').delete().eq('audit_id', audit.id);
  const { error } = await db.from('audit_sections').insert(
    cap.sections.map((s) => ({
      audit_id: audit.id,
      position: s.position,
      name_hint: s.name_hint,
      heading: s.heading,
      text_excerpt: s.text_excerpt,
      signals: { ...s.signals, tag: s.tag, headings: s.headings, previews: s.previews || [], page: cap.url, page_path: '/', page_pos: s.position },
    }))
  );
  if (error) throw new Error(error.message);

  // Every page we will read, homepage first. The sub-pages are read next, a few
  // at a time, while the status stays 'capturing'.
  const pages = [
    { url: cap.url, path: '/', title: cap.title, status: 'done', home: true, sections: cap.sections.length, words: cap.site?.words ?? null },
    ...(cap.pages || []),
  ];
  const more = pages.length - 1;

  await setAudit(audit.id, {
    url: cap.url,
    title: cap.title,
    description: cap.description,
    site: { ...cap.site, pages },
    checks: cap.checks,
    status: more ? 'capturing' : 'measuring',
    step_detail: more
      ? 'Read the homepage (' + cap.sections.length + ' sections). Now reading ' + more + ' more page' + (more > 1 ? 's' : '')
      : 'Found ' + cap.sections.length + ' sections and ' + cap.checks.length + ' technical issues',
  });
}

// Reads the next few sub-pages in parallel: their checks and their sections.
// Each page is written as soon as it is read, so a timeout loses at most one batch.
async function stepPages(audit) {
  const pages = (audit.site?.pages || []).map((p) => ({ ...p }));
  // 'reading' left over from a slice that timed out is simply tried again.
  const todo = pages.filter((p) => p.status === 'queued' || p.status === 'reading').slice(0, 4);
  if (!todo.length) {
    const ok = pages.filter((p) => p.status === 'done').length;
    await setAudit(audit.id, { status: 'measuring', step_detail: 'Read ' + ok + ' page' + (ok === 1 ? '' : 's') });
    return;
  }
  todo.forEach((p) => { p.status = 'reading'; });
  await setAudit(audit.id, { site: { ...audit.site, pages }, step_detail: 'Reading ' + todo.map((p) => p.path).join(', ') });

  const read = await Promise.all(todo.map((p) => Promise.race([
    capturePageLite(p.url),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Took too long to read')), 24000)),
  ]).then((r) => ({ r }), (e) => ({ e }))));

  const { data: last } = await db.from('audit_sections').select('position').eq('audit_id', audit.id).order('position', { ascending: false }).limit(1);
  let next = last?.length ? last[0].position + 1 : 0;
  const checks = (audit.checks || []).map((c) => ({ ...c }));

  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    const { r, e } = read[i];
    if (e) { p.status = 'error'; p.error = String(e.message || e).slice(0, 120); continue; }
    const { data: have } = await db.from('audit_sections').select('id').eq('audit_id', audit.id).contains('signals', { page: r.url }).limit(1);
    if (!have?.length && r.sections.length) {
      const { error } = await db.from('audit_sections').insert(r.sections.map((s) => ({
        audit_id: audit.id,
        position: next++,
        name_hint: s.name_hint,
        heading: s.heading,
        text_excerpt: s.text_excerpt,
        signals: { ...s.signals, tag: s.tag, headings: s.headings, previews: s.previews || [], page: r.url, page_path: p.path, page_pos: s.position },
      })));
      if (error) { p.status = 'error'; p.error = error.message.slice(0, 120); continue; }
    }
    for (const c of r.checks) {
      const ex = checks.find((x) => x.id === c.id);
      if (ex) ex.pages = [...new Set([...(ex.pages || []), ...(c.pages || [])])];
      else checks.push(c);
    }
    Object.assign(p, { status: 'done', title: r.title, h1: r.h1, words: r.words, sections: r.sections.length, has_description: !!r.description, issues: r.checks.length, url: r.url });
  }

  const done = pages.filter((p) => p.status === 'done' || p.status === 'error').length;
  await setAudit(audit.id, {
    site: { ...audit.site, pages },
    checks,
    step_detail: 'Read ' + done + ' of ' + pages.length + ' pages',
  });
}

async function stepMeasure(audit) {
  await setAudit(audit.id, { step_detail: 'Measuring speed and accessibility on a phone' });
  const readPages = (audit.site?.pages || []).filter((p) => p.status === 'done').map((p) => p.url);
  const [psi, google] = await Promise.all([measure(audit.url), googleIntel(audit.url, readPages).catch(() => null)]);
  // Findings from real-visitor speed and Safe Browsing join the technical checks.
  const have = new Set((audit.checks || []).map((c) => c.id));
  const checks = [...(audit.checks || []), ...(google?.findings || []).filter((f) => !have.has(f.id))];
  await setAudit(audit.id, {
    psi, checks,
    site: google ? { ...audit.site, google: google.facts } : audit.site,
    status: 'classifying', step_detail: psi.skipped ? 'Skipped speed test' : 'Measured on mobile',
  });
}

async function stepPlan(audit) {
  await setAudit(audit.id, { step_detail: 'Ranking what to fix first' });
  const full = await loadAudit(audit.id, { withTools: false });
  // Health first, so the summary can mention it.
  const summary = await computeSummary(full);
  const plan = await buildPlan({ ...full, summary });
  await setAudit(audit.id, { status: 'done', step_detail: null, summary, plan });
}

const asSection = (row) => ({
  position: row.position,
  tag: row.signals?.tag,
  name_hint: row.name_hint,
  headings: row.signals?.headings || (row.heading ? [row.heading] : []),
  text_excerpt: row.text_excerpt || '',
  signals: row.signals || {},
});

// Looks at the rendered page with an open vision model. Runs once, inside the
// 'classifying' status, so Jev's section questions can use what it saw.
async function stepSee(audit, deadline) {
  await setAudit(audit.id, { step_detail: 'Looking at the page' });
  const { data: rows } = await db.from('audit_sections').select('*').eq('audit_id', audit.id).order('position');
  let visual;
  try {
    const homeUrl = audit.site?.pages?.[0]?.url;
    visual = await seeSite(audit.site || {}, rows.filter((r) => !homeUrl || !r.signals?.page || r.signals.page === homeUrl).map(asSection), deadline);
  } catch (e) {
    if (e.retry) return false;
    visual = { skipped: String(e.message || e).slice(0, 120) };
  }
  await setAudit(audit.id, { site: { ...audit.site, visual: visual || { skipped: 'Vision is off' } } });
  return true;
}

// For a designed section: look at the screenshots of its matched library
// tools and rank them by how well they suit this client's look.
async function stepPickVisuals(audit, row, deadline) {
  await setAudit(audit.id, { step_detail: 'Choosing visuals for #' + (row.position + 1) });
  const site = { ...audit.site, title: audit.title, url: audit.url };
  const section = { ...asSection(row), type: row.type, issues: row.issues };
  let visuals = [];
  let err = null;
  try {
    const ids = row.candidates || [];
    if (ids.length >= 2) {
      const { data: links } = await db.from('links').select('id,title,type,image').in('id', ids);
      const byId = Object.fromEntries((links || []).map((l) => [l.id, l]));
      visuals = await pickVisuals(section, site, ids.map((i) => byId[i]).filter(Boolean), deadline);
    }
  } catch (e) {
    if (e.retry) return false;
    err = String(e.message || e).slice(0, 120);
  }
  await db.from('audit_sections').update({
    suggestion: { ...(row.suggestion || {}), visuals, ...(err ? { visuals_error: err } : {}) },
  }).eq('id', row.id);
  return true;
}

const CHROME = ['navbar', 'footer', 'background', 'logos', 'loaders'];

// Scores the sections of one page, or two at a time once the homepage has set
// the tone. The homepage goes first because its judgement of the business
// (what it sells, what visitors should do) is reused for every other page.
// When every section has been scored, the weakest ones are chosen for redesign.
async function stepClassify(audit, leftMs) {
  const { data: rows } = await db.from('audit_sections').select('*').eq('audit_id', audit.id).order('position');
  const pages = audit.site?.pages || [];
  const homeUrl = pages[0]?.url;
  const pageOf = (r) => r.signals?.page || homeUrl || 'home';
  const unscored = rows.filter((r) => !r.type);

  if (unscored.length) {
    const groups = new Map();
    unscored.forEach((r) => { const k = pageOf(r); groups.set(k, [...(groups.get(k) || []), r]); });
    const homeDone = audit.site?.judgement !== undefined;
    const keys = [...groups.keys()];
    const batch = homeDone ? keys.slice(0, leftMs >= 42000 ? 2 : 1) : [keys.find((k) => k === homeUrl) || keys[0]];
    const thresholds = await learnedThresholds();
    let site = { ...audit.site };
    let engines = { ...audit.engines };

    await setAudit(audit.id, { step_detail: 'Scoring ' + batch.map((k) => (pages.find((p) => p.url === k)?.path || '/')).join(' and ') });
    await Promise.all(batch.map(async (key) => {
      const isHome = !homeDone;
      const group = groups.get(key);
      const meta = pages.find((p) => p.url === key) || {};
      const pageSite = isHome
        ? { ...audit.site, title: audit.title, url: audit.url, description: audit.description }
        : { ...audit.site, title: meta.title || audit.title, url: key, description: null, evidence: {} };
      try {
        const { results, engine, page } = await classifySections(group.map(asSection), pageSite, { thresholds, ...(isHome ? {} : { page: audit.site?.judgement || undefined }) });
        for (let i = 0; i < group.length; i++) {
          const res = results[i];
          await db.from('audit_sections').update({
            type: res.type,
            scores: { ...res.scores, ...(res.uncertain ? { uncertain: true } : {}) },
            issues: res.issues,
            needs_work: Number(res.needs_work.toFixed(3)),
          }).eq('id', group[i].id);
        }
        if (isHome) {
          engines = { ...engines, decide: engine };
          site = { ...site, judgement: page || null, thresholds_used: thresholds };
        }
      } catch (e) {
        if (isHome) throw e;
        // One page that cannot be scored must not sink the audit: mark its sections as not analysed.
        for (const r of group) await db.from('audit_sections').update({ type: 'other', scores: { error: String(e.message || e).slice(0, 100) }, issues: [], needs_work: 0 }).eq('id', r.id);
      }
    }));
    const total = rows.length;
    await setAudit(audit.id, { site, engines, step_detail: 'Scored ' + (total - unscored.length + batch.reduce((n, k) => n + groups.get(k).length, 0)) + ' of ' + total + ' sections' });
    return;
  }

  // Everything is scored: choose what gets redesign directions. The weakest
  // content section of each page is always considered, so every page gets a look.
  const live = rows.filter((r) => !r.scores?.error);
  const designable = live.filter((r) => !CHROME.includes(r.type) || Number(r.needs_work) >= 0.7)
    .sort((a, b) => Number(b.needs_work) - Number(a.needs_work));
  const cap = pages.length > 1 ? MAX_DESIGNED + 2 : MAX_DESIGNED;
  const picked = new Set(designable.filter((r, i) => Number(r.needs_work) >= NEEDS_WORK || i < MIN_DESIGNED).map((r) => r.id));
  const seen = new Set();
  for (const r of designable) {
    const k = pageOf(r);
    if (!seen.has(k) && Number(r.needs_work) >= 0.35) { seen.add(k); picked.add(r.id); }
  }
  const chosen = designable.filter((r) => picked.has(r.id)).slice(0, cap).map((r) => r.id);
  const chosenSet = new Set(chosen);
  const rest = rows.filter((r) => !chosenSet.has(r.id)).map((r) => r.id);
  if (chosen.length) await db.from('audit_sections').update({ status: 'classified' }).in('id', chosen);
  if (rest.length) await db.from('audit_sections').update({ status: 'skipped' }).in('id', rest);

  await setAudit(audit.id, {
    status: 'designing',
    step_detail: chosen.length ? chosen.length + ' sections to redesign' : 'Nothing needs redesigning',
  });
}

/**
 * Learns per-issue thresholds from your 👍/👎 on past findings. Feedback is
 * stored inside each audit's plan (plan.feedback), so this needs no extra
 * table. An issue type you mark "not an issue" more than ~30% of the time
 * needs more certainty from Jev before it is shown again (up to 0.85); one
 * you consistently confirm can be shown a little earlier (down to 0.55).
 * Needs at least 3 verdicts per issue before it moves anything.
 */
export async function learnedThresholds() {
  const { data } = await db.from('audits').select('plan').not('plan', 'is', null).order('created_at', { ascending: false }).limit(200);
  const tally = {};
  for (const row of data || []) {
    for (const fb of Object.values(row.plan?.feedback || {})) {
      if (!fb?.issue) continue;
      const t = (tally[fb.issue] ||= { up: 0, down: 0 });
      t[fb.verdict === 'down' ? 'down' : 'up']++;
    }
  }
  const out = {};
  for (const [issue, { up, down }] of Object.entries(tally)) {
    const n = up + down;
    if (n < 3) continue;
    const downRatio = down / n;
    if (downRatio > 0.3) out[issue] = Number(Math.min(0.85, 0.6 + 0.25 * ((downRatio - 0.3) / 0.7)).toFixed(3));
    else if (downRatio < 0.1 && n >= 5) out[issue] = 0.55;
  }
  return out;
}

async function stepDesignOne(audit, row, deadline) {
  const site = { ...audit.site, title: audit.title, url: audit.url };
  const section = { ...asSection(row), type: row.type, issues: row.issues, scores: row.scores };

  await setAudit(audit.id, { step_detail: 'Designing: ' + (row.type || 'section') + ' (#' + (row.position + 1) + ')' });
  try {
    const candidates = await matchTools(section, site);
    const { suggestion, engine } = await designSection(section, site, candidates, deadline);
    await db.from('audit_sections').update({
      candidates: candidates.map((c) => c.id),
      suggestion,
      status: 'designed',
    }).eq('id', row.id);
    return engine;
  } catch (e) {
    if (e.retry) return 'retry'; // left as 'classified'; the next call picks it up
    await db.from('audit_sections').update({
      suggestion: { error: String(e.message || e).slice(0, 300) },
      status: 'error',
    }).eq('id', row.id);
    return null;
  }
}

async function computeSummary(audit) {
  const rows = audit.sections || [];
  const scored = (rows || []).filter((r) => r.needs_work != null);

  // Health from Jev's redesign-upside levels rather than the raw average.
  // Audit #9 showed upside clusters mid-scale (0.33–0.6 → level 1–1.8), and
  // "works, one or two changes would lift it" (level 1) is a good section,
  // not a failing one — the old 1-minus-average formula scored a well-built
  // site 47. Each level maps to the quality it describes; page chrome
  // (navbar, footer) is excluded because it says little about the design.
  const LEVEL_QUALITY = [95, 75, 45, 15];
  const quality = (u) => {
    const s = Math.max(0, Math.min(3, Number(u) * 3));
    const lo = Math.floor(s);
    const hi = Math.min(3, lo + 1);
    return LEVEL_QUALITY[lo] + (LEVEL_QUALITY[hi] - LEVEL_QUALITY[lo]) * (s - lo);
  };
  const content = scored.filter((r) => !['navbar', 'footer', 'background', 'loaders'].includes(r.type));
  const withUpside = content.filter((r) => r.scores?.redesign_upside != null);
  let health = null;
  if (withUpside.length) {
    health = Math.round(withUpside.reduce((s, r) => s + quality(r.scores.redesign_upside), 0) / withUpside.length);
  } else if (content.length) {
    health = Math.round(100 * (1 - content.reduce((s, r) => s + Number(r.needs_work), 0) / content.length));
  }
  // Offer clarity from the page judgement nudges the score: an unclear offer
  // undermines every section below it.
  const offer = audit.site?.judgement?.offer_clarity;
  if (health != null && offer != null) health = Math.round(health * 0.85 + quality(1 - offer) * 0.15);
  const issueCounts = {};
  scored.forEach((r) => (r.issues || []).forEach((i) => (issueCounts[i] = (issueCounts[i] || 0) + 1)));

  const site = audit.site || {};
  const basics = [];
  if (!site.meta_description) basics.push('No meta description');
  if (site.h1_count === 0) basics.push('No H1 heading');
  if (site.h1_count > 1) basics.push(site.h1_count + ' H1 headings (should be one)');
  if (site.images_missing_alt > 0) basics.push(site.images_missing_alt + ' images missing alt text');
  if (!site.has_viewport) basics.push('No mobile viewport tag');
  if (!site.og_image) basics.push('No social share image');

  // Area scores from the deterministic checks: 100 minus a weight per finding.
  // Only shown for areas we could actually test (security/privacy need the probe).
  const W = { critical: 35, high: 20, medium: 10, low: 4 };
  const area = (cat) => Math.max(0, 100 - (audit.checks || []).filter((c) => c.category === cat).reduce((s, c) => s + (W[c.severity] || 0), 0));
  const site_scores = {};
  if (audit.site?.network) { site_scores.security = area('Security'); site_scores.privacy = area('Privacy'); }
  site_scores.seo = area('SEO');
  site_scores.performance_checks = area('Performance');
  if (audit.site?.ai?.score != null) site_scores.ai_visibility = audit.site.ai.score;

  const lh = audit.psi?.scores || null;
  return {
    health,
    site_scores,
    page: audit.site?.judgement || null,
    uncertain_sections: scored.filter((r) => r.scores?.uncertain).map((r) => r.position + 1),
    lighthouse: lh,
    sections: scored.length,
    redesigned: (rows || []).filter((r) => r.status === 'designed').length,
    technical_issues: (audit.checks || []).length,
    pages: (audit.site?.pages || []).filter((p) => p.status === 'done').length || undefined,
    common_issues: Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => ({ issue: k, sections: n })),
    basics,
  };
}

/** Moves an audit forward for up to budgetMs. Safe to call repeatedly. */
export async function advance(id, budgetMs = 45000) {
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);

  for (let guard = 0; guard < 20; guard++) {
    const { data: audit } = await db.from('audits').select('*').eq('id', id).maybeSingle();
    if (!audit) throw new Error('No audit ' + id);
    if (audit.status === 'done' || audit.status === 'error') return;

    try {
      if (audit.status === 'queued' || audit.status === 'capturing') {
        if (audit.site?.pages) {
          // The homepage is read; the other pages are read in batches.
          if (left() < 22000) return;
          await stepPages(audit);
          continue;
        }
        if (left() < 34000) return; // page fetch + the outside-the-HTML probes
        await setAudit(id, { engines: { ...audit.engines, ...engines() } });
        await stepCapture({ ...audit, engines: { ...audit.engines, ...engines() } });
      } else if (audit.status === 'measuring') {
        if (psiEnabled() && left() < MEASURE_SECS * 1000) return;
        await stepMeasure(audit);
      } else if (audit.status === 'classifying') {
        if (visionEnabled() && audit.site && audit.site.visual === undefined) {
          if (left() < SEE_SECS * 1000) return;
          if (!(await stepSee(audit, started + budgetMs - 4000))) return;
          continue;
        }
        if (left() < CLASSIFY_SECS * 1000) return;
        await stepClassify(audit, left());
      } else if (audit.status === 'planning') {
        if (left() < PLAN_SECS * 1000) return;
        await stepPlan(audit);
        return;
      } else if (audit.status === 'designing') {
        const { data: next } = await db
          .from('audit_sections').select('*')
          .eq('audit_id', id).eq('status', 'classified')
          .order('needs_work', { ascending: false }).limit(1);
        if (!next?.length) {
          // Designs are done; now pick visuals for each, one per pass.
          if (visionEnabled()) {
            const { data: done } = await db
              .from('audit_sections').select('*')
              .eq('audit_id', id).eq('status', 'designed')
              .order('needs_work', { ascending: false });
            const todo = (done || []).find((r) => r.suggestion && r.suggestion.visuals === undefined);
            if (todo) {
              if (left() < PICK_SECS * 1000) return;
              if (!(await stepPickVisuals(audit, todo, started + budgetMs - 4000))) return;
              continue;
            }
          }
          await setAudit(id, { status: 'planning', step_detail: 'Ranking what to fix first' });
          continue;
        }
        if (left() < DESIGN_SECS * 1000) return;
        const engine = await stepDesignOne(audit, next[0], started + budgetMs);
        if (engine === 'retry') return;
        if (engine && !audit.engines?.design_used) {
          await setAudit(id, { engines: { ...audit.engines, design_used: engine } });
        }
      }
    } catch (e) {
      await setAudit(id, { status: 'error', error: String(e.message || e).slice(0, 400), step_detail: null });
      return;
    }
  }
}
