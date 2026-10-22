'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import '../index.css';
import './landing.css';

// Start a site audit, and see the ones already run. Same "Index" look as the
// library home: warm paper, ink, one green, hairline rows.

const STATUS_LABEL = {
  queued: 'Starting', capturing: 'Reading page', measuring: 'Measuring speed', classifying: 'Scoring sections',
  designing: 'Designing fixes', planning: 'Ranking fixes', done: 'Done', error: 'Failed',
};

// What an audit covers. Each chip jumps to that part of the finished report.
const COVERS = [
  ['Sections', 'sections', 'Every section of the page scored, with redesign directions built on your library.'],
  ['Speed', 'checks', 'Real-phone speed and accessibility from Google PageSpeed, plus real-visitor data when it exists.'],
  ['SEO', 'checks', 'Titles, canonicals, structured data, links, content and indexing, on every page read.'],
  ['AI visibility', 'ai', 'Whether ChatGPT, Perplexity and Google AI can read and cite the site.'],
  ['Security', 'security', 'Exposed files, leaked keys, outdated libraries, headers, certificates and Google Safe Browsing.'],
  ['Backlinks', 'links', 'A plan to earn links that help the client be found on Google.'],
];

export default function AuditsPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [client, setClient] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [audits, setAudits] = useState(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [more, setMore] = useState(12);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    // Arriving from the home screen with ?url= pre-fills the box.
    const p = new URLSearchParams(window.location.search);
    if (p.get('url')) setUrl(p.get('url'));
    fetch('/api/audit').then((r) => r.json()).then((j) => setAudits(j.audits || [])).catch(() => setAudits([]));
  }, []);

  async function start() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), client: client.trim() || null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not start the audit');
      router.push('/audit/' + j.id);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (audits || []).filter((a) => {
      if (show === 'done' && a.status !== 'done') return false;
      if (show === 'running' && (a.status === 'done' || a.status === 'error')) return false;
      if (show === 'weak' && !(a.status === 'done' && a.summary?.health != null && a.summary.health < 60)) return false;
      if (!t) return true;
      return [a.client, a.title, a.url, a.framework].filter(Boolean).join(' ').toLowerCase().includes(t);
    });
  }, [audits, q, show]);

  const counts = useMemo(() => {
    const a = audits || [];
    return {
      all: a.length,
      done: a.filter((x) => x.status === 'done').length,
      running: a.filter((x) => x.status !== 'done' && x.status !== 'error').length,
      weak: a.filter((x) => x.status === 'done' && x.summary?.health != null && x.summary.health < 60).length,
    };
  }, [audits]);

  return (
    <div className='app ix au'>
      <div className='ix-wrap'>
        <div className='ix-bar'>
          <a className='ix-logo' href='/'>stash<i>.</i></a>
          <span className='ix-sp' />
          <a className='ix-btn' href='/'>Library</a>
          <a className='ix-btn p' href='#audit-form'>New audit</a>
        </div>

        <section className='ix-hero' id='audit-form'>
          <h1>Audit a client site, <em>fix what matters first.</em></h1>
          <p className='ixa-lede'>
            Paste a page. Stash reads it, scores every section, checks speed, SEO, AI visibility and security,
            and ranks what to fix first, built on the tools already in your library.
          </p>
          <div className='ixa-form'>
            <input
              className='ixa-in' value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
              placeholder='client-site.com' aria-label='Site to audit'
              autoCapitalize='off' autoCorrect='off' spellCheck={false}
            />
            <input
              className='ixa-in client' value={client} onChange={(e) => setClient(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
              placeholder='Client name (optional)' aria-label='Client name'
            />
            <button type='button' className='ix-btn p ixa-go' onClick={start} disabled={busy || !url.trim()}>
              {busy ? 'Reading the page…' : 'Run audit →'}
            </button>
          </div>
          {err ? <div className='ixa-err' role='alert'>{err}</div> : null}

          <div className='ixa-covers'>
            <span>Each audit covers</span>
            {COVERS.map(([name, , why]) => (
              <button key={name} type='button' className='ix-btn' aria-pressed={info === name} onClick={() => setInfo(info === name ? null : name)}>{name}</button>
            ))}
          </div>
          {info ? <p className='ixa-info'>{COVERS.find((c) => c[0] === info)[2]}</p> : null}
        </section>

        <div className='ix-tools'>
          <div className='ix-s'>
            <svg width='15' height='15' viewBox='0 0 24 24' aria-hidden='true'><circle cx='11' cy='11' r='7' /><path d='M20 20l-4-4' /></svg>
            <input value={q} onChange={(e) => { setQ(e.target.value); setMore(12); }} placeholder='Search past audits by client, site or framework' aria-label='Search audits' />
            {q ? <button type='button' className='ix-clr' onClick={() => setQ('')} aria-label='Clear search'>✕</button> : null}
          </div>
          <div className='ix-seg' role='group' aria-label='Show'>
            {[['all', 'All'], ['done', 'Finished'], ['running', 'Running'], ['weak', 'Needs work']].map(([k, l]) => (
              <button key={k} type='button' aria-pressed={show === k} onClick={() => { setShow(k); setMore(12); }}>{l}<sup>{counts[k]}</sup></button>
            ))}
          </div>
        </div>

        <div className='ix-head'><div><b>Recent audits</b><span>{list.length}</span></div></div>
        {audits === null ? <p className='ixa-muted'>Loading…</p> : null}
        {audits && !list.length ? (
          <div className='ix-empty'>
            <b>{audits.length ? 'No audits match that' : 'No audits yet'}</b>
            <p>{audits.length ? 'Clear the search or the filter.' : 'Paste a site above. Your first audit will show up here.'}</p>
            {audits.length ? <button type='button' className='ix-btn' onClick={() => { setQ(''); setShow('all'); }}>Clear</button> : null}
          </div>
        ) : null}
        {list.length ? (
          <div className='ix-scroll'>
            <table className='ix-table'>
              <thead><tr><th>Client</th><th>Site</th><th>Stack</th><th>Result</th><th style={{ textAlign: 'right' }}>Run</th></tr></thead>
              <tbody>
                {list.slice(0, more).map((a) => (
                  <tr key={a.id} className='ix-r' tabIndex={0} onClick={() => router.push('/audit/' + a.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push('/audit/' + a.id); }}>
                    <td><a className='ix-nm ixa-link' href={'/audit/' + a.id} onClick={(e) => e.stopPropagation()}>{a.client || a.title || hostOf(a.url)}</a></td>
                    <td className='ix-u'>{hostOf(a.url)}</td>
                    <td>{a.framework ? <span className='ix-tag'>{a.framework}</span> : null}</td>
                    <td>
                      {a.status === 'done' && a.summary?.health != null
                        ? <span className={'ixa-score ' + band(a.summary.health)}>{a.summary.health}<small>/100</small></span>
                        : <span className={'ixa-status ' + a.status}>{STATUS_LABEL[a.status] || a.status}</span>}
                    </td>
                    <td className='ix-dt'>{new Date(a.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.length > more ? <div className='ix-more'><button type='button' className='ix-btn' onClick={() => setMore((m) => m + 12)}>Show 12 more <span>({more} of {list.length})</span></button></div> : null}
      </div>
    </div>
  );
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

function band(score) {
  return score >= 75 ? 'good' : score >= 50 ? 'ok' : 'bad';
}
