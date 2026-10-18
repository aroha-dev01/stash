import { chatJSON, llmStatus } from './llm.js';
import { parseLooseJSON } from './util.js';

// One place that decides which model does which job, so the rest of the app
// never has to care which keys happen to be set today.
//
//   decisions  -> TypeSafe Jev (via OpenRouter)  if OPENROUTER_API_KEY is set
//   design     -> Claude                         if ANTHROPIC_API_KEY is set
//   everything -> DeepSeek                       always, as the fallback
//
// Adding a key in Vercel switches the engine on the next request; removing it
// falls straight back. Nothing else needs to change.

export const jevEnabled = () => !!(process.env.TYPESAFE_API_KEY || process.env.OPENROUTER_API_KEY);

// Images only go through the direct TypeSafe API (the documented path).
export const jevImagesEnabled = () => !!process.env.TYPESAFE_API_KEY;

/**
 * Turns a JPEG/PNG data URL (from fetchImage in vision.js) into a Jev asset.
 * Returns { ref, asset }: put `ref` anywhere in state / instructions / criteria
 * and pass `{ [ref]: asset }` as the `assets` option of jevDecide. Jev needs
 * each side 280–1568 px and under ~2.46 megapixels in total.
 */
export function jevAsset(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  const ref = 'img-' + crypto.randomUUID(); // unique, so it can never match real text by accident
  return { ref, asset: { type: 'image', format: m[1].toLowerCase() === 'png' ? 'png' : 'jpg', data_base64: m[2] } };
}

export function engines() {
  return {
    decide: jevEnabled() ? 'jev' : 'deepseek',
    design: process.env.ANTHROPIC_API_KEY ? 'claude' : 'deepseek',
    deepseek: llmStatus().enabled,
  };
}

/* ------------------------------------------------------------------- jev */

// Two ways in, per the TypeSafe docs (docs.typesafe.ai/api, OpenRouter's Jev guide):
//   TYPESAFE_API_KEY   -> https://api.typesafe.ai/v1/systemone, model jev-latest
//   OPENROUTER_API_KEY -> https://openrouter.ai/api/alpha/decisions, model typesafe/jev-1.13
// Same request and answer shapes either way.
function jevTarget() {
  if (process.env.TYPESAFE_API_KEY) {
    return {
      url: 'https://api.typesafe.ai/v1/systemone',
      key: process.env.TYPESAFE_API_KEY,
      model: process.env.JEV_MODEL || 'jev-latest',
    };
  }
  return {
    url: 'https://openrouter.ai/api/alpha/decisions',
    key: process.env.OPENROUTER_API_KEY,
    model: process.env.JEV_MODEL || 'typesafe/jev-1.13',
  };
}

/**
 * Asks Jev typed questions about one piece of state, all answered in parallel
 * in a single request. Returns the answers map:
 *   noul   -> { noul: 0..1 }                       probability of yes
 *   choice -> { choice, probabilities, confidence }
 *   score  -> { score, probabilities, confidence } position on the levels
 * Retries 429/529 with backoff, as the docs recommend.
 */
export async function jevDecide(state, questions, timeoutMs = 20000, { assets, model } = {}) {
  if (!jevEnabled()) throw new Error('No TypeSafe or OpenRouter key set');
  const t = jevTarget();
  const deadline = Date.now() + timeoutMs;

  // Images and Box questions are "danger zone" features: they need this header
  // on every request that contains one, and the direct TypeSafe API.
  const usesBox = Object.values(questions || {}).some((q) => q?.type === 'box');
  const usesImages = !!(assets && Object.keys(assets).length) || usesBox;
  if (usesImages && !jevImagesEnabled()) throw new Error('Images and Box questions need TYPESAFE_API_KEY (direct TypeSafe API)');
  const headers = { authorization: 'Bearer ' + t.key, 'content-type': 'application/json' };
  if (usesImages) headers['TypeSafe-Danger-Zone-Images'] = 'true';
  // Box needs Jev 1.14 ("jev-preview" until jev-latest moves to it).
  const useModel = model || (usesBox && t.model === 'jev-latest' ? 'jev-preview' : t.model);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(t.url, {
      method: 'POST',
      signal: AbortSignal.timeout(Math.max(2000, deadline - Date.now())),
      headers,
      body: JSON.stringify({ model: useModel, state, questions, ...(assets ? { assets } : {}) }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.answers || {};
    }
    const retryable = res.status === 429 || res.status === 529;
    const wait = 600 * 2 ** attempt;
    if (retryable && attempt < 3 && Date.now() + wait < deadline - 2000) {
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const text = await res.text().catch(() => '');
    throw new Error('Jev ' + res.status + ' ' + text.slice(0, 160));
  }
}

/* ---------------------------------------------------------------- claude */

/** Claude, asked for strict JSON. Throws on any failure so callers can fall back. */
export async function claudeJSON(system, user, { maxTokens = 2500, timeoutMs = 45000 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Claude ' + res.status + ' ' + text.slice(0, 160));
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseLooseJSON(text);
}

/**
 * The design model: Claude when available, DeepSeek otherwise, and DeepSeek
 * again if Claude errors. Returns { result, engine } so the audit can record
 * honestly which model wrote each suggestion.
 */
export async function designJSON(system, user, { maxTokens = 2500, deadline = Date.now() + 40000 } = {}) {
  const remaining = () => deadline - Date.now();
  const outOfTime = () => Object.assign(new Error('Ran out of time; will retry'), { retry: true });

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const t = Math.min(38000, remaining() - 2000);
      if (t < 10000) throw outOfTime();
      return { result: await claudeJSON(system, user, { maxTokens, timeoutMs: t }), engine: 'claude' };
    } catch (e) {
      if (e.retry) throw e;
      const t = remaining() - 1000;
      if (t < 12000) throw outOfTime();
      const result = await chatJSON(system, user, t);
      return { result, engine: 'deepseek (claude failed: ' + String(e.message).slice(0, 80) + ')' };
    }
  }
  const t = Math.min(40000, remaining() - 1000);
  if (t < 12000) throw outOfTime();
  return { result: await chatJSON(system, user, t), engine: 'deepseek' };
}
