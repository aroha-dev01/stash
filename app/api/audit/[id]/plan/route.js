import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Small, schema-free changes to an audit's plan, kept inside plan JSON like
// the feedback is:
//
//   { op: 'status',  item_key, status }       your own progress: open | doing | done
//   { op: 'approve', keys: [...], name, note } the client's go-ahead, from the report
//   { op: 'brand',   logo_url, color, agency } white-label the client report
//
// 'approve' is the only one the client's report calls. It can only record
// which of this audit's own items were approved; it changes nothing else.

const STATUSES = ['open', 'doing', 'done'];
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { data: audit } = await db.from('audits').select('id,plan').eq('id', Number(id)).maybeSingle();
  if (!audit) return NextResponse.json({ error: 'No such audit' }, { status: 404 });
  if (!audit.plan) return NextResponse.json({ error: 'Finish the audit first' }, { status: 409 });
  const plan = { ...audit.plan };
  const known = new Set((plan.items || []).map((i) => i.key));
  const now = new Date().toISOString();

  if (body.op === 'status') {
    const key = clean(body.item_key, 200);
    if (!known.has(key)) return NextResponse.json({ error: 'Unknown item' }, { status: 400 });
    const status = STATUSES.includes(body.status) ? body.status : null;
    const map = { ...(plan.status || {}) };
    if (status && status !== 'open') map[key] = { status, at: now }; else delete map[key];
    plan.status = map;
  } else if (body.op === 'approve') {
    const keys = [...new Set((Array.isArray(body.keys) ? body.keys : []).map((k) => clean(k, 200)).filter((k) => known.has(k)))].slice(0, 60);
    plan.approvals = { keys, name: clean(body.name, 80) || null, note: clean(body.note, 600) || null, at: now };
  } else if (body.op === 'brand') {
    const logo = clean(body.logo_url, 400);
    const color = clean(body.color, 12);
    plan.brand = {
      logo_url: /^https:\/\//i.test(logo) ? logo : null,
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : null,
      agency: clean(body.agency, 80) || null,
    };
  } else {
    return NextResponse.json({ error: 'Unknown op' }, { status: 400 });
  }

  const { error } = await db.from('audits').update({ plan }).eq('id', audit.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status: plan.status || {}, approvals: plan.approvals || null, brand: plan.brand || null });
}
