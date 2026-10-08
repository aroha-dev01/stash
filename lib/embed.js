// Embeddings come from a Supabase Edge Function running gte-small inside the
// Edge Runtime. No API key, nothing billed per call, and 384 dimensions to
// match the vector column. Semantic search therefore costs nothing to run.

export async function embed(text) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !text) return null;

  try {
    const res = await fetch(`${url}/functions/v1/embed`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ text: String(text).slice(0, 2000) }),
    });
    if (!res.ok) {
      console.log('embed failed:', res.status, (await res.text()).slice(0, 160));
      return null;
    }
    const { embedding } = await res.json();
    return Array.isArray(embedding) && embedding.length === 384 ? embedding : null;
  } catch (e) {
    // Search still works on keywords alone, so this is never fatal.
    console.log('embed error:', e.message);
    return null;
  }
}

/** Text that best represents a link for similarity purposes. */
export function embeddingText(link) {
  return [
    link.title,
    link.summary,
    link.description,
    link.category,
    (link.use_cases || []).join('. '),
    (link.tags || []).join(' '),
    link.note,
    link.ocr_text,
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 1500);
}
