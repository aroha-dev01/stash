import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { advance, loadAudit } from '@/lib/audit/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function idFrom(params) {
  const { id } = await params;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

export async function GET(_req, { params }) {
  const id = await idFrom(params);
  const audit = id && (await loadAudit(id));
  if (!audit) return NextResponse.json({ error: 'No such audit' }, { status: 404 });
  return NextResponse.json(audit);
}

/** Advance the audit by one slice of work, then return its current state. */
export async function POST(_req, { params }) {
  const id = await idFrom(params);
  if (!id) return NextResponse.json({ error: 'No such audit' }, { status: 404 });
  try {
    await advance(id, 45000);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
  return NextResponse.json(await loadAudit(id));
}

/**
 * Pick a direction for a section: { section_id, picked }. Records the tools
 * that direction uses against the client, so the library learns which tools
 * actually get used in client work.
 */
export async function PATCH(req, { params }) {
  const id = await idFrom(params);
  const body = await req.json().catch(() => ({}));
  const sectionId = Number(body.section_id);
  const picked = body.picked === null ? null : Number(body.picked);

  const { data: audit } = await db.from('audits').select('id,url,client').eq('id', id).maybeSingle();
  const { data: section } = await db.from('audit_sections').select('*').eq('id', sectionId).eq('audit_id', id).maybeSingle();
  if (!audit || !section) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.from('audit_sections').update({ picked }).eq('id', sectionId);

  const direction = picked != null ? section.suggestion?.directions?.[picked] : null;
  const project = audit.client || new URL(audit.url).hostname.replace(/^www\./, '');
  const recorded = [];

  for (const toolId of direction?.tool_ids || []) {
    const { data: link } = await db.from('links').select('id,title,used_in,collections,used_count,why').eq('id', toolId).maybeSingle();
    if (!link) continue;
    const stamp = new Date().toISOString().slice(0, 10);
    const entry = stamp + ' — picked for ' + project + ' (' + (section.type || 'section') + ': ' + direction.title + ')';
    await db.from('links').update({
      used_in: [...new Set([...(link.used_in || []), project])],
      collections: [...new Set([...(link.collections || []), project])],
      used_count: (link.used_count || 0) + 1,
      last_used_at: new Date().toISOString(),
      why: link.why ? link.why + '\n' + entry : entry,
    }).eq('id', toolId);
    recorded.push(link.title);
  }

  return NextResponse.json({ ok: true, picked, filed_under: project, tools: recorded });
}
