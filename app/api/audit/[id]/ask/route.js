import { NextResponse } from 'next/server';
import { chatJSON } from '@/lib/llm';
import { loadAudit } from '@/lib/audit/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The audit assistant: a conversation about one audit, grounded only in what
// that audit found (every page, sections, fixes, technical checks, AI
// visibility, competitors, changes since the last audit). Answers can point at
// the fix, section or area they talk about, and the page turns those into links.

const SYSTEM = [
  'You are Stash, a senior web strategist helping a freelancer or agency understand one website audit.',
  'Answer ONLY from the audit data given. If it does not cover the question, say so plainly and suggest what to check. Never invent numbers, pages or findings.',
  'Be concrete: name the page, the section, the issue and the fix. Plain language unless asked for technical detail. Short paragraphs, no filler.',
  'When asked to explain something to a client, write it in non-technical words, ready to paste into an email.',
  'When asked to write something (a brief, an email, an llms.txt, copy), write it in full.',
  'The conversation so far is in "history"; use it for follow-ups like "and the second one?".',
  'refs: up to 4 things your answer is about, so the user can jump to them. Each is {"type":"fix","n":<fix number>} or {"type":"section","id":<section id>} or {"type":"area","id":"ai"|"pages"|"checks"|"compete"|"tools"}. Use only numbers and ids that appear in the data.',
  'Return strict JSON: { "answer": "...", "refs": [ ... ] }',
].join('\n');

const cut = (s, n) => (s == null ? undefined : String(s).slice(0, n));

function context(a) {
  const pages = a.site?.pages || [];
  const ai = a.site?.ai;
  return {
    site: { url: a.url, title: a.title, client: a.client, platform: a.site?.framework, fonts: a.site?.fonts },
    design_health: a.summary?.health,
    area_scores: a.summary?.site_scores,
    lighthouse_mobile: a.psi?.scores || (a.psi?.skipped ? 'not measured' : null),
    core_web_vitals: a.psi?.vitals || null,
    overview: a.plan?.overview,
    pages: pages.map((p) => ({ path: p.home ? '/' : p.path, status: p.status, title: cut(p.title, 80), words: p.words })),
    fixes: (a.plan?.items || []).slice(0, 40).map((i, k) => ({
      n: k + 1, tier: i.tier, area: i.category, issue: i.title, why: cut(i.why, 220), fix: cut(i.fix, 260), effort: i.effort,
      pages: i.pages && i.pages.length > 1 ? i.pages.length + ' pages' : undefined,
      client_status: a.plan?.status?.[i.key] || undefined,
    })),
    technical_checks: (a.checks || []).map((c) => ({ severity: c.severity, area: c.category, issue: c.title, fix: cut(c.fix, 160), wcag: c.wcag })),
    sections: (a.sections || []).map((s) => ({
      id: s.id, page: s.signals?.page_path || '/', n: (s.signals?.page_pos ?? s.position) + 1, type: s.type, heading: cut(s.heading, 80),
      verdict: s.status === 'skipped' ? 'solid' : s.status, problems: s.issues, needs_work: s.needs_work,
      diagnosis: cut(s.suggestion?.diagnosis, 300),
      directions: (s.suggestion?.directions || []).map((d) => cut(d.title + ': ' + d.idea, 200)),
    })),
    ai_visibility: ai ? {
      score: ai.score, parts: Object.values(ai.parts || {}).map((p) => p.label + ' ' + p.got + '/' + p.of),
      bots: (ai.bots || []).map((b) => b.name + ' (' + b.role + '): robots ' + b.robots + (b.live == null ? '' : ', firewall ' + (b.reachable ? 'lets in' : 'blocks'))),
      scrapers: (ai.scrapers || []).map((s) => s.name + ': ' + s.result),
      llms_txt: ai.llms_txt, schema_types: ai.schema_types, signals: ai.signals,
    } : undefined,
    competitors: (a.plan?.competitors || []).map((c) => ({ site: c.host, scores: c.scores, top_issues: (c.top || c.issues || []).slice?.(0, 4) })),
    since_last_audit: a.compare ? { health: a.compare.health, scores: a.compare.scores, fixed: (a.compare.resolved || []).length, new: (a.compare.added || []).length, still_open: a.compare.still } : undefined,
    client_approval: a.plan?.approvals || undefined,
  };
}

/** Turn the model's refs into links that exist on the page. */
function links(refs, a) {
  const nFix = (a.plan?.items || []).length;
  const secIds = new Set((a.sections || []).map((s) => s.id));
  const AREAS = { ai: 'AI visibility', pages: 'Pages analysed', checks: 'Technical checks', compete: 'Competitors', tools: 'Suggested tools' };
  const out = [];
  for (const r of Array.isArray(refs) ? refs : []) {
    if (r?.type === 'fix' && Number.isInteger(+r.n) && r.n >= 1 && r.n <= nFix) {
      const it = a.plan.items[r.n - 1];
      out.push({ label: 'Fix ' + r.n + ': ' + cut(it.title, 48), href: '#fix-' + r.n });
    } else if (r?.type === 'section' && secIds.has(+r.id)) {
      const s = a.sections.find((x) => x.id === +r.id);
      out.push({ label: (s.signals?.page_path && s.signals.page_path !== '/' ? s.signals.page_path + ' · ' : '') + (s.type || 'section'), href: '#s' + s.id });
    } else if (r?.type === 'area' && AREAS[r.id]) {
      out.push({ label: AREAS[r.id], href: '#' + r.id });
    }
  }
  const seen = new Set();
  return out.filter((l) => !seen.has(l.href) && seen.add(l.href)).slice(0, 4);
}

export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const question = String(body.question || '').trim().slice(0, 1500);
  if (!question) return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: cut(m.text, 900) })).filter((m) => m.text);

  const audit = await loadAudit(Number(id), { withTools: false });
  if (!audit) return NextResponse.json({ error: 'No such audit' }, { status: 404 });

  try {
    const r = await chatJSON(SYSTEM, JSON.stringify({ audit: context(audit), history, question }), 50000);
    return NextResponse.json({ answer: String(r?.answer || 'No answer came back.'), refs: links(r?.refs, audit) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
