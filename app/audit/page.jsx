'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// Start a site audit, and see the ones already run.

const STATUS_LABEL = {
  queued: 'Starting', capturing: 'Reading page', classifying: 'Scoring sections',
  designing: 'Designing fixes', done: 'Done', error: 'Failed',
};

export default function AuditsPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [client, setClient] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [audits, setAudits] = useState(null);

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

  return (
    <div className='app au'>
      <header className='topbar'>
        <a className='brand' href='/'>
          <span className='brand-mark' />
          <span className='brand-name'>stash</span>
        </a>
        <div className='topbar-right'>
          <a className='ghost-btn' href='/'>Library</a>
        </div>
      </header>

      <section className='au-hero'>
        <h1>Audit a client site</h1>
        <p>
          Paste a page. Stash splits it into sections, scores each one, and writes redesign
          directions for the weak ones — built on tools already in your library.
        </p>
        <div className='au-form'>
          <input
            className='au-input'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
            placeholder='client-site.com'
            autoCapitalize='off' autoCorrect='off' spellCheck={false}
          />
          <input
            className='au-input au-client'
            value={client}
            onChange={(e) => setClient(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
            placeholder='Client name (optional)'
          />
          <button className='au-go' onClick={start} disabled={busy || !url.trim()}>
            {busy ? 'Reading the page…' : 'Run audit'}
          </button>
        </div>
        {err ? <div className='au-err'>{err}</div> : null}
      </section>

      <section className='au-list'>
        <div className='d-label'>Recent audits</div>
        {audits === null ? <div className='au-muted'>Loading…</div> : null}
        {audits && !audits.length ? <div className='au-muted'>None yet. Your first one will show up here.</div> : null}
        {(audits || []).map((a) => (
          <a key={a.id} className='au-row' href={'/audit/' + a.id}>
            <div className='au-row-main'>
              <b>{a.client || a.title || hostOf(a.url)}</b>
              <span>{hostOf(a.url)}{a.framework ? ' · ' + a.framework : ''}</span>
            </div>
            <div className='au-row-side'>
              {a.status === 'done' && a.summary?.health != null ? (
                <span className={'au-health ' + band(a.summary.health)}>{a.summary.health}</span>
              ) : (
                <span className={'au-status ' + a.status}>{STATUS_LABEL[a.status] || a.status}</span>
              )}
              <small>{new Date(a.created_at).toLocaleDateString()}</small>
            </div>
          </a>
        ))}
      </section>
    </div>
  );
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

function band(score) {
  return score >= 75 ? 'good' : score >= 50 ? 'ok' : 'bad';
}
