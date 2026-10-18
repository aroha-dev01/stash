import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { scanRival, normaliseUrl } from '@/lib/audit/compete';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Rival scans for one audit, kept in plan.competitors (no new table).
//   POST   { urls: [up to 3] }   scan them and add or refresh them
//   DELETE { host }              drop one
// Rivals are scanned in parallel, each capped so the whole call fits in 60s.

const MAX_RIVALS = 4;

export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const urls = [...new Set((Array.isArray(body.urls) ? body.urls : [body.url]).map(normaliseUrl).filter(Boolean))].slice(0, 3);
  if (!urls.length) return NextResponse.json({ error: 'Add up to three website addresses' }, { status: 400 });

  const { data: audit } = await db.from('audits').select('id,url,plan').eq('id', Number(id)).maybeSingle();
  if (!audit) return NextResponse.json({ error: 'No such audit' }, { status: 404 });
  if (!audit.plan) return NextResponse.json({ error: 'Finish the audit first' }, { status: 409 });

  const ownHost = (() => { try { return new URL(audit.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const fresh = (await Promise.all(urls.map((u) => scanRival(u, 40000)))).filter((r) => r.host !== ownHost);

  const byHost = new Map((audit.plan.competitors || []).map((c) => [c.host, c]));
  for (const r of fresh) byHost.set(r.host, r);
  const competitors = [...byHost.values()].slice(-MAX_RIVALS);

  const { error } = await db.from('audits').update({ plan: { ...audit.plan, competitors } }).eq('id', audit.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, competitors });
}

export async function DELETE(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { data: audit } = await db.from('audits').select('id,plan').eq('id', Number(id)).maybeSingle();
  if (!audit?.plan) return NextResponse.json({ error: 'No such audit' }, { status: 404 });
  const competitors = (audit.plan.competitors || []).filter((c) => c.host !== body.host);
  const { error } = await db.from('audits').update({ plan: { ...audit.plan, competitors } }).eq('id', audit.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, competitors });
}
