import { NextResponse } from 'next/server';
import { importCodeFindings } from '@/lib/audit/codefindings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST the findings.json from Cloudflare's security-audit skill (run on the
// client's code) to attach it to this audit. Needs STASH_TOKEN: it changes the
// audit and the client report, so it is never open to visitors.
export async function POST(req, { params }) {
  const t = process.env.STASH_TOKEN;
  const h = req.headers.get('authorization') || '';
  if (!t || h !== 'Bearer ' + t) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Send the findings.json content as JSON' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await importCodeFindings(id, body)) });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 400 });
  }
}
