import { parseLooseJSON } from './util.js';

// DeepSeek writes the summaries, categories and tags. Cheapest credible
// option and strong at structured extraction.
//
// Screenshot reading is paused, so no vision provider is wired up. When it
// comes back it plugs in alongside this, not instead of it.

const DEEPSEEK = 'https://api.deepseek.com/v1';

export function llmStatus() {
  const enabled = !!process.env.DEEPSEEK_API_KEY;
  return {
    enabled,
    provider: 'deepseek',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    reason: enabled ? null : 'DEEPSEEK_API_KEY is not set',
  };
}

export async function chatJSON(system, user, timeoutMs = 25000) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set');

  const res = await fetch(DEEPSEEK + '/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(res.status + ' ' + text.slice(0, 200));
  }
  const data = await res.json();
  return parseLooseJSON(data?.choices?.[0]?.message?.content ?? '');
}

/**
 * Streaming chat, used by the assistant.
 *
 * Answers routinely take ten seconds or more once retrieval and generation
 * are added up. Waiting that long staring at a spinner on a phone feels
 * broken, so the text is forwarded token by token as it arrives. DeepSeek
 * speaks SSE; this unwraps it into a plain text stream, which keeps the
 * client trivial.
 */
export async function chatStream(messages, timeoutMs = 55000) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set');

  const upstream = await fetch(DEEPSEEK + '/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0.3,
      stream: true,
      messages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    throw new Error(upstream.status + ' ' + text.slice(0, 200));
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // An SSE frame can be split across chunks, so the trailing
          // partial line is always carried over to the next round.
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;

            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') {
              controller.close();
              return;
            }
            try {
              const piece = JSON.parse(payload)?.choices?.[0]?.delta?.content;
              if (piece) controller.enqueue(encoder.encode(piece));
            } catch {
              // A malformed frame is not worth killing the answer over.
            }
          }
        }
        controller.close();
      } catch (e) {
        controller.enqueue(encoder.encode('\n\n[the answer was cut short: ' + e.message + ']'));
        controller.close();
      }
    },
  });
}
