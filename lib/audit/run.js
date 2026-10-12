import { db } from '../supabase.js';
import { engines } from '../models.js';
import { capture } from './capture.js';
import { classifySections } from './decide.js';
import { matchTools, designSection } from './design.js';

// An audit is a small state machine, advanced in slices.
//
//   queued -> capturing -> classifying -> designing -> done
//
// Vercel stops a function at 60 seconds and a full audit takes longer, so
// each call does as much as fits in its budget and returns. Whoever is
// watching (the audit page, or the MCP tool) simply calls again. Every step
// writes its result before moving on, so a timeout never loses work.

const NEEDS_WORK = 0.5;     // sections at or above this always get redesign directions
const MIN_DESIGNED = 4;     // ...and the weakest few always do, even on a good site —
                            // the point is to push every page further, not just fix breakage
const MAX_DESIGNED = 6;     // keeps cost and time bounded on long pages
const DESIGN_SECS = 30;     // don't start a design call with less time left than this
const CLASSIFY_SECS = 42;   // the one-shot scoring call can take up to 40s

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
  return { ...audit, sections: sections || [], tools };
}

const setAudit = (id, patch) => db.from('audits').update(patch).eq('id', id);

async function stepCapture(audit) {
  await setAudit(audit.id, { status: 'capturing', step_detail: 'Reading the page' });
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
      signals: { ...s.signals, tag: s.tag, headings: s.headings },
    }))
  );
  if (error) throw new Error(error.message);

  await setAudit(audit.id, {
    url: cap.url,
    title: cap.title,
    description: cap.description,
    site: cap.site,
    status: 'classifying',
    step_detail: 'Found ' + cap.sections.length + ' sections',
  });
}

const asSection = (row) => ({
  position: row.position,
  tag: row.signals?.tag,
  name_hint: row.name_hint,
  headings: row.signals?.headings || (row.heading ? [row.heading] : []),
  text_excerpt: row.text_excerpt || '',
  signals: row.signals || {},
});

async function stepClassify(audit) {
  await setAudit(audit.id, { step_detail: 'Scoring each section' });
  const { data: rows } = await db.from('audit_sections').select('*').eq('audit_id', audit.id).order('position');
  const site = { ...audit.site, title: audit.title, url: audit.url };

  const { results, engine } = await classifySections(rows.map(asSection), site);

  // Worst sections get directions; the rest are marked solid.
  const ranked = rows
    .map((r, i) => ({ r, res: results[i] }))
    .sort((a, b) => b.res.needs_work - a.res.needs_work);
  // Navbars and footers rarely benefit from an "upgrade" pass unless broken.
  const designable = ranked.filter((x) => x.res.needs_work >= NEEDS_WORK || !['navbar', 'footer', 'background'].includes(x.res.type));
  const chosen = new Set(
    designable
      .filter((x, i) => x.res.needs_work >= NEEDS_WORK || i < MIN_DESIGNED)
      .slice(0, MAX_DESIGNED)
      .map((x) => x.r.id)
  );

  for (const { r, res } of ranked) {
    await db.from('audit_sections').update({
      type: res.type,
      scores: res.scores,
      issues: res.issues,
      needs_work: Number(res.needs_work.toFixed(3)),
      status: chosen.has(r.id) ? 'classified' : 'skipped',
    }).eq('id', r.id);
  }

  await setAudit(audit.id, {
    status: 'designing',
    step_detail: chosen.size ? chosen.size + ' sections to redesign' : 'Nothing needs redesigning',
    engines: { ...audit.engines, decide: engine },
  });
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

async function finishAudit(audit) {
  const { data: rows } = await db.from('audit_sections').select('needs_work,status,type,issues').eq('audit_id', audit.id);
  const scored = (rows || []).filter((r) => r.needs_work != null);
  const health = scored.length
    ? Math.round(100 * (1 - scored.reduce((s, r) => s + Number(r.needs_work), 0) / scored.length))
    : null;
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

  await setAudit(audit.id, {
    status: 'done',
    step_detail: null,
    summary: {
      health,
      sections: scored.length,
      redesigned: (rows || []).filter((r) => r.status === 'designed').length,
      common_issues: Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => ({ issue: k, sections: n })),
      basics,
    },
  });
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
        if (left() < 20000) return;
        await setAudit(id, { engines: { ...audit.engines, ...engines() } });
        await stepCapture({ ...audit, engines: { ...audit.engines, ...engines() } });
      } else if (audit.status === 'classifying') {
        if (left() < CLASSIFY_SECS * 1000) return;
        await stepClassify(audit);
      } else if (audit.status === 'designing') {
        const { data: next } = await db
          .from('audit_sections').select('*')
          .eq('audit_id', id).eq('status', 'classified')
          .order('needs_work', { ascending: false }).limit(1);
        if (!next?.length) { await finishAudit(audit); return; }
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
