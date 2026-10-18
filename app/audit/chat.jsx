'use client';

import { useEffect, useRef, useState } from 'react';

// The audit assistant: a chat that opens from any point on the page, remembers
// the conversation, and links each answer to the fix, section or area it is
// about. Only for the owner's view; the shared client report does not have it.

const STARTERS = [
  'What should I fix in the first hour?',
  'Summarise this audit for my client in simple words',
  'Which issues hurt enquiries the most?',
  'Why is my AI visibility score what it is?',
  'Write an email to the client with the top 3 fixes',
];

export default function AuditChat({ id, open, setOpen, onJump, hasAI, hasRivals }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const box = useRef(null);

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy, open]);
  useEffect(() => { if (open) setTimeout(() => box.current?.focus(), 60); }, [open]);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [setOpen]);

  async function send(q) {
    const t = (q ?? text).trim();
    if (!t || busy) return;
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: 'user', text: t }]);
    setText(''); setBusy(true);
    try {
      const res = await fetch('/api/audit/' + id + '/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: t, history }) });
      const j = await res.json().catch(() => ({}));
      setMsgs((m) => [...m, { role: 'assistant', text: j.answer || j.error || 'No answer came back.', refs: j.refs || [], bad: !j.answer }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: 'Could not reach Stash: ' + e.message, bad: true }]);
    } finally { setBusy(false); }
  }

  const starters = STARTERS.filter((s) => hasAI || !/AI visibility/.test(s));
  return (
    <>
      <button className='chat-fab' onClick={() => setOpen(!open)} aria-label='Ask about this audit' aria-expanded={open}>
        {open ? '×' : <><span className='spark'>✦</span> Ask Stash</>}
      </button>
      {open ? (
        <aside className='chat' role='dialog' aria-label='Ask about this audit'>
          <header>
            <div><b>Ask Stash</b><small>Answers come only from this audit{hasRivals ? ', competitors included' : ''}</small></div>
            {msgs.length ? <button className='btn sm' onClick={() => setMsgs([])}>Clear</button> : null}
          </header>
          <div className='chat-body'>
            {!msgs.length ? (
              <div className='chat-empty'>
                <p>Ask anything about this site&apos;s audit: a finding, a page, a fix, the AI visibility results, or what to tell the client.</p>
                {starters.map((s) => <button key={s} className='zchip' onClick={() => send(s)}>{s}</button>)}
              </div>
            ) : null}
            {msgs.map((m, i) => (
              <div key={i} className={'msg ' + m.role + (m.bad ? ' bad' : '')}>
                <div className='bub'>{m.text}</div>
                {m.refs?.length ? (
                  <div className='refs'>
                    {m.refs.map((r) => <a key={r.href} href={r.href} onClick={(e) => { e.preventDefault(); onJump(r.href.slice(1)); }}>{r.label} ↗</a>)}
                  </div>
                ) : null}
                {m.role === 'assistant' && !m.bad ? <button className='cp' onClick={() => navigator.clipboard?.writeText(m.text)}>Copy</button> : null}
              </div>
            ))}
            {busy ? <div className='msg assistant'><div className='bub typing'><i /><i /><i /></div></div> : null}
            <div ref={end} />
          </div>
          <form className='chat-in' onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder='Ask about a fix, a page, a score…'
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className='btn pri' disabled={busy || !text.trim()}>Send</button>
          </form>
        </aside>
      ) : null}
    </>
  );
}
