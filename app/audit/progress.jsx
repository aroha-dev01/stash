'use client';

// The live view of an audit while it runs: one overall bar, the five phases,
// every page with its own state, every section as a cell, and a log of what
// just happened. Everything here is derived from the audit as it is saved,
// so the page can be reloaded or opened on another device mid-run.

const PHASES = [
  { key: 'read', label: 'Reading pages', weight: 0.22 },
  { key: 'test', label: 'Speed and phone test', weight: 0.06 },
  { key: 'score', label: 'Scoring sections', weight: 0.3 },
  { key: 'design', label: 'Designing fixes', weight: 0.3 },
  { key: 'plan', label: 'Ranking what to fix', weight: 0.12 },
];
const STATUS_PHASE = { queued: 0, capturing: 0, measuring: 1, classifying: 2, designing: 3, planning: 4, done: 5, error: 5 };

const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's' : s + 's';
};
const label = (s) => (s === 'cta' || s === 'faq' ? s.toUpperCase() : String(s || 'section').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));

/** Everything the panel shows, computed from the audit row. */
export function progressOf(audit) {
  const rows = audit.sections || [];
  const pages = audit.site?.pages || [];
  const idx = STATUS_PHASE[audit.status] ?? 0;
  const typed = rows.filter((r) => r.type).length;
  const toDesign = rows.filter((r) => ['classified', 'designed', 'error'].includes(r.status));
  const designedDone = toDesign.filter((r) => r.status !== 'classified').length;
  const visualsDone = rows.filter((r) => r.status === 'designed' && r.suggestion?.visuals !== undefined).length;
  const visualsTotal = rows.filter((r) => r.status === 'designed').length;

  const pagesDone = pages.filter((p) => p.status === 'done' || p.status === 'error').length;
  const visionOn = audit.site?.visual !== undefined;
  const frac = [
    pages.length ? pagesDone / pages.length : 0,
    idx > 1 ? 1 : 0.4,
    rows.length ? (typed / rows.length) * 0.9 + (visionOn ? 0.1 : 0) : 0,
    toDesign.length ? ((designedDone + visualsDone * 0.5) / (toDesign.length + visualsTotal * 0.5)) : (idx > 3 ? 1 : 0),
    0.5,
  ];
  let pct = 0;
  PHASES.forEach((p, i) => { pct += p.weight * (i < idx ? 1 : i === idx ? frac[i] : 0); });
  if (audit.status === 'done') pct = 1;
  if (audit.status === 'queued') pct = Math.max(pct, 0.02);

  const detail = [
    pages.length ? pagesDone + ' of ' + pages.length + ' pages' : 'Starting',
    idx > 1 ? 'Measured' : 'Testing on a phone',
    rows.length ? typed + ' of ' + rows.length + ' sections' + (visionOn ? '' : ', looking at the page') : 'Waiting for pages',
    toDesign.length ? designedDone + ' of ' + toDesign.length + ' sections designed' : 'Choosing sections',
    'Prioritising by impact',
  ];

  // One entry per page: where it is in the cycle.
  const pageStates = pages.map((p) => {
    const mine = rows.filter((r) => (r.signals?.page || pages[0]?.url) === p.url);
    const typedHere = mine.filter((r) => r.type).length;
    let state = p.status;
    if (p.status === 'done') {
      if (idx >= 3) state = 'scored';
      else if (idx === 2) state = mine.length && typedHere === mine.length ? 'scored' : typedHere ? 'scoring' : 'read';
      else state = 'read';
    }
    return { ...p, state, sectionsHere: mine.length, designed: mine.filter((r) => r.status === 'designed').length };
  });

  // The section being designed right now, from the step text "Designing: x (#n)".
  const m = /\(#(\d+)\)/.exec(audit.step_detail || '');
  const nowPos = audit.status === 'designing' && m ? Number(m[1]) - 1 : null;
  const cells = rows.map((r) => ({
    id: r.id,
    pos: r.position,
    title: (r.signals?.page_path && r.signals.page_path !== '/' ? r.signals.page_path + ' · ' : '') + label(r.type || r.name_hint || 'section'),
    state: r.status === 'error' ? 'error' : r.status === 'designed' ? 'designed' : r.position === nowPos ? 'now'
      : r.status === 'classified' ? 'queued' : r.status === 'skipped' ? 'solid' : r.type ? 'scored' : 'waiting',
  }));

  const elapsed = audit.created_at ? Date.now() - new Date(audit.created_at).getTime() : 0;
  const eta = pct >= 0.12 && pct < 1 ? (elapsed * (1 - pct)) / pct : null;
  return { pct, idx, detail, frac, pageStates, cells, elapsed, eta, nowPos };
}

const PAGE_STATE = {
  queued: ['Waiting', 'wait'], reading: ['Reading', 'live'], read: ['Read', 'ok'], scoring: ['Scoring', 'live'],
  scored: ['Scored', 'ok'], done: ['Read', 'ok'], error: ['Could not read', 'bad'],
};

export function Progress({ audit, log }) {
  const p = progressOf(audit);
  const pct = Math.round(p.pct * 100);
  const running = audit.status !== 'done' && audit.status !== 'error';
  return (
    <section className='zcard pad prg' id='progress'>
      <div className='sechead'>
        <div>
          <h2>{running ? 'Analysis in progress' : 'Analysis complete'}</h2>
          <div className='sub'>{audit.step_detail || (running ? 'Working' : 'Done')}</div>
        </div>
        <div className='prg-pct'><b>{pct}%</b><span>{fmt(p.elapsed)} elapsed{p.eta && running ? ' · about ' + fmt(p.eta) + ' left' : ''}</span></div>
      </div>

      <div className={'prg-bar' + (running ? ' live' : '')} role='progressbar' aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: Math.max(pct, 2) + '%' }} />
      </div>

      <div className='prg-phases'>
        {PHASES.map((ph, i) => {
          const state = i < p.idx ? 'done' : i === p.idx && running ? 'on' : i === p.idx ? 'done' : 'wait';
          const sub = state === 'on' ? Math.round(p.frac[i] * 100) : state === 'done' ? 100 : 0;
          return (
            <div key={ph.key} className={'prg-ph ' + state}>
              <span className='dot'>{state === 'done' ? '✓' : i + 1}</span>
              <b>{ph.label}</b>
              <small>{state === 'wait' ? 'Waiting' : p.detail[i]}</small>
              <span className='mini'><i style={{ width: sub + '%' }} /></span>
            </div>
          );
        })}
      </div>

      {p.pageStates.length ? (
        <>
          <h3 className='prg-h'>Pages <span className='sub'>{p.pageStates.filter((x) => ['read', 'scoring', 'scored', 'done'].includes(x.state)).length} of {p.pageStates.length} read</span></h3>
          <div className='prg-pages'>
            {p.pageStates.map((pg) => {
              const [text, tone] = PAGE_STATE[pg.state] || PAGE_STATE.queued;
              return (
                <div key={pg.url} className={'prg-pg ' + tone}>
                  <span className={'ico ' + tone}>{tone === 'ok' ? '✓' : tone === 'bad' ? '!' : tone === 'live' ? '' : '○'}</span>
                  <span className='nm'><b>{pg.home ? 'Homepage' : pg.path}</b><small>{pg.title || pg.error || pg.url}</small></span>
                  <span className='st'>{text}{pg.sectionsHere ? ' · ' + pg.sectionsHere + ' sections' : ''}{pg.designed ? ' · ' + pg.designed + ' to redesign' : ''}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {p.cells.length ? (
        <>
          <h3 className='prg-h'>Sections <span className='sub'>{p.cells.filter((c) => c.state !== 'waiting').length} of {p.cells.length} scored</span></h3>
          <div className='prg-cells'>
            {p.cells.map((c, i) => <span key={c.id} className={'cell ' + c.state} title={c.title + ' · ' + c.state}>{i + 1}</span>)}
          </div>
          <div className='prg-legend'>
            {[['waiting', 'Waiting'], ['scored', 'Scored'], ['now', 'Designing now'], ['queued', 'To design'], ['designed', 'Redesign ready'], ['solid', 'Solid'], ['error', 'Problem']].map(([k, t]) => <span key={k}><i className={'cell ' + k} />{t}</span>)}
          </div>
        </>
      ) : null}

      {log.length ? (
        <>
          <h3 className='prg-h'>Activity</h3>
          <ol className='prg-log'>
            {log.slice(0, 10).map((e, i) => (
              <li key={e.t + e.msg} className={i === 0 && running ? 'now' : ''}>
                <time>{new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                <span>{e.msg}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

/** After the run: every page that was analysed, with what was found on it. */
export function PagesCard({ audit }) {
  const pages = audit.site?.pages || [];
  if (pages.length < 2) return null;
  const rows = audit.sections || [];
  const checks = audit.checks || [];
  return (
    <section id='pages' className='zcard pad'>
      <h2>Pages analysed</h2>
      <div className='sub'>{pages.filter((p) => p.status === 'done').length} of {pages.length} pages were read and scored. Findings on each page, and a link to its sections.</div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Page</th><th>Sections</th><th>To redesign</th><th>Issues on page</th><th>Words</th><th /></tr></thead>
          <tbody>
            {pages.map((p) => {
              const mine = rows.filter((r) => (r.signals?.page || pages[0].url) === p.url);
              const first = mine.find((r) => r.status === 'designed') || mine[0];
              const issues = checks.filter((c) => (c.pages || []).includes(p.url)).length;
              return (
                <tr key={p.url}>
                  <td className='iss'><b>{p.home ? 'Homepage' : p.path}</b><span>{p.title || p.error || ''}</span></td>
                  <td className='area'>{p.status === 'error' ? '—' : mine.length}</td>
                  <td className='area'>{mine.filter((r) => r.status === 'designed').length}</td>
                  <td className='area'>{p.status === 'error' ? 'Not read' : issues}</td>
                  <td className='area'>{p.words ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {first ? <a className='btn sm' href={'#s' + first.id}>Sections</a> : null}{' '}
                    <a className='btn sm' href={p.url} target='_blank' rel='noopener noreferrer'>Open ↗</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
