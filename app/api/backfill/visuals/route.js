import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { visionEnabled, visionJSON, fetchImage } from '@/lib/vision';
import { STYLES } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Looks at each library tool's screenshot with a vision model and adds the
// visual styles it can actually SEE to the tool's style_tags, so "find me
// something minimal/dark/editorial" works from what the tool looks like, not
// just what its page says. Merge-only (never removes tags), so it is safe to
// re-run. Walks the library by id: call with { after: <next_after> } until
// `done` is true.

const BUDGET_MS = 44000;
const CONCURRENCY = 3;

const SYSTEM = [
  'You look at one screenshot of a web design tool, template or reference site.',
  'Pick the visual styles you can actually see, only from this list: ' + STYLES.join(', ') + '.',
  'Return strict JSON: { "styles": [up to 3 from the list], "palette": "dark | light | colourful | mixed" }',
].join('\n');

export async function POST(req) {
  const secret = process.env.STASH_TOKEN;
  if (secret && (req.headers.get('authorization') || '') !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  if (!visionEnabled()) return NextResponse.json({ error: 'No vision key (OPENROUTER_API_KEY or VISION_API_KEY)' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  let after = Number(body.after) || 0;
  const started = Date.now();
  let seen = 0, updated = 0, skipped = 0, done = false;
  const failed = [];

  while (Date.now() - started < BUDGET_MS - 14000) {
    const { data: batch, error } = await db
      .from('links')
      .select('id,title,image,style_tags')
      .eq('status', 'ready')
      .not('image', 'is', null)
      .gt('id', after)
      .order('id', { ascending: true })
      .limit(CONCURRENCY);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!batch?.length) { done = true; break; }

    await Promise.all(batch.map(async (l) => {
      try {
        const img = await fetchImage(l.image, { maxBytes: 2_500_000, timeoutMs: 8000 });
        if (!img) { skipped++; return; }
        const { result } = await visionJSON(SYSTEM, 'Tool: ' + l.title, [img], { deadline: Date.now() + 25000, maxTokens: 300 });
        const seenStyles = (Array.isArray(result.styles) ? result.styles : []).map((s) => String(s).toLowerCase().trim()).filter((s) => STYLES.includes(s));
        const merged = [...new Set([...(l.style_tags || []), ...seenStyles])].slice(0, 6);
        if (merged.length !== (l.style_tags || []).length) {
          await db.from('links').update({ style_tags: merged }).eq('id', l.id);
          updated++;
        }
      } catch (e) {
        failed.push({ id: l.id, why: String(e.message || e).slice(0, 100) });
      }
    }));
    seen += batch.length;
    after = batch[batch.length - 1].id;
  }

  return NextResponse.json({ ok: true, took_ms: Date.now() - started, looked_at: seen, updated, skipped, failed, next_after: after, done });
}

export async function GET() {
  const { count } = await db.from('links').select('id', { count: 'exact', head: true }).eq('status', 'ready').not('image', 'is', null);
  return NextResponse.json({ links_with_screenshot: count ?? 0, vision: visionEnabled() });
}
