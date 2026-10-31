'use client';

import { useEffect, useRef, useState } from 'react';
import AgentCharacter from '../_ui/AgentCharacter';

/**
 * An agent that peeks out from behind the featured cards once, when they come
 * into view, and ducks back. Decorative: it says nothing a screen reader needs.
 */
export default function Peeker({ agent = 'cursor' }) {
  const ref = useRef(null);
  const [state, setState] = useState('hidden');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    const timers = [];
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      timers.push(setTimeout(() => setState('peeking'), 500));
      timers.push(setTimeout(() => setState('hidden'), 3400));
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); timers.forEach(clearTimeout); };
  }, []);

  return (
    <span className={'k-peek' + (state === 'peeking' ? ' is-out' : '')} ref={ref} aria-hidden='true'>
      <span className='k-peek-in'>
        <AgentCharacter agent={agent} state={state === 'peeking' ? 'peeking' : 'idle'} />
      </span>
    </span>
  );
}
