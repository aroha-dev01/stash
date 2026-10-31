'use client';

import { PRO } from '@/lib/plans';
import { useState } from 'react';
import { State, ago, api } from './ui';

function Stat({ value, label, sub }) {
  return (
    <div className='k-stat'>
      <b>{value ?? '-'}</b>
      <span>{label}</span>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

const why = (l) => {
  if (l.dead) return { tone: 'bad', word: 'Broken link', detail: l.dead_reason || 'Did not answer the last check' };
  if (l.status === 'error') return { tone: 'bad', word: 'Enrichment failed', detail: l.error || 'No details recorded' };
  return { tone: 'warn', word: 'Waiting to be read', detail: 'Added ' + ago(l.created_at) };
};

export default function Overview({ data, error, onReload, onGo, toast }) {
  const [retrying, setRetrying] = useState(false);

  if (error) {
    return (
      <section className='k-con-sec'>
        <h1 className='k-h2'>Curate</h1>
        <div className='k-alert'>
          <b>The console could not load.</b> {error}
          <div><button type='button' className='k-btn k-btn-sm' onClick={onReload}>Try again</button></div>
        </div>
      </section>
    );
  }
  if (!data) {
    return (
      <section className='k-con-sec'>
        <h1 className='k-h2'>Curate</h1>
        <p className='k-muted'>Checking every part of Stash</p>
      </section>
    );
  }

  const { stats: s, health: h, attention } = data;
  const sc = h.shortcut;

  const retryFailed = async () => {
    setRetrying(true);
    try {
      const r = await api('/api/links?status=error&limit=200');
      await Promise.all((r.items || []).map((i) => fetch('/api/enrich/' + i.id, { method: 'POST' })));
      toast((r.items || []).length + ' entries read again');
      onReload();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setRetrying(false);
    }
  };

  const checks = [
    {
      name: 'Database',
      state: h.database.ok ? ['ok', 'Connected'] : ['bad', 'Unreachable'],
      detail: h.database.detail,
    },
    {
      name: 'Google sign-in',
      state: h.signin.ok ? ['ok', 'On'] : ['bad', 'Not configured'],
      detail: h.signin.ok ? 'Members sign in with Google' : 'Sign-in keys are missing from the environment',
    },
    {
      name: 'AI summaries and assistant',
      state: h.ai.ok ? ['ok', 'On'] : ['warn', 'Off'],
      detail: h.ai.ok
        ? 'Model ' + h.ai.detail
        : 'New entries save but are not summarised, and Pro tools cannot answer. Add DEEPSEEK_API_KEY in Vercel.',
    },
    {
      name: 'Semantic search',
      state: h.semantic.ok ? ['ok', 'On'] : ['warn', 'Keyword only'],
      detail: h.semantic.detail,
    },
    {
      name: 'iOS shortcut',
      state: !sc.enabled ? ['off', 'Off'] : !sc.keys ? ['warn', 'No key yet'] : ['ok', 'On'],
      detail: !sc.enabled
        ? 'The share sheet endpoint is switched off'
        : !sc.keys
          ? 'Switched on, but no iPhone has a key'
          : 'Last heard from your iPhone ' + ago(sc.heard),
      action: { label: sc.enabled && sc.keys ? 'Open' : 'Set up', go: 'shortcut' },
    },
  ];

  return (
    <section className='k-con-sec' aria-labelledby='ov-h'>
      <div className='k-con-head'>
        <h1 id='ov-h' className='k-h2'>Curate</h1>
        <p className='k-lede'>Health of every moving part, who has joined, and what in the catalogue needs a look.</p>
      </div>

      <div className='k-stats'>
        <Stat value={s.entries} label='Entries' sub={s.premium + ' for members or ' + PRO.name} />
        <Stat value={s.members} label='Members' sub={s.pro + ' on ' + PRO.name} />
        <Stat value={s.agentKeys} label='Agent keys' sub='connected to MCP' />
        <Stat value={s.errored + s.working + s.dead} label='Need a look' sub={s.dead + ' broken, ' + s.errored + ' failed'} />
      </div>

      <div className='k-block'>
        <div className='k-block-head k-block-row'>
          <h2 className='k-h3'>Health</h2>
          <button type='button' className='k-btn k-btn-sm' onClick={onReload}>Check again</button>
        </div>
        <ul className='k-health'>
          {checks.map((c) => (
            <li key={c.name}>
              <div>
                <b>{c.name}</b>
                <span className='k-small k-dim'>{c.detail}</span>
              </div>
              <State tone={c.state[0]}>{c.state[1]}</State>
              {c.action ? (
                <button type='button' className='k-btn k-btn-sm' onClick={() => onGo(c.action.go)}>{c.action.label}</button>
              ) : <span />}
            </li>
          ))}
        </ul>
      </div>

      <div className='k-block'>
        <div className='k-block-head k-block-row'>
          <div style={{ display: 'grid', gap: 4 }}>
            <h2 className='k-h3'>Needs a look</h2>
            <span className='k-small k-dim'>Newest first. Members never see entries that failed to read.</span>
          </div>
          <div className='k-d-actions'>
            {s.errored ? (
              <button type='button' className='k-btn k-btn-sm' onClick={retryFailed} disabled={retrying}>
                {retrying ? 'Reading again' : 'Retry failed'}
              </button>
            ) : null}
            <button type='button' className='k-btn k-btn-sm' onClick={() => onGo('catalogue', 'attention')}>See all</button>
          </div>
        </div>
        {attention.length ? (
          <ul className='k-health'>
            {attention.map((l) => {
              const w = why(l);
              return (
                <li key={l.id}>
                  <div>
                    <b>{l.title || l.domain}</b>
                    <span className='k-small k-dim k-clip'>{w.detail}</span>
                  </div>
                  <State tone={w.tone}>{w.word}</State>
                  <span />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className='k-muted' style={{ margin: 0 }}>Nothing is waiting. Every entry was read and every link answered.</p>
        )}
      </div>
    </section>
  );
}
