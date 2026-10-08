'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSwipeDown } from './swipe';
import { STASH_SOURCES_MARKER } from '@/lib/util';

const STARTERS = [
  'What have I saved for building a landing page?',
  'Do I have anything for user onboarding?',
  'Show me the open source tools I saved',
  'What should I use to record my screen?',
];

// Past conversations live in this browser only — there is no account system
// to sync them through, and a question you asked Stash is not sensitive
// enough to warrant one. Capped so a year of daily use does not quietly
// bloat localStorage forever.
const HISTORY_KEY = 'stash.chatHistory';
const HISTORY_CAP = 60;
const TITLE_CAP = 72;

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_CAP)));
  } catch {
    // Storage can be full or disabled (private browsing). A lost history
    // entry is not worth surfacing an error over.
  }
}

// Upserts one conversation by id and returns the updated list, newest first.
// A fresh id is minted the first time a conversation is saved, not when the
// sheet opens, so starting the chat and never sending anything leaves no trace.
function upsertHistory(list, id, messages) {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return list; // nothing worth remembering yet
  const title = firstUser.content.slice(0, TITLE_CAP);
  const now = Date.now();
  const existing = list.find((c) => c.id === id);
  const entry = { id, title, messages, updatedAt: now, createdAt: existing?.createdAt || now };
  const rest = list.filter((c) => c.id !== id);
  return [entry, ...rest];
}

function relativeTime(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.round(hours / 24);
  if (days < 7) return days + 'd ago';
  return new Date(ts).toLocaleDateString();
}

/**
 * Renders one assistant message, turning every citation the model wrote into
 * a real, clickable link. The prompt asks for exactly [#id], but a model
 * sometimes drifts to **#id**, a bare #id, or wraps the id and the tool name
 * together in bold — so this matches all of those rather than only the ideal
 * case, which is what was silently failing before (a raw "**#68 name**"
 * rendered as literal asterisks with nothing to click).
 *
 * A real <a href> is used rather than a plain button, so cmd/ctrl/middle
 * click opens the tool's actual URL in a new tab like any other link. A
 * plain click instead opens the richer in-app detail panel (install command,
 * limits, etc.), which is more useful than leaving the app for a bookmark
 * you already own.
 */
function Answer({ text, sources, onOpen }) {
  const byId = new Map((sources || []).map((s) => [String(s.id), s]));
  const nodes = [];
  let key = 0;

  const cite = (id) => {
    const src = byId.get(String(id));
    if (!src) return <span key={key++}>{'#' + id}</span>; // an id we were not given
    return (
      <a
        key={key++}
        href={src.url}
        target='_blank'
        rel='noopener noreferrer'
        className='cite'
        onClick={(e) => {
          // Modified clicks (new tab, new window, middle click) should behave
          // like a normal link. An unmodified click opens the in-app detail
          // panel instead, which is more useful than leaving the app.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
          e.preventDefault();
          onOpen(src.id);
        }}
      >
        {src.title}
      </a>
    );
  };

  // One pass, alternation in priority order: bold-wrapped citation (with or
  // without a trailing tool name), bracket citation, bare citation only when
  // the id is one we actually have a source for, then any other bold text
  // rendered as emphasis rather than left as literal asterisks.
  const re = /\*\*#(\d+)[^*]*\*\*|\[#(\d+)\]|#(\d+)\b|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    const [full, boldId, bracketId, bareId, boldText] = m;

    if (bareId != null && !byId.has(bareId)) {
      // Not a citation we recognise (e.g. a stray "#3" in prose) — leave it
      // exactly as written rather than guessing.
      continue;
    }

    if (m.index > last) nodes.push(<span key={key++}>{text.slice(last, m.index)}</span>);

    if (boldId != null) nodes.push(cite(boldId));
    else if (bracketId != null) nodes.push(cite(bracketId));
    else if (bareId != null) nodes.push(cite(bareId));
    else nodes.push(<strong key={key++}>{boldText}</strong>);

    last = m.index + full.length;
  }
  if (last < text.length) nodes.push(<span key={key++}>{text.slice(last)}</span>);

  return <div className='msg-body'>{nodes}</div>;
}

export default function ChatSheet({ onClose, onOpenLink, seed }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState(seed || '');
  const [streaming, setStreaming] = useState(false);
  const [total, setTotal] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  // The id of the conversation being persisted to. Minted lazily, on the
  // first message that actually gets sent, so opening the sheet and closing
  // it again without asking anything leaves nothing in history.
  const conversationId = useRef(null);

  // Dragging down closes the panel, but only while the conversation is
  // scrolled to the top, so reading a long answer never moves the sheet.
  const sheetRef = useSwipeDown(onClose);

  useEffect(() => { setChatHistory(loadHistory()); }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const persist = useCallback((finalMessages) => {
    if (!conversationId.current) {
      conversationId.current =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now() + '-' + Math.random().toString(36).slice(2);
    }
    setChatHistory((h) => {
      const updated = upsertHistory(h, conversationId.current, finalMessages);
      saveHistory(updated);
      return updated;
    });
  }, []);

  const openHistoryEntry = useCallback((entry) => {
    conversationId.current = entry.id;
    setMessages(entry.messages);
    setHistoryOpen(false);
  }, []);

  const startNewChat = useCallback(() => {
    conversationId.current = null;
    setMessages([]);
    setDraft('');
    setTotal(null);
    setHistoryOpen(false);
  }, []);

  const ask = useCallback(async (question) => {
    const text = (question || '').trim();
    if (!text || streaming) return;

    setDraft('');
    setStreaming(true);

    const convo = [...messages, { role: 'user', content: text }];
    setMessages([...convo, { role: 'assistant', content: '', sources: [] }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: convo.map((m) => ({ role: m.role, content: m.content })) }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'The assistant is unavailable');
      }

      const t = res.headers.get('x-stash-total');
      if (t) setTotal(Number(t));

      // The citation list rides at the end of the body after a marker,
      // rather than in a header — a header carrying every citable id as JSON
      // routinely exceeds what a proxy will actually deliver once the
      // library has more than a couple dozen links. Paint each token as it
      // lands so the answer reads as it is written, but never display the
      // marker or anything after it, even mid-stream.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = ''; // everything received, including a possible trailing marker+JSON
      let sources = [];

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });

        const markerAt = raw.indexOf(STASH_SOURCES_MARKER);
        const visible = markerAt === -1 ? raw : raw.slice(0, markerAt);
        setMessages((cur) => {
          const next = [...cur];
          next[next.length - 1] = { role: 'assistant', content: visible, sources };
          return next;
        });
      }

      const markerAt = raw.indexOf(STASH_SOURCES_MARKER);
      const visibleFinal = markerAt === -1 ? raw : raw.slice(0, markerAt);
      if (markerAt !== -1) {
        try {
          sources = JSON.parse(raw.slice(markerAt + STASH_SOURCES_MARKER.length));
        } catch {
          sources = [];
        }
      }

      const finalContent = visibleFinal.trim() ? visibleFinal : 'No answer came back. Try asking again.';
      const finalMessages = [...convo, { role: 'assistant', content: finalContent, sources }];
      setMessages(finalMessages);
      persist(finalMessages);
    } catch (e) {
      if (e.name === 'AbortError') return;
      const finalMessages = [...convo, { role: 'assistant', content: e.message, sources: [], failed: true }];
      setMessages(finalMessages);
      persist(finalMessages);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [messages, streaming, persist]);

  useEffect(() => {
    if (seed) ask(seed);
    // Intentionally once, on the seeded question only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className='sheet chat' ref={sheetRef}>
      <div className='chat-head'>
        <div>
          <h3 style={{ margin: 0 }}>{historyOpen ? 'Past questions' : 'Ask your stash'}</h3>
          <small style={{ color: 'var(--text-3)', fontSize: 12 }}>
            {historyOpen
              ? chatHistory.length + ' saved'
              : total != null ? 'Reading all ' + total + ' saved links' : 'Knows everything you have saved'}
          </small>
        </div>
        <div className='chat-head-actions'>
          {!historyOpen ? (
            <button className='icon-btn' onClick={startNewChat} aria-label='New chat' title='New chat'>
              <svg viewBox='0 0 24 24'><path d='M12 5v14M5 12h14' /></svg>
            </button>
          ) : null}
          <button
            className={historyOpen ? 'icon-btn active' : 'icon-btn'}
            onClick={() => setHistoryOpen((v) => !v)}
            aria-label={historyOpen ? 'Back to chat' : 'Past questions'}
            title='Past questions'
          >
            {historyOpen ? (
              <svg viewBox='0 0 24 24'><path d='M15 6l-6 6 6 6' /></svg>
            ) : (
              <svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='9' /><path d='M12 7v5l3.5 2' /></svg>
            )}
          </button>
          <button className='icon-btn' onClick={onClose} aria-label='Close'>
            <svg viewBox='0 0 24 24'><path d='M6 6l12 12M18 6L6 18' /></svg>
          </button>
        </div>
      </div>

      {historyOpen ? (
        <div className='chat-scroll' data-sheet-scroll>
          {chatHistory.length ? (
            <div className='chat-history'>
              {chatHistory.map((c) => (
                <button key={c.id} className='history-item' onClick={() => openHistoryEntry(c)}>
                  <span className='history-title'>{c.title}</span>
                  <span className='history-meta'>
                    {relativeTime(c.updatedAt)} · {c.messages.filter((m) => m.role === 'user').length} question
                    {c.messages.filter((m) => m.role === 'user').length === 1 ? '' : 's'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className='chat-intro'>
              <p>Nothing asked yet. Questions you send are kept here so you can come back to them.</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className='chat-scroll' ref={scrollRef} data-sheet-scroll>
            {!messages.length ? (
              <div className='chat-intro'>
                <p>
                  Describe the problem, not the tool. It reads every link you have saved,
                  including the summaries and notes, and answers from those.
                </p>
                <div className='starters'>
                  {STARTERS.map((s) => (
                    <button key={s} className='starter' onClick={() => ask(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'msg user' : 'msg bot'}>
                {m.role === 'user' ? (
                  <div className='msg-body'>{m.content}</div>
                ) : m.content ? (
                  <Answer text={m.content} sources={m.sources} onOpen={onOpenLink} />
                ) : (
                  <div className='typing'><span /><span /><span /></div>
                )}
              </div>
            ))}
          </div>

          <div className='chat-input'>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ask(draft); } }}
              placeholder='What are you trying to build?'
              enterKeyHint='send'
              autoComplete='off'
              disabled={streaming}
            />
            <button
              className='send-btn'
              onClick={() => ask(draft)}
              disabled={streaming || !draft.trim()}
              aria-label='Send'
            >
              <svg viewBox='0 0 24 24'><path d='M4 12h15M13 6l6 6-6 6' /></svg>
            </button>
          </div>
        </>
      )}
    </section>
  );
}
