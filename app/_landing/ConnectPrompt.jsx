'use client';

import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from '../_ui/icons';
import { useAgent } from './AgentProvider';
import ConnectButton from './ConnectButton';

// The one interruption on the page, and a polite one. It waits until the
// visitor has been through the demo and reached the featured entries, shows
// once per session, and never again for a month after "Maybe later". It never
// shows to a member whose agent is already connected. It does not take focus
// or lock scrolling: a card on desktop, a bottom sheet on phones. Escape or
// the close button dismiss it; the inline connect section stays either way.

const DISMISSED = 'stash.connectPrompt.dismissed';
const SEEN = 'stash.connectPrompt.seen';
const MONTH = 30 * 24 * 60 * 60 * 1000;

function store(kind) {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; }
}

export default function ConnectPrompt({ signedIn, connected, watch = '#featured' }) {
  const { agent } = useAgent();
  const [open, setOpen] = useState(false);
  const heading = useRef(null);

  useEffect(() => {
    if (connected) return;
    const dismissedAt = Number(store('local')?.getItem(DISMISSED) || 0);
    if (Date.now() - dismissedAt < MONTH || store('session')?.getItem(SEEN)) return;
    const target = document.querySelector(watch);
    if (!target) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      store('session')?.setItem(SEEN, '1');
      setOpen(true);
    }, { rootMargin: '0px 0px -35% 0px' });
    io.observe(target);
    return () => io.disconnect();
  }, [connected, watch]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const dismiss = () => {
    store('local')?.setItem(DISMISSED, String(Date.now()));
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className='k-prompt' role='dialog' aria-modal='false' aria-labelledby='prompt-h' aria-describedby='prompt-d'>
      <button type='button' className='k-x k-prompt-x' onClick={dismiss} aria-label='Close'><CloseIcon /></button>
      <span className='k-agent-tile' style={{ '--tone': agent.tone }} aria-hidden='true'><agent.Mark size={22} /></span>
      <h2 id='prompt-h' ref={heading}>Try Stash with {agent.short}.</h2>
      <p id='prompt-d'>Connect your agent and let it discover the right skills and tools while you build. Free with a Google sign-in.</p>
      <div className='k-prompt-acts'>
        <ConnectButton signedIn={signedIn} connected={connected} from='prompt'>Connect your agent</ConnectButton>
        <button type='button' className='k-btn k-btn-quiet' onClick={dismiss}>Maybe later</button>
      </div>
    </div>
  );
}
