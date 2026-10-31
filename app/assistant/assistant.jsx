'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { STASH_SOURCES_MARKER } from '@/lib/util';

const STARTERS = [
  'What should I use for auth in a Next.js app?',
  'Find me an MCP server for browser automation',
  'Compare the animation libraries in the catalogue',
];

/** Turns [#42] citations into links to the entry, using the sources the server sent. */
function Answer({ text, sources }) {
  const byId = new Map((sources || []).map((s) => [String(s.id), s]));
  const parts = String(text).split(/(\[#\d+\])/g);
  return (
    <div className='k-chat-a'>
      {parts.map((p, i) => {
        const m = p.match(/^\[#(\d+)\]$/);
        if (!m) return p.replace(/\*\*/g, '');
        const s = byId.get(m[1]);
        return s ? <Link key={i} href={'/explore?open=' + s.id}>{s.title}</Link> : null;
      })}
    </div>
  );
}

export default function Assistant() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const ask = async (question) => {
    const text = question.trim();
    if (!text || busy) return;
    setDraft('');
    setBusy(true);
    const convo = [...messages, { role: 'user', content: text }];
    setMessages([...convo, { role: 'assistant', content: '', sources: [] }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: convo.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'The assistant did not answer. Try again in a moment.');
      }

      // Tokens stream in; the citation list follows a marker at the very end.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const at = raw.indexOf(STASH_SOURCES_MARKER);
        const visible = at === -1 ? raw : raw.slice(0, at);
        setMessages([...convo, { role: 'assistant', content: visible, sources: [] }]);
      }
      const at = raw.indexOf(STASH_SOURCES_MARKER);
      let sources = [];
      if (at !== -1) {
        try { sources = JSON.parse(raw.slice(at + STASH_SOURCES_MARKER.length)); } catch { sources = []; }
      }
      const content = (at === -1 ? raw : raw.slice(0, at)).trim() || 'No answer came back. Ask again.';
      setMessages([...convo, { role: 'assistant', content, sources }]);
    } catch (e) {
      setMessages([...convo, { role: 'assistant', content: e.message, sources: [], failed: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className='k-chat'>
      <div className='k-chat-log' aria-live='polite'>
        {!messages.length ? (
          <div style={{ display: 'grid', gap: 16, paddingTop: 'clamp(24px, 8vh, 80px)' }}>
            <h1 className='k-h2'>Ask the catalogue</h1>
            <p className='k-lede'>Describe what you are building. The answer names the entries that fit and links straight to them.</p>
            <div className='k-suggest'>
              {STARTERS.map((s) => <button key={s} type='button' className='k-chip' onClick={() => ask(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className='k-msg-user'>{m.content}</div>
            ) : m.failed ? (
              <p key={i} className='k-error'>{m.content}</p>
            ) : (
              <Answer key={i} text={m.content || (busy ? 'Reading the catalogue' : '')} sources={m.sources} />
            )
          )
        )}
        <div ref={endRef} />
      </div>
      <form className='k-chat-form' onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        <label className='k-sr' htmlFor='k-ask'>Your question</label>
        <textarea
          id='k-ask'
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }}
          placeholder='What do you need a tool for?'
        />
        <button className='k-btn k-btn-brass' type='submit' disabled={busy || !draft.trim()} style={{ height: 52 }}>
          {busy ? 'Answering' : 'Ask'}
        </button>
      </form>
    </main>
  );
}
