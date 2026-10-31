'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DrawerMark, CheckIcon } from '../_ui/icons';
import AgentCharacter from '../_ui/AgentCharacter';
import { useAgent } from './AgentProvider';
import { track } from '../_ui/track';

// The story, told by scroll: a developer asks an agent for something, the
// agent asks Stash, Stash searches, and the agent answers with real entries.
//
// Everything on screen is a pure function of scroll progress, so it reads the
// same scrolling fast, slow, backwards or arriving mid-way. Progress lives in
// a ref and a CSS variable; React re-renders only when the visible step
// changes. On narrow screens and under reduced motion there is no pinning:
// the six scenes are stacked panels, each in its finished state.

const PROMPT = 'Build a responsive landing page with smooth scroll animations and polished interactions.';
const CHECKS = ['Searching skills and plugins', 'Matching the task to what each entry does', 'Ranking relevant entries', 'Checking install steps and metadata'];

export const SCENES = [
  { title: 'The task', text: 'A developer describes what they are building, in plain words.' },
  { title: 'The agent thinks', text: 'Before reaching for a package by reflex, the agent looks for tools that fit.' },
  { title: 'The MCP request', text: 'It calls Stash’s search_tools over MCP with the task, not a product name.' },
  { title: 'Stash searches', text: 'Stash matches the task by meaning and ranks the catalogue’s entries.' },
  { title: 'Results', text: 'Real entries come back, with what each does, why it fits and how to install it.' },
  { title: 'The answer', text: 'The agent explains its pick. Stash recommends; nothing is installed until you say so.' },
];

const STEPS = 240; // resolution of the scrub: React renders at most this many times across the section

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

function queryWords(q) {
  return q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
}

const isReference = (item) => item.type === 'reference' || item.type === 'article';
const action = (item) => item.install || (isReference(item) ? 'Reference' : 'Setup in docs');

/** Why an entry fits, from its own data: the tags it shares with the task, or its first use case. */
function whyFits(item, query) {
  const words = queryWords(query);
  const tags = (item.tags || []).filter((t) => words.some((w) => t.includes(w.replace(/s$/, ''))));
  if (tags.length) return 'Tagged ' + tags.slice(0, 3).map((t) => t.replace(/-/g, ' ')).join(', ');
  return item.use_cases?.[0] || item.summary || '';
}

export default function McpScrollDemo({ picks, query }) {
  const { agent } = useAgent();
  const root = useRef(null);
  const [mode, setMode] = useState('stack'); // the server renders the stacked story
  const [step, setStep] = useState(0);
  const sent = useRef({});

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 960px) and (prefers-reduced-motion: no-preference)');
    const set = () => setMode(mq.matches ? 'scroll' : 'stack');
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);

  useEffect(() => {
    if (mode !== 'scroll') return;
    const el = root.current;
    let frame = 0;
    const read = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const run = r.height - window.innerHeight;
      const p = clamp(run > 0 ? -r.top / run : 0);
      el.style.setProperty('--p', p.toFixed(4));
      setStep(Math.round(p * STEPS));
      if (p > 0.02 && !sent.current.start) { sent.current.start = true; track('hero_demo_started'); }
      if (p > 0.96 && !sent.current.done) { sent.current.done = true; track('hero_demo_completed'); }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [mode]);

  // Scene buttons jump straight to that point of the story.
  const jump = useCallback((i) => {
    const el = root.current;
    if (mode !== 'scroll' || !el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const run = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + run * ((i + 0.62) / SCENES.length), behavior: 'smooth' });
  }, [mode]);

  const p = step / STEPS;
  const at = p * SCENES.length; // 0..6
  const scene = mode === 'scroll' ? Math.min(SCENES.length - 1, Math.floor(at)) : SCENES.length - 1;
  const local = mode === 'scroll' ? clamp(at - scene) : 1;
  const done = (i) => mode === 'stack' || scene > i || (scene === i && local >= 0.999);
  const part = (i) => (mode === 'stack' || scene > i ? 1 : scene === i ? local : 0);

  const typed = PROMPT.slice(0, Math.round(PROMPT.length * clamp(part(0) * 1.25)));
  const checks = Math.floor(clamp(part(3) * 1.15) * CHECKS.length);
  const shown = Math.ceil(clamp(part(4) * 1.4) * picks.length);
  const top = picks[0];

  const reply = top
    ? 'I found a suitable ' + (top.kind || 'tool').replace(/^[A-Z][a-z]/, (m) => m.toLowerCase()) + ' for this: ' + top.title + '. ' + whyFits(top, query).replace(/\.$/, '') + '. ' +
      (top.install
        ? 'To add it: ' + top.install + '. Want me to set it up?'
        : isReference(top)
          ? 'It is a reference to read for ideas, so there is nothing to install. Want me to pull ideas from it?'
          : 'Its docs cover the setup. Want me to follow them and wire it in?')
    : 'Nothing in the catalogue fits this yet, so I will say so rather than force a match.';

  const transcript = (
    <>
      {scene >= 0 ? (
        <div className={'k-mx-line k-mx-user' + (mode === 'scroll' && scene === 0 ? ' typing' : '')}>
          <span className='k-mx-prompt' aria-hidden='true'>{'>'}</span>
          <span>{mode === 'scroll' ? typed : PROMPT}{mode === 'scroll' && scene === 0 && local < 0.8 ? <i className='k-mx-caret' /> : null}</span>
        </div>
      ) : null}
      {part(1) > 0 ? (
        <div className={'k-mx-line k-mx-think' + (done(1) ? ' done' : '')}>
          <span className='k-mx-spin' aria-hidden='true' />
          <span>{done(2) ? 'Checked Stash for tools that fit this task.' : 'Looking for tools that fit this task…'}</span>
        </div>
      ) : null}
      {part(2) > 0.15 ? (
        <div className='k-mx-call'>
          <span className='k-mx-call-tag'>MCP · stash</span>
          <code>
            stash.<b>search_tools</b>({'{'}
            {'\n'}  query: <s>&quot;{query}&quot;</s>
            {'\n'}{'}'})
          </code>
        </div>
      ) : null}
      {part(3) > 0 ? (
        <ul className='k-mx-checks'>
          {CHECKS.map((c, i) => (
            <li key={c} className={i < checks ? 'on' : i === checks ? 'now' : ''}>
              <span aria-hidden='true'>{i < checks ? <CheckIcon size={12} /> : null}</span>
              {c}
            </li>
          ))}
        </ul>
      ) : null}
      {part(4) > 0 ? (
        <ol className='k-mx-results'>
          {picks.map((it, i) => (
            <li key={it.id} className={i < shown ? 'on' : ''}>
              <span className='k-mx-rank'>{i + 1}</span>
              <span className='k-mx-fav' aria-hidden='true'>{it.favicon ? <img src={it.favicon} alt='' loading='lazy' referrerPolicy='no-referrer' /> : null}</span>
              <span className='k-mx-res'>
                <b>{it.title}</b> <small>{it.kind}</small>
                <span>{it.summary}</span>
                <em>Why it fits: {whyFits(it, query)}</em>
              </span>
              <span className='k-mx-inst'>{action(it)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {part(5) > 0.1 ? (
        <div className='k-mx-line k-mx-agent'>
          <span className='k-agent-tile' style={{ '--tone': agent.tone }} aria-hidden='true'><agent.Mark size={16} /></span>
          <p>{reply}</p>
        </div>
      ) : null}
      {part(5) > 0.5 ? <p className='k-mx-foot'>Stash recommends. Nothing is installed until you say so.</p> : null}
    </>
  );

  const flow = mode === 'stack' ? 'done' : scene <= 1 ? 'idle' : scene === 2 ? 'req' : scene === 3 ? 'search' : scene === 4 ? 'res' : 'done';

  // The agent runs the wire: thinks, runs to the hub, asks, waits while Stash
  // searches, runs back with the results, and is pleased. Position and pose
  // are both read off scroll progress, so scrolling back rewinds them.
  const smooth = (t) => t * t * (3 - 2 * t);
  const runner =
    scene === 0 ? { x: 0, state: 'idle' }
      : scene === 1 ? { x: 0, state: 'waiting' }
        : scene === 2 ? (local < 0.8 ? { x: smooth(clamp(local / 0.8)), state: 'running', lean: 9 } : { x: 1, state: 'requesting', lean: 6 })
          : scene === 3 ? { x: 1, state: 'waiting' }
            : scene === 4 ? (local < 0.75 ? { x: 1 - smooth(clamp(local / 0.75)), state: 'running', lean: -9 } : { x: 0, state: 'idle' })
              : { x: 0, state: 'cheering' };

  if (mode === 'stack') {
    return (
      <section className='k-section k-mx k-mx-stack' id='how-it-works' aria-labelledby='mx-h'>
        <div className='k-wrap'>
          <Head />
          <ol className='k-mx-cards'>
            {SCENES.map((s, i) => (
              <li key={s.title}>
                <span className='k-mx-n'>{String(i + 1).padStart(2, '0')}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
                <div className='k-mx-panel k-mx-mini'>
                  <StackScene i={i} query={query} picks={picks} reply={reply} agent={agent} />
                </div>
              </li>
            ))}
          </ol>
          <Note picks={picks} />
        </div>
      </section>
    );
  }

  return (
    <section className='k-mx k-mx-scroll' id='how-it-works' aria-labelledby='mx-h' ref={root}>
      <div className='k-mx-pin'>
        <div className='k-wrap k-mx-grid'>
          <div className='k-mx-side'>
            <Head />
            <ol className='k-mx-scenes'>
              {SCENES.map((s, i) => (
                <li key={s.title} className={i === scene ? 'now' : i < scene ? 'past' : ''}>
                  <button type='button' onClick={() => jump(i)} aria-current={i === scene ? 'step' : undefined}>
                    <span className='k-mx-n'>{String(i + 1).padStart(2, '0')}</span>
                    <span>
                      <b>{s.title}</b>
                      <span>{s.text}</span>
                    </span>
                  </button>
                  <span className='k-mx-bar' aria-hidden='true'><i style={{ transform: 'scaleX(' + part(i) + ')' }} /></span>
                </li>
              ))}
            </ol>
          </div>

          <div className='k-mx-stage'>
            <div className={'k-mx-flow k-mx-flow-' + flow} aria-hidden='true'>
              <span className='k-mx-node' style={{ '--tone': agent.tone }}>{agent.name}</span>
              <span className='k-mx-wire'>
                <span className='k-mx-pkt k-mx-pkt-res'><i /></span>
                <span className='k-mx-runner' style={{ transform: 'translateX(' + runner.x * 100 + '%)' }}>
                  <span className='k-mx-runner-in'>
                    <AgentCharacter agent={agent.key} state={runner.state} lean={runner.lean || 0} size={58} />
                  </span>
                </span>
              </span>
              <span className='k-mx-node k-mx-node-hub'>
                <span className='k-agent-tile'><DrawerMark size={18} /></span>
                Stash MCP
              </span>
            </div>
            <div className='k-mx-panel' aria-hidden='true'>
              <div className='k-mx-bar-top'>
                <span className='k-mx-dots'><i /><i /><i /></span>
                <span>{agent.window}</span>
                <span className='k-mx-conn'><i />stash connected</span>
              </div>
              <div className='k-mx-body'><div className='k-mx-scroll-in'>{transcript}</div></div>
            </div>
            <Note picks={picks} />
          </div>
        </div>
      </div>
      <ol className='k-sr'>
        {SCENES.map((s) => <li key={s.title}>{s.title}: {s.text}</li>)}
        <li>The agent replied: {reply}</li>
      </ol>
    </section>
  );
}

function Head() {
  return (
    <div className='k-section-head'>
      <span className='k-eyebrow'>How it works</span>
      <h2 id='mx-h' className='k-h2'>Watch an agent find the right tool.</h2>
      <p className='k-lede'>Your agent stops guessing from the open internet and starts from tools someone has already vetted.</p>
    </div>
  );
}

function Note({ picks }) {
  return (
    <p className='k-mx-note'>
      {picks.length
        ? 'The results are what Stash’s search returns for this task today, from entries anyone can open.'
        : 'Live results are unavailable right now; the steps are the same.'}
    </p>
  );
}

/** One scene, finished, for the stacked layout. */
function StackScene({ i, query, picks, reply, agent }) {
  if (i === 0) return <div className='k-mx-line k-mx-user'><span className='k-mx-prompt'>{'>'}</span><span>{PROMPT}</span></div>;
  if (i === 1) return <div className='k-mx-line k-mx-think'><span className='k-mx-spin' aria-hidden='true' /><span>Looking for tools that fit this task…</span></div>;
  if (i === 2) return <div className='k-mx-call'><span className='k-mx-call-tag'>MCP · stash</span><code>stash.<b>search_tools</b>({'{'} query: <s>&quot;{query}&quot;</s> {'}'})</code></div>;
  if (i === 3) {
    return (
      <ul className='k-mx-checks'>
        {CHECKS.map((c) => <li key={c} className='on'><span aria-hidden='true'><CheckIcon size={12} /></span>{c}</li>)}
      </ul>
    );
  }
  if (i === 4) {
    return picks.length ? (
      <ol className='k-mx-results'>
        {picks.map((it, n) => (
          <li key={it.id} className='on'>
            <span className='k-mx-rank'>{n + 1}</span>
            <span className='k-mx-res'><b>{it.title}</b> <small>{it.kind}</small><em>Why it fits: {whyFits(it, query)}</em></span>
          </li>
        ))}
      </ol>
    ) : <p className='k-muted' style={{ margin: 0 }}>Live results are unavailable right now.</p>;
  }
  return (
    <div className='k-mx-line k-mx-agent'>
      <span className='k-agent-tile' style={{ '--tone': agent.tone }} aria-hidden='true'><agent.Mark size={16} /></span>
      <p>{reply}</p>
    </div>
  );
}
