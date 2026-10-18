import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { ISSUES } from '@/lib/audit/decide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Your verdict on one finding: 'up' (right), 'down' (not an issue), or null
// to clear it. Stored in the audit's plan.feedback, and read back by
// learnedThresholds() so future audits show fewer of the issue types you
// keep rejecting. { item_key, verdict, issue_label? }

const LABEL_TO_KEY = Object.fromEntries(Object.entries(ISSUES).map(([k, v]) => [v.label, k]));

export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const itemKey = String(body.item_key || '').slice(0, 200);
  const verdict = body.verdict === 'up' || body.verdict === 'down' ? body.verdict : null;
  if (!itemKey) return NextResponse.json({ error: 'item_key is required' }, { status: 400 });

  const { data: audit } = await db.from('audits').select('id,plan').eq('id', Number(id)).maybeSingle();
  if (!audit) return NextResponse.json({ error: 'No such audit' }, { status: 404 });
  if (!audit.plan) return NextResponse.json({ error: 'Finish the audit first' }, { status: 409 });

  const issue = body.issue_label ? LABEL_TO_KEY[body.issue_label] || null : null;
  const feedback = { ...(audit.plan.feedback || {}) };
  if (verdict) feedback[itemKey] = { verdict, issue, at: new Date().toISOString() };
  else delete feedback[itemKey];

  const { error } = await db.from('audits').update({ plan: { ...audit.plan, feedback } }).eq('id', audit.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, feedback });
}
