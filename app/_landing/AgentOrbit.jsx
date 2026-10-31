'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StashMark } from '../_ui/icons';
import { clientOf, HERO_AGENTS } from '../_ui/agents';
import AgentCharacter from '../_ui/AgentCharacter';
import { useAgent } from './AgentProvider';
import { track } from '../_ui/track';

// The hero stage: Claude Code, Cursor and Copilot as characters around the
// Stash hub. They idle, and now and then one trots a short way round the
// orbit. Hover makes one jump; click (or Enter) makes it the demo's agent.
// Scrolling the hero away is the story's first beat: the selected agent runs
// to the hub and raises a hand, and its request line lights up.
//
// Who wins when several things want an agent: scroll (running, requesting)
// beats hover (jumping), which beats a patrol run, which beats idle. Movement
// is a transform on a wrapper; poses are the character's own state. On phones
// nobody travels, and under reduced motion nobody moves at all.

const SPOTS = {
  'claude-code': { x: 17, y: 24 },
  cursor: { x: 83, y: 26 },
  vscode: { x: 50, y: 84 },
};
const HUB = { x: 50, y: 50 };
const PATROL_EVERY = 4600;
const RUN_MS = 900;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export default function AgentOrbit({ picks }) {
  const { agent, setAgent } = useAgent();
  const stage = useRef(null);
  const [inView, setInView] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [motion, setMotion] = useState('still'); // full | lite (phones) | still (reduced motion); the server renders still
  const [hover, setHover] = useState(null);
  const [patrol, setPatrol] = useState({});
  const [run, setRun] = useState({ p: 0, moving: false });
  const hoverTimer = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const phone = window.matchMedia('(max-width: 640px)');
    const set = () => setMotion(reduce.matches ? 'still' : phone.matches ? 'lite' : 'full');
    set();
    reduce.addEventListener('change', set);
    phone.addEventListener('change', set);
    return () => { reduce.removeEventListener('change', set); phone.removeEventListener('change', set); };
  }, []);

  useEffect(() => {
    const el = stage.current;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Travel is in pixels, since a percentage transform is relative to the element itself.
  useLayoutEffect(() => {
    const el = stage.current;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll: how far the hero has left the screen drives the selected agent's run.
  useEffect(() => {
    if (motion !== 'full') { setRun({ p: 0, moving: false }); return; }
    const hero = stage.current.closest('section');
    let frame = 0;
    let still = 0;
    const read = () => {
      frame = 0;
      const r = hero.getBoundingClientRect();
      const p = Math.round(clamp(-r.top / (r.height * 0.7)) * 100) / 100;
      setRun((cur) => (cur.p === p && cur.moving === (p > 0 && p < 1) ? cur : { p, moving: p > 0 && p < 1 }));
      clearTimeout(still);
      still = setTimeout(() => setRun((cur) => ({ ...cur, moving: false })), 180);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); clearTimeout(still); };
  }, [motion]);

  // Patrol: now and then an agent that is not selected trots along the orbit and back.
  useEffect(() => {
    if (motion !== 'full' || !inView || !size.w) return;
    const timers = [];
    let turn = 0;
    let side = 1;
    const tick = () => {
      if (window.scrollY > 40) return; // the hero is busy telling the story
      const others = HERO_AGENTS.filter((k) => k !== agent.key);
      const k = others[turn++ % others.length];
      const s = SPOTS[k];
      // Tangent to the orbit at this agent: perpendicular to the line to the hub.
      const vx = ((s.x - HUB.x) / 100) * size.w;
      const vy = ((s.y - HUB.y) / 100) * size.h;
      const len = Math.hypot(vx, vy) || 1;
      side = -side;
      const to = { x: (-vy / len) * 30 * side, y: (vx / len) * 30 * side };
      setPatrol((p) => ({ ...p, [k]: { ...to, running: true } }));
      timers.push(setTimeout(() => setPatrol((p) => ({ ...p, [k]: { ...to, running: false } })), RUN_MS));
      timers.push(setTimeout(() => setPatrol((p) => ({ ...p, [k]: { x: 0, y: 0, running: true } })), RUN_MS + 2200));
      timers.push(setTimeout(() => setPatrol((p) => ({ ...p, [k]: { x: 0, y: 0, running: false } })), 2 * RUN_MS + 2200));
    };
    const every = setInterval(tick, PATROL_EVERY);
    return () => { clearInterval(every); timers.forEach(clearTimeout); setPatrol({}); };
  }, [motion, inView, size.w, size.h, agent.key]);

  const spot = SPOTS[agent.key] || SPOTS['claude-code'];
  const dx = ((spot.x - HUB.x) / 100) * size.w;
  const dy = ((spot.y - HUB.y) / 100) * size.h;
  const chips = (picks || []).slice(0, 3);
  const requesting = motion === 'full' && run.p > 0.85;

  const stateFor = (k) => {
    if (motion === 'still') return 'idle';
    const selected = k === agent.key;
    if (selected && requesting) return 'requesting';
    if (selected && run.moving) return 'running';
    if (hover === k) return 'jumping';
    if (patrol[k]?.running) return 'running';
    return 'idle';
  };

  const offsetFor = (k) => {
    const s = SPOTS[k];
    const toHub = { x: ((HUB.x - s.x) / 100) * size.w, y: ((HUB.y - s.y) / 100) * size.h };
    const pt = patrol[k] || { x: 0, y: 0 };
    if (motion !== 'full') return { x: 0, y: 0, lean: 0 };
    if (k === agent.key) {
      const t = ease(run.p) * 0.58;
      return { x: toHub.x * t, y: toHub.y * t, lean: toHub.x > 0 ? 8 : toHub.x < 0 ? -8 : 0, scroll: true };
    }
    // The others give the hub a little room as the selected agent arrives.
    const back = -0.08 * run.p;
    return { x: pt.x + toHub.x * back, y: pt.y + toHub.y * back, lean: pt.x > 0 ? 7 : pt.x < 0 ? -7 : 0 };
  };

  const jump = (k) => {
    if (motion === 'still') return;
    if (k === agent.key && run.p > 0.02) return; // never interrupt the story
    clearTimeout(hoverTimer.current);
    setHover(k);
    hoverTimer.current = setTimeout(() => setHover(null), 760);
  };

  const pick = (k) => {
    setAgent(k);
    jump(k);
    track('hero_agent_selected', { agent: k });
  };

  return (
    <figure className={'k-orb' + (inView ? ' is-in' : '') + (requesting ? ' is-request' : '')} ref={stage} aria-label='Coding agents asking Stash for the right tool'>
      <div className='k-orb-ring k-orb-ring-1' aria-hidden='true' />
      <div className='k-orb-ring k-orb-ring-2' aria-hidden='true' />
      <div className='k-orb-dust' aria-hidden='true'>{Array.from({ length: 10 }, (_, i) => <i key={i} />)}</div>

      <svg className='k-orb-lines' viewBox='0 0 100 100' preserveAspectRatio='none' aria-hidden='true'>
        {HERO_AGENTS.map((k) => {
          const s = SPOTS[k];
          const on = k === agent.key;
          return (
            <g key={k} className={on ? 'on' : ''}>
              <line className='k-orb-line' x1={s.x} y1={s.y} x2={HUB.x} y2={HUB.y} pathLength='100' vectorEffect='non-scaling-stroke' />
              {on && !requesting ? (
                <g key={agent.key}>
                  <line className='k-orb-req' x1={s.x} y1={s.y} x2={HUB.x} y2={HUB.y} pathLength='100' vectorEffect='non-scaling-stroke' />
                  <line className='k-orb-res' x1={HUB.x} y1={HUB.y} x2={s.x} y2={s.y} pathLength='100' vectorEffect='non-scaling-stroke' />
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>

      <div className='k-orb-hub' key={'hub-' + agent.key} style={{ left: HUB.x + '%', top: HUB.y + '%' }} aria-hidden='true'>
        <span className='k-orb-hub-glow' />
        <span className='k-orb-hub-core'><StashMark size={30} /></span>
        <span className='k-orb-hub-label'>Stash MCP</span>
      </div>

      {!requesting ? (
        <div className='k-orb-chips' key={'chips-' + agent.key} style={{ left: HUB.x + '%', top: HUB.y + '%', '--dx': dx + 'px', '--dy': dy + 'px' }} aria-hidden='true'>
          {chips.map((c, i) => (
            <span key={c.id} className={'k-orb-chip k-orb-chip-' + i}>
              <b>{c.title}</b>
              <small>{c.kind}</small>
            </span>
          ))}
        </div>
      ) : null}

      {HERO_AGENTS.map((k) => {
        const a = clientOf(k);
        const s = SPOTS[k];
        const on = k === agent.key;
        const o = offsetFor(k);
        return (
          <div key={k} className={'k-orb-agent k-orb-agent-' + k + (on ? ' on' : '')} style={{ left: s.x + '%', top: s.y + '%' }}>
            <div
              className='k-orb-mover'
              style={{ transform: 'translate(' + o.x + 'px, ' + o.y + 'px)', transitionDuration: o.scroll ? '140ms' : RUN_MS + 'ms' }}
            >
              <button
                type='button'
                aria-pressed={on}
                aria-describedby={'orb-tip-' + k}
                onClick={() => pick(k)}
                onMouseEnter={() => jump(k)}
              >
                <AgentCharacter agent={k} state={stateFor(k)} selected={on} lean={o.lean} />
                <span className='k-orb-name'>{a.name}</span>
              </button>
              <span role='tooltip' id={'orb-tip-' + k} className='k-orb-tip'>
                <b>{a.where}</b> {a.workflow}
              </span>
            </div>
          </div>
        );
      })}

      <figcaption className='k-orb-caption' aria-live='polite'>
        <b>{agent.name}</b> · {agent.where}. {agent.workflow}
        <span className='k-sr'>
          {' '}Claude Code, Cursor and GitHub Copilot each connect to Stash over MCP and get ranked catalogue entries back
          {chips.length ? ', for example ' + chips.map((c) => c.title).join(', ') : ''}.
        </span>
      </figcaption>
    </figure>
  );
}
