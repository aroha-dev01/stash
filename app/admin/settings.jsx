'use client';

import { useEffect, useState } from 'react';
import { TOOLKITS } from '@/lib/taxonomy';
import { PRO } from '@/lib/plans';
import { State, Toggle, api } from './ui';

const START = [
  ['public', 'Public'],
  ['free', 'Members'],
  ['premium', PRO.name],
];

export default function Settings({ overview, onChanged, toast }) {
  const [catalogue, setCatalogue] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/admin/settings').then((j) => setCatalogue(j.catalogue), (e) => toast(e.message, 'bad'));
  }, [toast]);

  const save = async (patch, message) => {
    setBusy(true);
    try {
      const j = await api('/api/admin/settings', { method: 'PATCH', body: patch });
      setCatalogue(j.catalogue);
      toast(message);
      onChanged();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const locked = catalogue?.premium_toolkits || [];
  const lockToolkit = (key, on) => {
    const next = on ? [...locked, key] : locked.filter((k) => k !== key);
    const label = TOOLKITS.find((t) => t.key === key).label;
    save({ premium_toolkits: next }, on ? label + ' is now ' + PRO.name + ' only' : label + ' is open again');
  };

  const env = overview?.env || [];

  return (
    <section className='k-con-sec' aria-labelledby='set-h'>
      <div className='k-con-head'>
        <h1 id='set-h' className='k-h2'>Settings</h1>
        <p className='k-lede'>Catalogue defaults, the keys Stash runs on, and your data.</p>
      </div>

      <div className='k-block'>
        <div className='k-block-head'>
          <h2 className='k-h3'>Catalogue</h2>
        </div>
        <div className='k-setting'>
          <div>
            <b>New entries start as</b>
            <span className='k-small k-dim'>
              Applies to links added here, in bulk and from the iOS shortcut. You can change any entry later.
            </span>
          </div>
          <select
            className='k-input k-input-sm'
            aria-label='New entries start as'
            value={catalogue?.new_entries_access || 'public'}
            disabled={!catalogue || busy}
            onChange={(e) => save({ new_entries_access: e.target.value }, 'New entries start as ' + START.find(([k]) => k === e.target.value)[1])}
          >
            {START.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
      </div>

      <div className='k-block'>
        <div className='k-block-head'>
          <h2 className='k-h3'>{PRO.name} toolkits</h2>
          <p className='k-muted' style={{ margin: 0 }}>
            A locked toolkit stays visible on the homepage and Explore with a lock, but its entries open only for
            members on {PRO.name}. The website, its search and every MCP tool enforce it on the next request.
          </p>
        </div>
        {TOOLKITS.map((t) => (
          <div key={t.key} className='k-setting'>
            <div>
              <b>{t.label}</b>
              <span className='k-small k-dim'>{t.blurb}</span>
            </div>
            <span className='k-setting-ctl'>
              <State tone={locked.includes(t.key) ? 'warn' : 'ok'}>{locked.includes(t.key) ? PRO.name + ' only' : 'Open'}</State>
              <Toggle
                on={locked.includes(t.key)}
                label={'Lock ' + t.label + ' to ' + PRO.name}
                disabled={!catalogue || busy}
                onChange={(v) => lockToolkit(t.key, v)}
              />
            </span>
          </div>
        ))}
      </div>

      <div className='k-block'>
        <div className='k-block-head'>
          <h2 className='k-h3'>Environment</h2>
          <p className='k-muted' style={{ margin: 0 }}>
            Set in Vercel, under the project&apos;s Settings, Environment Variables. Values are never shown here, only
            whether each one is set. Redeploy after changing one.
          </p>
        </div>
        {env.length ? (
          <ul className='k-health'>
            {env.map((e) => (
              <li key={e.name}>
                <div>
                  <code>{e.name}</code>
                  <span className='k-small k-dim'>{e.what}</span>
                </div>
                <State tone={e.set ? 'ok' : e.required ? 'bad' : 'off'}>
                  {e.set ? 'Set' : e.required ? 'Missing' : 'Not set'}
                </State>
                <span />
              </li>
            ))}
          </ul>
        ) : (
          <p className='k-muted' style={{ margin: 0 }}>Loading</p>
        )}
      </div>

      <div className='k-block'>
        <div className='k-block-head'>
          <h2 className='k-h3'>Data</h2>
        </div>
        <div className='k-setting'>
          <div>
            <b>Export the catalogue</b>
            <span className='k-small k-dim'>Every entry as JSON, including curator notes. Keep the file private.</span>
          </div>
          <a className='k-btn k-btn-sm' href='/api/export'>Download JSON</a>
        </div>
        <div className='k-setting'>
          <div>
            <b>Sign out</b>
            <span className='k-small k-dim'>Ends your session on this browser.</span>
          </div>
          <form method='post' action='/auth/signout'>
            <button className='k-btn k-btn-sm' type='submit'>Sign out</button>
          </form>
        </div>
      </div>
    </section>
  );
}
