import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { createAudit, advance, loadAudit } from '@/lib/audit/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Start an audit: { url, client? }. Does the first slice of work before replying. */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const url = String(body.url || '').trim();
  if (!url) return NextResponse.json({ error: 'Give it a site URL to audit.' }, { status: 400 });
  try {
    new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url);
  } catch {
    return NextResponse.json({ error: 'That does not look like a URL.' }, { status: 400 });
  }

  try {
    const id = await createAudit(url, body.client);
    await advance(id, 45000);
    return NextResponse.json(await loadAudit(id), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** Recent audits, newest first. */
export async function GET() {
  const { data, error } = await db
    .from('audits')
    .select('id,url,client,status,title,summary,error,created_at,site->>framework')
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ audits: data || [] });
}
