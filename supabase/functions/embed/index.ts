// Text -> 384-dimension embedding, using gte-small inside the Edge Runtime.
// No API key and nothing billed per call; lib/embed.js is the only caller.
//
// POST { text } -> { embedding: number[384] }
//
// mean_pool + normalize gives unit vectors, so cosine distance in pgvector
// behaves as expected. The original production function was never in git,
// so after migrating, re-embed every row rather than mixing vectors that
// may have come from different settings.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const session = new Supabase.ai.Session('gte-small');

// The gateway has already verified the JWT signature (verify_jwt), so the
// payload can be read as-is. Only the server's service-role key may call
// this: the anon key ships to every browser and would turn the function
// into free compute for anyone.
function role(req: Request): string | null {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).role ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST { text }', { status: 405 });
  if (role(req) !== 'service_role') return Response.json({ error: 'Forbidden' }, { status: 403 });

  let text = '';
  try {
    text = String((await req.json()).text || '').slice(0, 2000);
  } catch {
    return Response.json({ error: 'Body must be JSON: { "text": "..." }' }, { status: 400 });
  }
  if (!text.trim()) return Response.json({ error: 'text is required' }, { status: 400 });

  const embedding = await session.run(text, { mean_pool: true, normalize: true });
  return Response.json({ embedding });
});
