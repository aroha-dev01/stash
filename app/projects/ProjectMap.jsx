'use client';

import { useEffect, useRef, useState } from 'react';

// The project map: the project as a hub, each folder a node on a ring around
// it, each skill filed in a folder a dot branching off that node. It is drawn
// at the container's real pixel width, so labels stay legible on a phone.
//
// It is a view of the folder list below it, never the only way to do
// anything: selecting a node selects the folder, and dropping a skill on a
// node files it there, but the list offers both by keyboard as well.

export const DRAG_TYPE = 'application/x-stash';

const initials = (s) =>
  String(s || '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0] || '')
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase() || '•';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function geometry(folders, w, h, mini) {
  const cx = w / 2;
  const cy = h / 2;
  const n = folders.length;
  const rx = mini ? w / 2 - 34 : Math.max(96, Math.min(w / 2 - 92, 380));
  const ry = mini ? h / 2 - 26 : Math.max(84, h / 2 - 98);
  // An even ring is turned half a step, so no folder sits straight below the
  // hub, where its label would cover the project's name.
  const turn = n % 2 === 0 && n > 0 ? Math.PI / n : 0;
  const pad = mini ? 4 : 10;

  return folders.map((f, i) => {
    const a = -Math.PI / 2 + (n ? (i / n) * Math.PI * 2 : 0) + turn;
    const x = cx + rx * Math.cos(a);
    const y = cy + ry * Math.sin(a);
    const total = f.items ? f.items.length : f.count || 0;
    const k = Math.min(total, mini ? 6 : 10);
    const spread = Math.min(mini ? 1.8 : 2.3, (mini ? 0.5 : 0.38) * Math.max(k - 1, 0));
    const dots = Array.from({ length: k }, (_, j) => {
      const t = k === 1 ? 0 : j / (k - 1) - 0.5;
      const b = a + t * spread;
      const r = mini ? 15 + (j % 2) * 5 : 42 + (j % 3) * 11;
      return {
        x: clamp(x + r * Math.cos(b), pad, w - pad),
        y: clamp(y + r * Math.sin(b), pad, h - pad),
        item: f.items ? f.items[j] : null,
      };
    });
    // Control point bent off the straight line, so branches read as curves.
    const mx = (cx + x) / 2 - (y - cy) * 0.18;
    const my = (cy + y) / 2 + (x - cx) * 0.18;
    const side = Math.cos(a);
    const lx = x - Math.cos(a) * (mini ? 0 : 36);
    const ly = y - Math.sin(a) * (mini ? 0 : 34) + 4;
    return {
      f, x, y, a, dots, more: total - k, total,
      path: 'M' + cx + ' ' + cy + ' Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1),
      label: { x: lx, y: ly, anchor: side > 0.35 ? 'end' : side < -0.35 ? 'start' : 'middle' },
    };
  });
}

function useWidth(ref, fallback) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/**
 * folders: [{ id, name, tone, items?: [{ link_id, link: { title } }], count? }]
 * mini: a small, static, decorative version for project cards.
 */
export default function ProjectMap({ name, folders, selected, onSelect, onDrop, mini = false, height }) {
  const box = useRef(null);
  const width = useWidth(box, mini ? 300 : 960);
  const reduced = useReducedMotion();
  const [over, setOver] = useState(null);
  const [hover, setHover] = useState(null);

  const w = Math.max(mini ? 220 : 300, width);
  const narrow = !mini && w < 560;
  const h = height || (mini ? 132 : narrow ? 380 : 400);
  const cx = w / 2;
  const cy = h / 2;
  const nodes = geometry(folders, w, h, mini);
  const focus = hover || over || selected;
  const animate = !mini && !reduced;
  const hubR = mini ? 13 : 34;
  const nodeR = mini ? 8 : 21;

  const accepts = (e) => !!onDrop && Array.from(e.dataTransfer?.types || []).includes(DRAG_TYPE);

  return (
    <div ref={box} className={'k-map' + (mini ? ' k-map-mini' : '')} style={{ height: h }}>
      <svg
        width={w}
        height={h}
        viewBox={'0 0 ' + w + ' ' + h}
        role={mini ? undefined : 'group'}
        aria-hidden={mini ? 'true' : undefined}
        aria-label={mini ? undefined : 'Map of ' + name + ': ' + folders.length + (folders.length === 1 ? ' folder' : ' folders')}
      >
        <defs>
          <radialGradient id={mini ? 'k-hub-m' : 'k-hub'} cx='50%' cy='40%' r='65%'>
            <stop offset='0%' stopColor='#f3d3a3' />
            <stop offset='55%' stopColor='#e0a95b' />
            <stop offset='100%' stopColor='#8a5d22' />
          </radialGradient>
          {mini ? null : (
            <pattern id='k-map-grid' width='26' height='26' patternUnits='userSpaceOnUse'>
              <circle cx='1' cy='1' r='1' fill='rgba(239,239,235,0.07)' />
            </pattern>
          )}
        </defs>
        {mini ? null : <rect width={w} height={h} fill='url(#k-map-grid)' />}

        {/* the orbit every folder sits on */}
        {nodes.length ? null : (
          <ellipse cx={cx} cy={cy} rx={mini ? 60 : 150} ry={mini ? 34 : 96} className='k-map-orbit' />
        )}

        {/* hub to folder branches */}
        {nodes.map((n) => {
          const dim = focus && focus !== n.f.id;
          return (
            <g key={'b' + n.f.id} style={{ '--tone': n.f.tone }} className={'k-map-branch' + (dim ? ' is-dim' : '') + (focus === n.f.id ? ' is-on' : '')}>
              <path d={n.path} className='k-map-wire' />
              {mini ? null : <path d={n.path} className={'k-map-flow' + (animate ? ' is-moving' : '')} />}
              {animate ? (
                <circle r='2.4' className='k-map-spark'>
                  <animateMotion dur='3.4s' repeatCount='indefinite' path={n.path} begin={(nodes.indexOf(n) * 0.45).toFixed(2) + 's'} />
                </circle>
              ) : null}
              {n.dots.map((d, j) => (
                <line key={j} x1={n.x} y1={n.y} x2={d.x} y2={d.y} className='k-map-twig' />
              ))}
            </g>
          );
        })}

        {/* skills */}
        {nodes.map((n) => (
          <g key={'d' + n.f.id} style={{ '--tone': n.f.tone }} className={'k-map-dots' + (focus && focus !== n.f.id ? ' is-dim' : '')}>
            {n.dots.map((d, j) => (
              <circle key={j} cx={d.x} cy={d.y} r={mini ? 2.6 : 5} className='k-map-dot'>
                {d.item?.link?.title ? <title>{d.item.link.title}</title> : null}
              </circle>
            ))}
            {n.more > 0 && !mini ? (
              <text x={n.dots[n.dots.length - 1].x} y={n.dots[n.dots.length - 1].y - 10} className='k-map-more' textAnchor='middle'>+{n.more}</text>
            ) : null}
          </g>
        ))}

        {/* the hub */}
        <g className='k-map-hub'>
          {mini ? null : <circle cx={cx} cy={cy} r={hubR + 14} className={'k-map-halo' + (animate ? ' is-moving' : '')} />}
          <circle cx={cx} cy={cy} r={hubR} fill={'url(#' + (mini ? 'k-hub-m' : 'k-hub') + ')'} />
          <text x={cx} y={cy + (mini ? 3.5 : 6)} textAnchor='middle' className='k-map-hub-text'>{initials(name)}</text>
          {/* On a narrow map the ring is tight enough for the name to run into the lower folders; the initials carry it. */}
          {mini || narrow ? null : (
            <text x={cx} y={cy + hubR + 22} textAnchor='middle' className='k-map-hub-name'>{short(name, 28)}</text>
          )}
        </g>

        {/* folders */}
        {nodes.map((n) => {
          const on = selected === n.f.id;
          const label = n.f.name + ', ' + n.total + (n.total === 1 ? ' skill' : ' skills');
          const interactive = !mini && !!onSelect;
          return (
            <g
              key={'f' + n.f.id}
              style={{ '--tone': n.f.tone }}
              className={'k-map-node' + (on ? ' is-on' : '') + (over === n.f.id ? ' is-over' : '') + (focus && focus !== n.f.id ? ' is-dim' : '')}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-pressed={interactive ? on : undefined}
              aria-label={interactive ? label : undefined}
              onClick={interactive ? () => onSelect(n.f.id) : undefined}
              onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.f.id); } } : undefined}
              onMouseEnter={mini ? undefined : () => setHover(n.f.id)}
              onMouseLeave={mini ? undefined : () => setHover(null)}
              onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(n.f.id); } }}
              onDragLeave={() => setOver((o) => (o === n.f.id ? null : o))}
              onDrop={(e) => { if (accepts(e)) { e.preventDefault(); setOver(null); onDrop(n.f.id, e); } }}
            >
              {mini ? null : <circle cx={n.x} cy={n.y} r={nodeR + 12} className='k-map-hit' />}
              <circle cx={n.x} cy={n.y} r={nodeR + (mini ? 3 : 7)} className='k-map-ring' />
              <circle cx={n.x} cy={n.y} r={nodeR} className='k-map-core' />
              {mini ? null : (
                <text x={n.x} y={n.y + 5} textAnchor='middle' className='k-map-count'>{n.total}</text>
              )}
              {!mini && (!narrow || on || hover === n.f.id) ? (
                <text x={n.label.x} y={n.label.y} textAnchor={n.label.anchor} className='k-map-label'>{short(n.f.name, narrow ? 18 : 22)}</text>
              ) : null}
            </g>
          );
        })}

        {!nodes.length && !mini ? (
          <text x={cx} y={cy + hubR + 46} textAnchor='middle' className='k-map-empty'>Add a folder to start the map</text>
        ) : null}
      </svg>
    </div>
  );
}
