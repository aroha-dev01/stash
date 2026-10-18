import { parseLooseJSON } from './util.js';

// Eyes for Stash: an open-weights vision-language model that can look at a
// screenshot and answer in JSON. Any OpenAI-compatible endpoint works.
//
//   OPENROUTER_API_KEY   used by default (same key Jev can use)
//   VISION_API_KEY       optional, overrides the key
//   VISION_BASE_URL      optional, e.g. https://api.together.xyz/v1 or a self-hosted vLLM
//   VISION_MODELS        optional comma list, tried in order. Default is a chain of
//                        open models; change it in Vercel without touching code.
//
// Everything that uses this must treat it as optional: no key, no model
// answer, or a bad image all fall back to "no visual read", never an error.

// Open-weight vision models on OpenRouter, free tier first, paid as backup
// (free models are rate-limited and the provider may log prompts):
//   Nemotron 3.5 Super VL  NVIDIA, OpenMDW licence, trained on GUI screenshots
//   Ling 3.0 Flash VL      inclusionAI, small and very cheap
const DEFAULT_MODELS = [
  'nvidia/nemotron-3.5-super-vl:free',
  'nvidia/nemotron-3.5-super-vl',
  'inclusionai/ling-3.0-flash-vl:free',
  'inclusionai/ling-3.0-flash-vl',
].join(',');

const base = () => (process.env.VISION_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const apiKey = () => process.env.VISION_API_KEY || process.env.OPENROUTER_API_KEY;
const models = () => (process.env.VISION_MODELS || DEFAULT_MODELS).split(',').map((s) => s.trim()).filter(Boolean);

export const visionEnabled = () => !!apiKey();
export const visionModels = () => models();

const OK_TYPES = { 'image/jpeg': 1, 'image/jpg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1 };
const guess = (url) => {
  const m = /\.(jpe?g|png|webp|gif)(\?|#|$)/i.exec(url || '');
  return m ? 'image/' + m[1].toLowerCase().replace('jpg', 'jpeg') : null;
};

/**
 * Downloads an image and returns it as a data URL, or null if it cannot be
 * used (too big, SVG, blocked, slow). We fetch it ourselves so the model
 * provider never has to reach a hotlink-protected site.
 */
export async function fetchImage(url, { maxBytes = 3_500_000, timeoutMs = 9000, maxWidth = 0, maxHeight = 0 } = {}) {
  try {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; StashBot/1.0)', accept: 'image/*' },
    });
    if (!res.ok) return null;
    let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!OK_TYPES[type]) type = guess(res.url) || guess(url) || type;
    if (!OK_TYPES[type]) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > maxBytes) return null;
    const small = maxWidth ? await shrink(buf, maxWidth, maxHeight) : null;
    if (small) return 'data:image/jpeg;base64,' + small.toString('base64');
    return 'data:' + type + ';base64,' + buf.toString('base64');
  } catch {
    return null;
  }
}

// Fewer pixels = fewer tokens = cheaper, faster, and under low-balance limits.
// Uses sharp when the runtime has it (Next installs it); otherwise sends as is.
async function shrink(buf, maxWidth, maxHeight) {
  try {
    const mod = 'sharp';
    const sharp = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ mod)).default;
    const resized = await sharp(buf).resize({ width: maxWidth, withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
    let img = sharp(resized.data);
    if (maxHeight && resized.info.height > maxHeight) {
      img = img.extract({ left: 0, top: 0, width: resized.info.width, height: maxHeight });
    }
    return await img.jpeg({ quality: 72 }).toBuffer();
  } catch {
    return null;
  }
}

// Models wrap JSON in prose, code fences or thinking text. Take the outermost
// {...} that parses; null if there is none.
function extractJSON(raw) {
  const s = String(raw || '');
  try { return parseLooseJSON(s); } catch { /* fall through */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { const j = JSON.parse(s.slice(a, b + 1)); if (j && typeof j === 'object') return j; } catch { /* no */ }
  }
  return null;
}

/**
 * Asks a vision model a question about one or more images, expecting JSON.
 * Tries each configured model in turn. Returns { result, model } or throws
 * with err.retry = true when the deadline, not the model, was the problem.
 */
export async function visionJSON(system, text, images, { deadline = Date.now() + 30000, maxTokens = 1400 } = {}) {
  if (!visionEnabled()) throw new Error('No vision key set');
  const imgs = (images || []).filter(Boolean);
  if (!imgs.length) throw new Error('No usable images');

  const errs = [];
  let lastErr = null;
  for (const model of models()) {
    const left = deadline - Date.now();
    if (left < 6000) break;
    try {
      const res = await fetch(base() + '/chat/completions', {
        method: 'POST',
        // One slow model must not eat the whole slice: move on after 22s.
        signal: AbortSignal.timeout(Math.min(left, 22000)),
        headers: {
          authorization: 'Bearer ' + apiKey(),
          'content-type': 'application/json',
          'x-title': 'Stash',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          // Headroom: a reasoning model can spend most of a small budget thinking
          // and leave nothing for the answer.
          max_tokens: maxTokens * 2,
          reasoning: { effort: 'low' }, // describing a screenshot needs no long chain of thought
          messages: [
            { role: 'system', content: system + '\nReply with the JSON object only: no prose, no markdown fences.' },
            {
              role: 'user',
              content: [{ type: 'text', text }, ...imgs.map((url) => ({ type: 'image_url', image_url: { url } }))],
            },
          ],
        }),
      });
      if (!res.ok) {
        lastErr = new Error(model + ' ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 120));
        errs.push(lastErr.message.slice(0, 110));
        continue;
      }
      const data = await res.json();
      const msg = data.choices?.[0]?.message || {};
      const text = (c) => (Array.isArray(c) ? c.map((p) => p.text || '').join('') : String(c || ''));
      // Some reasoning models leave `content` empty and put everything in `reasoning`.
      const raw = text(msg.content) || text(msg.reasoning);
      const result = extractJSON(raw);
      if (result) return { result, model };
      lastErr = new Error(model + ' sent no JSON: ' + (raw.replace(/\s+/g, ' ').slice(0, 90) || 'empty reply (finish: ' + (data.choices?.[0]?.finish_reason || '?') + ')'));
      errs.push(lastErr.message);
    } catch (e) {
      lastErr = e;
      errs.push(model + ': ' + (e.name === 'TimeoutError' ? 'timed out' : String(e.message).slice(0, 80)));
    }
  }
  // Every model failed: say why for each, so a bad key or balance is visible.
  const err = errs.length ? new Error(errs.join(' | ')) : new Error('Ran out of time for the vision call');
  if (!errs.length) err.retry = true;
  throw err;
}
