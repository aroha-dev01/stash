'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

// One audit: the page split into sections, each scored, the weak ones with
// redesign directions built on tools from the library.

const STEPS = ['capturing', 'measuring', 'classifying', 'designing', 'planning', 'done'];
const STEP_LABEL = {
  queued: 'Starting', capturing: 'Reading the page', measuring: 'Testing on a phone',
  classifying: 'Scoring each section', designing: 'Designing fixes', planning: 'Ranking what to fix', done: 'Done',
};
const TIER = { now: 'Fix now', next: 'Next', later: 'Later' };
const LH_LABEL = { performance: 'Speed', accessibility: 'Accessibility', seo: 'SEO', 'best-practices': 'Best practices' };

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const band = (s) => (s >= 75 ? 'good' : s >= 50 ? 'ok' : 'bad');
const label = (s) => (s === 'cta' || s === 'faq' ? s.toUpperCase() : String(s || 'section').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));

export default function AuditPage() {
  const { id } = useParams();
  const [audit, setAudit] = useState(null);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [shotFailed, setShotFailed] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const alive = useRef(true);

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text || asking) return;
    setQuestion(text);
    setAsking(true);
    setAnswer(null);
    try {
      const res = await fetch('/api/audit/' + id + '/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: text }),
      });
      const j = await res.json();
      setAnswer(j.answer || j.error || 'No answer.');
    } catch (e) {
      setAnswer('Could not reach Stash: ' + e.message);
    } finally {
      setAsking(false);
    }
  }

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

  // 👍/👎 on a finding. Stash learns per-issue thresholds from these, so
  // problem types you keep rejecting need more certainty next time.
  async function vote(itemKey, verdict, issueLabel) {
    const current = audit.plan?.feedback?.[itemKey]?.verdict || null;
    const next = current === verdict ? null : verdict;
    setAudit((a) => {
      const fb = { ...(a.plan?.feedback || {}) };
      if (next) fb[itemKey] = { verdict: next }; else delete fb[itemKey];
      return { ...a, plan: { ...a.plan, feedback: fb } };
    });
    await fetch('/api/audit/' + id + '/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item_key: itemKey, verdict: next, issue_label: issueLabel || null }),
    }).catch(() => {});
    if (next === 'down') flash('Marked as not an issue — Stash will weigh this in future audits');
  }

  // Re-audit after changes ship: same URL and client, fresh run, so the two
  // reports can be compared side by side.
  async function rerun() {
    flash('Starting a fresh audit…');
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: audit.url, client: audit.client }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.id) window.location.href = '/audit/' + j.id;
    else flash(j.error || 'Could not start');
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
          {site.judgement ? (
            <div className='au-facts'>
              <span className='pill sect'>{String(site.judgement.business_type || '').replace(/-/g, ' ')}</span>
              <span className='pill sect'>goal: {String(site.judgement.contact_goal || '').replace(/-/g, ' ')}</span>
              {site.judgement.offer_clarity != null ? (
                <span className={'pill ' + (site.judgement.offer_clarity >= 0.66 ? 'oss' : site.judgement.offer_clarity < 0.34 ? 'err' : '')}>
                  offer clarity {Math.round(site.judgement.offer_clarity * 100)}%
                </span>
              ) : null}
              {site.judgement.proof_on_page != null ? (
                <span className={'pill ' + (site.judgement.proof_on_page >= 0.6 ? 'oss' : 'err')}>
                  {site.judgement.proof_on_page >= 0.6 ? 'proof on page' : 'little proof on page'}
                </span>
              ) : null}
            </div>
          ) : null}
          {!running ? (
            <div className='au-head-actions'>
              <button className='ghost-btn' onClick={rerun}>Re-run audit</button>
              {audit.status === 'done' ? <a className='ghost-btn' href={'/audit/' + audit.id + '/report'} target='_blank' rel='noopener noreferrer' style={{ textDecoration: 'none' }}>Client report ↗</a> : null}
            </div>
          ) : null}
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
            {STEPS.slice(0, 5).map((s, i) => (
              <span key={s} className={i < stepIdx ? 'done' : i === stepIdx ? 'on' : ''}>{STEP_LABEL[s]}</span>
            ))}
          </div>
          <div className='au-muted'>{audit.step_detail || STEP_LABEL[audit.status] || 'Working'}… this takes a minute or two.</div>
        </div>
      ) : null}

      {audit.status === 'error' ? <div className='au-err'>The audit stopped: {audit.error}</div> : null}

      {audit.psi?.scores ? (
        <section className='au-lh'>
          {Object.entries(audit.psi.scores).map(([k, v]) => (
            <div key={k} className={'au-ring ' + band(v)}>
              <b>{v}</b><span>{LH_LABEL[k] || k}</span>
            </div>
          ))}
          {audit.psi.vitals ? (
            <div className='au-vitals'>
              {Object.entries(audit.psi.vitals).map(([k, v]) => v.value ? (
                <span key={k} className={'pill ' + (v.score >= 0.9 ? 'oss' : v.score < 0.5 ? 'err' : '')}>{k} {v.value}</span>
              ) : null)}
            </div>
          ) : null}
        </section>
      ) : audit.psi?.skipped ? (
        <div className='au-note'>Speed &amp; contrast not measured: {audit.psi.skipped}</div>
      ) : null}

      {audit.plan ? (
        <section className='au-plan'>
          <div className='au-plan-head'>
            <h2 className='au-h2' style={{ margin: 0 }}>Fix first</h2>
            <div className='au-plan-actions'>
              <span className='au-muted'>{audit.plan.counts.now} now · {audit.plan.counts.next} next · {audit.plan.counts.later} later</span>
              <a className='au-pick' href={'/audit/' + audit.id + '/report'} target='_blank' rel='noopener noreferrer'>Client report ↗</a>
            </div>
          </div>
          {audit.plan.overview ? <p className='au-overview'>{audit.plan.overview}</p> : null}
          {(audit.plan.strengths || []).length ? (
            <div className='tag-cloud'>{audit.plan.strengths.map((s) => <span key={s} className='pill oss'>✓ {s}</span>)}</div>
          ) : null}
          <ol className='au-fixes'>
            {(audit.plan.items || []).slice(0, showAll ? 100 : 10).map((it) => {
              const fb = audit.plan.feedback?.[it.key]?.verdict;
              return (
              <li key={it.key} className={'au-fix tier-' + it.tier + (fb === 'down' ? ' dismissed' : '')}>
                <div className='au-fix-head'>
                  <span className={'au-tier tier-' + it.tier}>{fb === 'down' ? 'Not an issue' : TIER[it.tier]}</span>
                  <span className='pill'>{it.category}</span>
                  <span className='au-muted'>{it.effort}</span>
                  <div className='au-impact' title={'Impact ' + it.impact + ' / 3'}><i style={{ width: Math.round((it.impact / 3) * 100) + '%' }} /></div>
                  <div className='au-vote'>
                    <button className={fb === 'up' ? 'on' : ''} onClick={() => vote(it.key, 'up')} title='Right call'>👍</button>
                    <button className={fb === 'down' ? 'on' : ''} onClick={() => vote(it.key, 'down')} title='Not an issue'>👎</button>
                  </div>
                </div>
                <b>{it.section_id ? <a href={'#s' + it.section_id}>{it.title}</a> : it.title}</b>
                <p>{it.why}</p>
                <p className='au-fix-how'><span>Fix:</span> {it.fix}{it.wcag ? ' · WCAG ' + it.wcag : ''}</p>
              </li>
              );
            })}
          </ol>
          {(audit.plan.items || []).length > 10 ? (
            <button className='ghost-btn' onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show top 10' : 'Show all ' + audit.plan.items.length}
            </button>
          ) : null}
        </section>
      ) : null}

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

      {audit.psi?.mobile_screenshot ? (
        <details className='au-shot'>
          <summary>On a phone (as Google sees it)</summary>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={audit.psi.mobile_screenshot} alt='Mobile screenshot' style={{ maxWidth: 360 }} />
        </details>
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
        <SectionCard key={s.id} s={s} tools={audit.tools} onPick={pick} onCopy={copy}
          feedback={audit.plan?.feedback || {}} onVote={audit.plan ? vote : null} />
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

      {(audit.checks || []).length ? (
        <details className='au-checks'>
          <summary>All technical checks ({audit.checks.length})</summary>
          {audit.checks.map((c) => (
            <div key={c.id} className='au-check'>
              <span className={'au-sev sev-' + c.severity}>{c.severity}</span>
              <div>
                <b>{c.title}</b>
                <p>{c.why}</p>
                <p className='au-fix-how'><span>Fix:</span> {c.fix}{c.wcag ? ' · WCAG ' + c.wcag : ''}</p>
              </div>
            </div>
          ))}
        </details>
      ) : null}

      {audit.status === 'done' ? (
        <section className='au-ask'>
          <div className='d-label'>Ask about this audit</div>
          <div className='au-ask-row'>
            <input
              className='au-input'
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
              placeholder='e.g. What can I fix in one hour? Why is the FAQ flagged?'
            />
            <button className='au-go' onClick={() => ask()} disabled={asking || !question.trim()}>{asking ? 'Thinking…' : 'Ask'}</button>
          </div>
          <div className='tag-cloud'>
            {['What should I fix in the first hour?', 'Explain the top 3 problems to my client in simple words', 'Which issues hurt enquiries the most?'].map((q) => (
              <button key={q} className='tag-chip' onClick={() => ask(q)}>{q}</button>
            ))}
          </div>
          {answer ? <div className='au-answer'>{answer}</div> : null}
        </section>
      ) : null}

      {audit.engines?.decide || audit.engines?.design_used ? (
        <div className='au-engines'>
          Scored by {audit.engines.decide || '—'} · Designed by {audit.engines.design_used || audit.engines.design || '—'}
          {audit.plan?.impact_engine ? ' · Prioritised by ' + audit.plan.impact_engine : ''}
        </div>
      ) : null}

      {toast ? <div className='toast-stack'><div className='toast ok'>{toast}</div></div> : null}
    </Shell>
  );
}

function SectionCard({ s, tools, onPick, onCopy, feedback, onVote }) {
  const sug = s.suggestion || {};
  const pct = Math.round((Number(s.needs_work) || 0) * 100);
  const issueKey = (label) => 'issue:' + s.id + ':' + label;
  return (
    <article className='au-card' id={'s' + s.id}>
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
        <div className='tag-cloud'>
          {s.issues.map((i) => {
            const off = feedback?.[issueKey(i)]?.verdict === 'down';
            return onVote ? (
              <button key={i} className={'pill err au-issue' + (off ? ' off' : '')} onClick={() => onVote(issueKey(i), 'down', i)}
                title={off ? 'Restore this problem' : 'Not an issue here — click to dismiss'}>
                {i} <span aria-hidden>{off ? '↺' : '×'}</span>
              </button>
            ) : <span key={i} className='pill err'>{i}</span>;
          })}
        </div>
      ) : null}
      {s.scores?.uncertain ? <div className='au-note' style={{ margin: 0 }}>Jev was split on this one — worth a look yourself before acting.</div> : null}

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
            {d.checks ? (
              <div className='au-checked'>
                <span className={d.checks.fixes_problems >= 0.6 ? 'ok' : d.checks.fixes_problems < 0.35 ? 'bad' : ''}>
                  Fixes the problems: {Math.round(d.checks.fixes_problems * 100)}%
                </span>
                <span className={d.checks.invents_facts < 0.3 ? 'ok' : 'bad'}>
                  {d.checks.invents_facts < 0.3 ? 'No made-up facts' : 'Check the facts'}
                </span>
              </div>
            ) : null}
            {d.flag ? <div className='au-flag'>{d.flag}</div> : null}
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
