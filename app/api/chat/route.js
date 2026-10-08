import { NextResponse } from 'next/server';
import { chatStream, llmStatus } from '@/lib/llm';
import { buildContext, SYSTEM } from '@/lib/context';
import { STASH_SOURCES_MARKER } from '@/lib/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TURNS = 12;

export async function POST(req) {
  const status = llmStatus();
  if (!status.enabled) {
    return NextResponse.json({ error: status.reason }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const incoming = Array.isArray(body.messages) ? body.messages : [];

  const history = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (!history.length) {
    return NextResponse.json({ error: 'Nothing to answer' }, { status: 400 });
  }

  const lastUser = [...history].reverse().find((m) => m.role === 'user');

  let context;
  try {
    context = await buildContext(lastUser ? lastUser.content : '');
  } catch (e) {
    return NextResponse.json({ error: 'Could not read your stash: ' + e.message }, { status: 500 });
  }

  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: context.text },
    ...history,
  ];

  let stream;
  try {
    stream = await chatStream(messages);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  // The cards the answer can cite are appended to the END of the body, after
  // a marker, rather than sent as a header — see STASH_SOURCES_MARKER for
  // why. The client strips everything from the marker onward before display
  // and parses it separately once the stream finishes.
  const finalStream = appendSources(stream, context.sources);

  return new Response(finalStream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-stash-total': String(context.total),
    },
  });
}

function appendSources(body, sources) {
  const encoder = new TextEncoder();
  const suffix = encoder.encode(STASH_SOURCES_MARKER + JSON.stringify(sources));

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally {
        // Sent even if the answer stream errored partway through, so a cut
        // short answer still leaves working citations for what it did say.
        controller.enqueue(suffix);
        controller.close();
      }
    },
  });
}
