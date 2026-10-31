'use client';

import { useEffect, useState } from 'react';

// The landing page's one moment of motion: an agent asks Stash for help and
// gets ranked, installable picks back. The picks are real catalogue entries,
// passed in from the server. With reduced motion, everything shows at once.

const STEPS = [250, 900, 1500, 1800, 2100, 2700]; // ms at which each beat appears

export default function AgentDemo({ prompt, query, picks, reply }) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setBeat(STEPS.length);
      return;
    }
    const timers = STEPS.map((ms, i) => setTimeout(() => setBeat(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  const on = (n) => 'k-reveal' + (beat >= n ? ' on' : '');

  return (
    <figure className='k-demo' aria-label='Example: an AI agent asking Stash for the right tool' style={{ margin: 0 }}>
      <div className='k-demo-top'>
        <span>Your agent, with <b>Stash</b> connected</span>
        <span>MCP</span>
      </div>
      <div className='k-demo-body'>
        <div className={'k-msg-user ' + on(1)}>{prompt}</div>
        <div className={'k-call ' + on(2)}>
          stash.search_tools<span>({'{'} query: &quot;{query}&quot; {'}'})</span>
        </div>
        <div className={'k-picks ' + on(3)}>
          {picks.map((p, i) => (
            <div key={p.id} className={'k-pick ' + on(3 + i)}>
              <span className='k-pick-rank'>{i + 1}</span>
              <div>
                <div className='k-pick-name'>{p.title}</div>
                <div className='k-pick-why'>{p.why}</div>
              </div>
              <span className='k-pick-inst'>{p.install || p.kind}</span>
            </div>
          ))}
        </div>
        <p className={'k-msg-agent ' + on(6)} style={{ margin: 0 }}>{reply}</p>
      </div>
    </figure>
  );
}
