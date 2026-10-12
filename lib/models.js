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

export function engines() {
  return {
    decide: process.env.OPENROUTER_API_KEY ? 'jev' : 'deepseek',
    design: process.env.ANTHROPIC_API_KEY ? 'claude' : 'deepseek',
    deepseek: llmStatus().enabled,
  };
}

/* ------------------------------------------------------------------- jev */

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';

/**
 * Asks Jev typed questions about one piece of state. Returns the raw answers
 * object: noul -> { noul: 0..1 }, choice -> { choice, confidence, probabilities }.
 */
export async function jevDecide(state, questions, timeoutMs = 20000) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');

  const res = await fetch(JEV_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.JEV_MODEL || 'typesafe/jev-1.13',
      state,
      questions,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Jev ' + res.status + ' ' + text.slice(0, 160));
  }
  const data = await res.json();
  return data.answers || {};
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
