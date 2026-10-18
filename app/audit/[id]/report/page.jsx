'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { howtoFor } from '@/lib/audit/howto';
import '../../dz.css';

// The client's report: light, printable, no jargon and no internal scores.
// What was found, why it matters to their visitors, what we will do, pictures
// of the sections we will improve and the visual inspiration behind them.
// "Save as PDF" from the browser's print dialog gives a shareable file.

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const TIER = { now: 'Priority', next: 'Next', later: 'Later' };
const GROUP = { now: 'Do first', next: 'Next', later: 'Later, when time allows' };
const LH_LABEL = { performance: 'Speed on mobile', accessibility: 'Accessibility', seo: 'Search visibility', 'best-practices': 'Technical health' };
const label = (s) => (s === 'cta' || s === 'faq' ? s.toUpperCase() : String(s || 'Section').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const col = (v) => (v >= 80 ? '#067647' : v >= 55 ? '#b54708' : '#b42318');

function Pic({ src, tall }) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  return (
    <span className='snip' style={tall ? { aspectRatio: '4/3' } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt='' referrerPolicy='no-referrer' onError={() => setBad(true)} />
    </span>
  );
}

function Inspo({ tool }) {
  const [bad, setBad] = useState(false);
  return (
    <a className='tile' href={tool.url || '#'} target='_blank' rel='noopener noreferrer'>
      <div className='img'>
        {tool.image && !bad
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={tool.image} alt='' referrerPolicy='no-referrer' onError={() => setBad(true)} />
          : <b>{String(tool.title || '?').slice(0, 2)}</b>}
      </div>
      <div className='body'><b className='t' style={{ fontSize: 13.5 }}>{tool.title}</b></div>
    </a>
  );
}

export default function ClientReport() {
  const { id } = useParams();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  const [ticked, setTicked] = useState({});
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch('/api/audit/' + id).then((r) => r.json()).then((j) => {
      if (j.error) return setErr(j.error);
      setA(j);
      const keys = j.plan?.approvals?.keys || [];
      setTicked(Object.fromEntries(keys.map((k) => [k, true])));
      setSent(j.plan?.approvals?.at || null);
      setName(j.plan?.approvals?.name || '');
      document.title = (j.client || hostOf(j.url)) + ' website review';
    }).catch((e) => setErr(e.message));
  }, [id]);

  async function sendApproval(keys) {
    setSending(true);
    try {
      const res = await fetch('/api/audit/' + id + '/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'approve', keys, name, note }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) setSent(j.approvals?.at || new Date().toISOString());
    } finally { setSending(false); }
  }

  // A standalone copy of the report: this page's markup with its styles inlined.
  function downloadHtml() {
    const css = [...document.styleSheets].map((sh) => { try { return [...sh.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
      document.title.replace(/</g, '') + '</title><style>' + css + '</style></head><body>' + document.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '') + '</body></html>';
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    el.download = hostOf(a.url) + '-website-review.html';
    el.click();
    setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  }

  if (err) return <div className='dz'><div style={{ padding: 40 }}>{err}</div></div>;
  if (!a) return <div className='dz'><div style={{ padding: 40 }}>Loading…</div></div>;
  if (a.status !== 'done') return <div className='dz'><div style={{ padding: 40 }}>This audit is still running. Open it in Stash to finish, then come back.</div></div>;

  const plan = a.plan || {};
  const ctx = { host: hostOf(a.url), url: a.url };
  const dismissed = (k) => plan.feedback?.[k]?.verdict === 'down';
  // Only what you have not marked "not an issue", most important first.
  const items = (plan.items || []).filter((i) => !dismissed(i.key)).slice(0, 15);
  const groups = ['now', 'next', 'later'].map((t) => [t, items.filter((i) => i.tier === t)]).filter((g) => g[1].length);
  const sections = (a.sections || []).filter((s) => s.status === 'designed' && s.suggestion?.diagnosis).slice(0, 6);
  const scores = [];
  if (a.summary?.health != null) scores.push(['Design & content', a.summary.health]);
  Object.entries(a.psi?.scores || {}).slice(0, 3).forEach(([k, v]) => scores.push([LH_LABEL[k] || k, v]));
  if (scores.length < 4 && a.summary?.site_scores?.security != null) scores.push(['Security', a.summary.site_scores.security]);
  const goTo = (hid) => document.getElementById(hid)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const toc = [['r-sum', 'Summary'], ['r-work', 'What works'], ...groups.map((g) => ['r-' + g[0], GROUP[g[0]]]), ...(sections.length ? [['r-sections', 'Sections']] : []), ['r-go', 'Next steps']];
  const nowItems = items.filter((i) => i.tier !== 'later').slice(0, 10);
  const brand = plan.brand || {};
  const approvedAt = sent ? new Date(sent).toLocaleDateString() : null;

  return (
    <div className='dz' style={brand.color ? { '--brand': brand.color, '--brand-t': brand.color + '1f' } : undefined}>
      <div className='repwrap'>
        <div className='toc2'>
          <b style={{ fontSize: 12, color: 'var(--soft)', padding: '0 10px 6px' }}>ON THIS PAGE</b>
          {toc.map(([k, n]) => <button key={k} onClick={() => goTo(k)}>{n}</button>)}
          <div style={{ height: 10 }} />
          <button onClick={() => window.print()}>Save as PDF</button>
          <button onClick={downloadHtml}>Download (.html)</button>
          <button onClick={() => navigator.clipboard.writeText(window.location.href)}>Copy link</button>
        </div>

        <div className='rep'>
          <div className='cover'>
            {brand.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_url} alt={brand.agency || ''} referrerPolicy='no-referrer' style={{ height: 34, maxWidth: 160, objectFit: 'contain', float: 'right', background: '#fff', borderRadius: 8, padding: 4 }} />
            ) : null}
            <small>Website review · {new Date(a.updated_at || a.created_at).toLocaleDateString()}{brand.agency ? ' · prepared by ' + brand.agency : ''}</small>
            <h1>{a.client || a.title || hostOf(a.url)}</h1>
            <p><a href={a.url} target='_blank' rel='noopener noreferrer' style={{ color: '#fff' }}>{a.url} ↗</a></p>
          </div>
          <div className='sc' style={{ gridTemplateColumns: 'repeat(' + Math.max(scores.length, 1) + ',1fr)' }}>
            {scores.map(([n, v]) => <div key={n}><b style={{ color: col(v) }}>{v}</b><span>{n}</span></div>)}
          </div>

          <p id='r-sum' style={{ marginTop: 28, fontSize: 16.5, maxWidth: '64ch' }}>{plan.client_summary || plan.overview}</p>

          {(plan.strengths || []).length ? (
            <>
              <h2 id='r-work'>What is already working</h2>
              <ul className='s'>{plan.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            </>
          ) : <span id='r-work' />}

          {groups.map(([t, list]) => (
            <div key={t}>
              <h2 id={'r-' + t}>{GROUP[t]}</h2>
              {list.map((it) => {
                const how = howtoFor(it.key, it.category, ctx);
                const learn = how?.docs?.[0]?.[1];
                return (
                  <div key={it.key} className='rec'>
                    <span className={'tier ' + t} style={{ alignSelf: 'start' }}>{TIER[t]}</span>
                    <div>
                      <b>{it.title}</b>
                      <p>{it.why}</p>
                      {how?.meaning ? <p style={{ color: 'var(--mute)', fontSize: 14 }}><b style={{ color: 'var(--ink)', fontWeight: 600 }}>What it means for you:</b> {how.meaning}</p> : null}
                      <p className='do'><b style={{ fontWeight: 600 }}>What we will do:</b> {it.client_fix || it.fix}</p>
                    </div>
                    {learn ? <a className='more' href={learn} target='_blank' rel='noopener noreferrer'>Learn more ↗</a> : <span />}
                  </div>
                );
              })}
            </div>
          ))}

          {sections.length ? (
            <>
              <h2 id='r-sections'>Page sections we will improve</h2>
              {sections.map((s) => {
                const d = s.suggestion?.directions?.[s.picked ?? 0];
                const previews = s.signals?.previews || [];
                const refs = (s.suggestion?.visuals || []).filter((v) => v.label !== 'weak' && a.tools?.[v.tool_id]).slice(0, 3);
                return (
                  <div key={s.id} className='zcard' style={{ padding: '16px 18px', margin: '0 0 14px' }}>
                    <b>{label(s.type)}{s.heading ? ' — “' + s.heading + '”' : ''}</b>
                    {previews.length ? <div className='snips'>{previews.map((p) => <Pic key={p} src={p} />)}</div> : null}
                    <p style={{ margin: '12px 0 0' }}>{s.suggestion.diagnosis}</p>
                    {d ? <p style={{ margin: '6px 0 0', color: 'var(--mute)', fontSize: 14 }}><b style={{ color: 'var(--ink)' }}>Plan:</b> {d.title}. {d.idea}</p> : null}
                    {refs.length ? (
                      <>
                        <div className='snips-cap'>Visual inspiration</div>
                        <div className='tgrid' style={{ gridTemplateColumns: 'repeat(3,1fr)', marginTop: 8 }}>
                          {refs.map((v) => <Inspo key={v.tool_id} tool={a.tools[v.tool_id]} />)}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </>
          ) : null}

          <div className='next' id='r-go'>
            <h2>Next steps</h2>
            <p>Tick what you would like us to start with, then send it. We will confirm timing and update you as each item is done.</p>
            <div className='tasks'>
              {nowItems.map((it) => (
                <div key={it.key} className={'tk' + (ticked[it.key] ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTicked((t) => ({ ...t, [it.key]: !t[it.key] }))}>
                  <i>{ticked[it.key] ? '✓' : ''}</i><span>{it.title}</span>
                </div>
              ))}
            </div>
            <div className='ask' style={{ flexWrap: 'wrap' }}>
              <input placeholder='Your name' value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 220 }} />
              <input placeholder='Anything we should know? (optional)' value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className='tools' style={{ marginTop: 14 }}>
              <button className='btn pri' disabled={sending || !Object.values(ticked).some(Boolean) || !name.trim()} onClick={() => sendApproval(Object.keys(ticked).filter((k) => ticked[k]))}>{sending ? 'Sending…' : sent ? 'Update approval' : 'Send approval'}</button>
              <button className='btn' onClick={() => window.print()}>Save as PDF</button>
              {approvedAt ? <span className='a-ok' style={{ alignSelf: 'center' }}>Approval received {approvedAt}. Thank you.</span> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
