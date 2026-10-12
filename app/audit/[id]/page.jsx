'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

// One audit: the page split into sections, each scored, the weak ones with
// redesign directions built on tools from the library.

const STEPS = ['capturing', 'classifying', 'designing', 'done'];
const STEP_LABEL = { queued: 'Starting', capturing: 'Reading the page', classifying: 'Scoring each section', designing: 'Designing fixes', done: 'Done' };

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const band = (s) => (s >= 75 ? 'good' : s >= 50 ? 'ok' : 'bad');
const label = (s) => (s === 'cta' || s === 'faq' ? s.toUpperCase() : String(s || 'section').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));

export default function AuditPage() {
  const { id } = useParams();
  const [audit, setAudit] = useState(null);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [shotFailed, setShotFailed] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        let res = await fetch('/api/audit/' + id);
        let a = await res.json();
        if (!res.ok) throw new Error(a.error || 'Not found');
        if (alive.current) setAudit(a);
        // Keep nudging it forward until it finishes. Each call does up to ~45s of work.
        let stalls = 0;
        while (alive.current && a.status !== 'done' && a.status !== 'error' && stalls < 40) {
          res = await fetch('/api/audit/' + id, { method: 'POST' });
          const next = await res.json();
          if (!res.ok) { stalls++; await new Promise((r) => setTimeout(r, 3000)); continue; }
          a = next;
          if (alive.current) setAudit(a);
        }
      } catch (e) {
        if (alive.current) setErr(e.message);
      }
    })();
    return () => { alive.current = false; };
  }, [id]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  async function pick(section, idx) {
    const picked = section.picked === idx ? null : idx;
    setAudit((a) => ({ ...a, sections: a.sections.map((s) => (s.id === section.id ? { ...s, picked } : s)) }));
    const res = await fetch('/api/audit/' + id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ section_id: section.id, picked }),
    });
    const j = await res.json().catch(() => ({}));
    if (picked != null && j.tools?.length) flash('Filed ' + j.tools.length + ' tool(s) under ' + j.filed_under);
  }

  function copy(text) {
    navigator.clipboard.writeText(text).then(() => flash('Prompt copied'), () => flash('Could not copy'));
  }

  if (err) return <Shell><div className='au-err'>{err}</div></Shell>;
  if (!audit) return <Shell><div className='au-muted'>Loading…</div></Shell>;

  const site = audit.site || {};
  const running = audit.status !== 'done' && audit.status !== 'error';
  const stepIdx = STEPS.indexOf(audit.status);
  const shot = shotFailed === 0 ? site.screenshot : shotFailed === 1 ? site.screenshot_fallback : null;
  const toFix = audit.sections.filter((s) => s.status === 'designed' || s.status === 'classified' || s.status === 'error');
  const solid = audit.sections.filter((s) => s.status === 'skipped');

  return (
    <Shell>
      <section className='au-head'>
        <div className='au-head-text'>
          <div className='au-kicker'>{audit.client ? audit.client + ' · ' : ''}{hostOf(audit.url)}</div>
          <h1>{audit.title || hostOf(audit.url)}</h1>
          <a className='au-link' href={audit.url} target='_blank' rel='noopener noreferrer'>{audit.url}</a>
          <div className='au-facts'>
            {site.framework ? <span className='pill'>{site.framework}</span> : null}
            {(site.fonts || []).slice(0, 3).map((f) => <span key={f} className='pill'>{f}</span>)}
            {(site.colours || []).slice(0, 6).map((c) => <span key={c} className='au-swatch' title={c} style={{ background: c }} />)}
          </div>
        </div>
        {audit.summary?.health != null ? (
          <div className={'au-score ' + band(audit.summary.health)}>
            <b>{audit.summary.health}</b><span>health</span>
          </div>
        ) : null}
      </section>

      {running ? (
        <div className='au-progress'>
          <div className='au-steps'>
            {STEPS.slice(0, 3).map((s, i) => (
              <span key={s} className={i < stepIdx ? 'done' : i === stepIdx ? 'on' : ''}>{STEP_LABEL[s]}</span>
            ))}
          </div>
          <div className='au-muted'>{audit.step_detail || STEP_LABEL[audit.status] || 'Working'}… this takes a minute or two.</div>
        </div>
      ) : null}

      {audit.status === 'error' ? <div className='au-err'>The audit stopped: {audit.error}</div> : null}

      {audit.summary ? (
        <section className='au-summary'>
          <div>
            <div className='d-label'>Most common problems</div>
            <div className='tag-cloud'>
              {(audit.summary.common_issues || []).length
                ? audit.summary.common_issues.map((c) => <span key={c.issue} className='pill err'>{c.issue} · {c.sections}</span>)
                : <span className='au-muted'>Nothing recurring.</span>}
            </div>
          </div>
          {(audit.summary.basics || []).length ? (
            <div>
              <div className='d-label'>Page basics</div>
              <div className='tag-cloud'>{audit.summary.basics.map((b) => <span key={b} className='pill ref'>{b}</span>)}</div>
            </div>
          ) : null}
        </section>
      ) : null}

      {shot ? (
        <details className='au-shot'>
          <summary>Full-page screenshot</summary>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} alt={'Screenshot of ' + hostOf(audit.url)} loading='lazy' onError={() => setShotFailed((n) => n + 1)} />
        </details>
      ) : null}

      {toFix.length ? <h2 className='au-h2'>Sections to improve</h2> : null}
      {toFix.map((s) => (
        <SectionCard key={s.id} s={s} tools={audit.tools} onPick={pick} onCopy={copy} />
      ))}

      {solid.length ? (
        <>
          <h2 className='au-h2'>Already solid</h2>
          <div className='au-solid'>
            {solid.map((s) => (
              <div key={s.id} className='au-solid-row'>
                <span className='au-pos'>{s.position + 1}</span>
                <b>{label(s.type)}</b>
                <span className='au-muted'>{s.heading || (s.text_excerpt || '').slice(0, 80)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {audit.engines?.decide || audit.engines?.design_used ? (
        <div className='au-engines'>
          Scored by {audit.engines.decide || '—'} · Designed by {audit.engines.design_used || audit.engines.design || '—'}
        </div>
      ) : null}

      {toast ? <div className='toast-stack'><div className='toast ok'>{toast}</div></div> : null}
    </Shell>
  );
}

function SectionCard({ s, tools, onPick, onCopy }) {
  const sug = s.suggestion || {};
  const pct = Math.round((Number(s.needs_work) || 0) * 100);
  return (
    <article className='au-card'>
      <div className='au-card-head'>
        <span className='au-pos'>{s.position + 1}</span>
        <div className='au-card-title'>
          <b>{label(s.type)}</b>
          <span>{s.heading || (s.text_excerpt || '').slice(0, 90)}</span>
        </div>
        <div className='au-need' title={'Needs work: ' + pct + '%'}>
          <div className='au-need-bar'><i style={{ width: pct + '%' }} /></div>
          <small>{pct}%</small>
        </div>
      </div>

      {(s.issues || []).length ? (
        <div className='tag-cloud'>{s.issues.map((i) => <span key={i} className='pill err'>{i}</span>)}</div>
      ) : null}

      {s.status === 'classified' ? <div className='au-muted'>Designing directions for this section…</div> : null}
      {s.status === 'error' ? <div className='au-err'>Could not design this one: {sug.error}</div> : null}

      {sug.diagnosis ? <p className='au-diag'>{sug.diagnosis}</p> : null}
      {sug.keep ? <p className='au-keep'><b>Keep:</b> {sug.keep}</p> : null}
      {sug.copy?.headline || sug.copy?.cta ? (
        <div className='au-copy'>
          {sug.copy.headline ? <div><small>Headline</small><b>{sug.copy.headline}</b></div> : null}
          {sug.copy.cta ? <div><small>Button</small><b>{sug.copy.cta}</b></div> : null}
        </div>
      ) : null}

      <div className='au-dirs'>
        {(sug.directions || []).map((d, i) => (
          <div key={i} className={s.picked === i ? 'au-dir picked' : 'au-dir'}>
            <div className='au-dir-head'>
              <b>{d.title}</b>
              <span className={'pill ' + (d.effort === 'quick' ? 'oss' : d.effort === 'bigger' ? 'err' : '')}>{d.effort}</span>
            </div>
            <p>{d.idea}</p>
            {(d.tool_ids || []).length ? (
              <div className='au-tools'>
                {d.tool_ids.map((tid) => tools?.[tid]).filter(Boolean).map((t) => (
                  <div key={t.id} className='au-tool'>
                    {t.image ? <img src={t.image} alt='' loading='lazy' /> : <div className='au-tool-ph' />}
                    <div className='au-tool-body'>
                      <b>{t.title}</b>
                      <small>{t.usage_format ? t.usage_format.replace(/-/g, ' ') : t.type}</small>
                      <div className='au-tool-links'>
                        <a href={'/?open=' + t.id}>In Stash</a>
                        <a href={t.url} target='_blank' rel='noopener noreferrer'>Open ↗</a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className='au-dir-actions'>
              {d.prompt ? <button className='ghost-btn' onClick={() => onCopy(d.prompt)}>Copy build prompt</button> : null}
              <button className={s.picked === i ? 'au-pick on' : 'au-pick'} onClick={() => onPick(s, i)}>
                {s.picked === i ? 'Picked ✓' : 'Use this'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function Shell({ children }) {
  return (
    <div className='app au'>
      <header className='topbar'>
        <a className='brand' href='/'>
          <span className='brand-mark' />
          <span className='brand-name'>stash</span>
        </a>
        <div className='topbar-right'>
          <a className='ghost-btn' href='/audit'>All audits</a>
        </div>
      </header>
      <main className='au-main'>{children}</main>
    </div>
  );
}
