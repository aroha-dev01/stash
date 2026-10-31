'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { clientOf, HERO_AGENTS } from '../_ui/agents';
import { ArrowIcon } from '../_ui/icons';
import AgentCharacter from '../_ui/AgentCharacter';
import { useAgent } from './AgentProvider';

// The three agents from the hero, settled side by side. Picking one shows an
// example of asking Stash from inside it, and where its setup lives. The
// prompts are examples of the kind of request, labelled as such; no results
// are shown here, so nothing is invented.

const EXAMPLES = {
  'claude-code': { prompt: 'Add sign-in to this Next.js app.', query: 'auth for a Next.js app' },
  cursor: { prompt: 'Add a command palette to this React app.', query: 'command palette component for React' },
  vscode: { prompt: 'Record a short demo of this feature as a GIF.', query: 'record the screen as a gif' },
  other: { prompt: 'Find a vector database for RAG.', query: 'vector database for RAG' },
};

const KEYS = [...HERO_AGENTS, 'other'];

export default function AgentEcosystem() {
  const { agent, setAgent } = useAgent();
  const tabs = useRef([]);
  const [hop, setHop] = useState(null);
  const hopTimer = useRef(0);
  const jump = (k) => {
    clearTimeout(hopTimer.current);
    setHop(k);
    hopTimer.current = setTimeout(() => setHop(null), 760);
  };
  const current = KEYS.includes(agent.key) ? agent.key : KEYS[0];
  const ex = EXAMPLES[current];
  const a = clientOf(current);

  // Arrow keys move between agents, as a tab list should.
  const onKey = (e, i) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + KEYS.length) % KEYS.length;
    setAgent(KEYS[n]);
    tabs.current[n]?.focus();
  };

  return (
    <section className='k-section k-eco' aria-labelledby='eco-h'>
      <div className='k-wrap'>
        <div className='k-section-head'>
          <span className='k-eyebrow'>Works where you build</span>
          <h2 id='eco-h' className='k-h2'>One discovery layer. Your favourite coding agents.</h2>
          <p className='k-lede'>Stash speaks MCP, so it plugs into the agents you already use. Same catalogue, same rules, whichever one is asking.</p>
        </div>

        <div className='k-eco-row' role='tablist' aria-label='Agents'>
          {KEYS.map((k, i) => {
            const c = clientOf(k);
            const on = k === current;
            return (
              <button
                key={k}
                ref={(el) => { tabs.current[i] = el; }}
                type='button'
                role='tab'
                id={'eco-tab-' + k}
                aria-selected={on}
                aria-controls='eco-panel'
                tabIndex={on ? 0 : -1}
                className='k-eco-card'
                style={{ '--tone': c.tone }}
                onClick={() => { setAgent(k); jump(k); }}
                onMouseEnter={() => jump(k)}
                onKeyDown={(e) => onKey(e, i)}
              >
                {HERO_AGENTS.includes(k) ? (
                  <span className='k-eco-char'><AgentCharacter agent={k} state={hop === k ? 'jumping' : 'idle'} selected={on} /></span>
                ) : (
                  <span className='k-agent-tile'><c.Mark size={24} /></span>
                )}
                <b>{c.name}</b>
                <span className='k-eco-where'>{c.where}</span>
                <span className='k-eco-what'>{c.workflow}</span>
              </button>
            );
          })}
        </div>

        <div className='k-eco-panel' role='tabpanel' id='eco-panel' aria-labelledby={'eco-tab-' + current}>
          <div className='k-eco-ex'>
            <span className='k-eyebrow'>Example prompt in {a.name}</span>
            <p className='k-eco-prompt'>{ex.prompt}</p>
            <code className='k-eco-call'>stash.<b>search_tools</b>({'{'} query: <s>&quot;{ex.query}&quot;</s> {'}'})</code>
            <p className='k-small k-muted' style={{ margin: 0 }}>
              Stash answers with ranked entries, what each needs, how to install it and when to skip it. Your agent decides with you.
            </p>
          </div>
          <div className='k-eco-setup'>
            <span className='k-eyebrow'>Setup</span>
            <p><b>{a.file}</b></p>
            <p className='k-small k-muted' style={{ margin: 0 }}>One command or one config block, with your key filled in.</p>
            <Link className='k-arrow' href={'/connect?client=' + current}>Setup guide for {a.name} <ArrowIcon /></Link>
          </div>
        </div>
      </div>
    </section>
  );
}
