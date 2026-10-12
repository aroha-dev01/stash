import { NextResponse } from 'next/server';
import { chatJSON } from '@/lib/llm';
import { loadAudit } from '@/lib/audit/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// "Ask about this audit": answers questions like "why is the FAQ flagged?",
// "what should I fix before Friday?", "explain the contrast issue to my
// client" — grounded only in what this audit actually found.

const SYSTEM = [
  'You are a senior web designer helping a colleague understand a website audit.',
  'Answer ONLY from the audit data given. If the audit does not cover the question, say so plainly and suggest what to check.',
  'Be concrete: name the section, the issue and the fix. Use plain language unless asked for technical detail.',
  'When asked to explain something to a client, write it in non-technical words they would understand.',
  'Return strict JSON: { "answer": "..." }',
].join('\n');

function context(a) {
  return {
    site: { url: a.url, title: a.title, client: a.client, platform: a.site?.framework, fonts: a.site?.fonts },
    design_health: a.summary?.health,
    lighthouse_mobile: a.psi?.scores || (a.psi?.skipped ? 'not measured' : null),
    core_web_vitals: a.psi?.vitals || null,
    overview: a.plan?.overview,
    fix_first: (a.plan?.items || []).slice(0, 25).map((i) => ({ tier: i.tier, area: i.category, issue: i.title, why: i.why, fix: i.fix, effort: i.effort })),
    technical_checks: (a.checks || []).map((c) => ({ severity: c.severity, area: c.category, issue: c.title, fix: c.fix, wcag: c.wcag })),
    sections: (a.sections || []).map((s) => ({
      n: s.position + 1, type: s.type, heading: s.heading, verdict: s.status === 'skipped' ? 'solid' : s.status,
      problems: s.issues, needs_work: s.needs_work, diagnosis: s.suggestion?.diagnosis,
      directions: (s.suggestion?.directions || []).map((d) => d.title + ': ' + d.idea),
    })),
  };
}

export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const question = String(body.question || '').trim().slice(0, 1000);
  if (!question) return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });

  const audit = await loadAudit(Number(id), { withTools: false });
  if (!audit) return NextResponse.json({ error: 'No such audit' }, { status: 404 });

  try {
    const r = await chatJSON(SYSTEM, JSON.stringify({ audit: context(audit), question }), 40000);
    return NextResponse.json({ answer: String(r?.answer || 'No answer came back.') });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
