'use client';

import { useEffect, useState } from 'react';
import { State, Toggle, api } from './ui';

export default function Settings({ overview, onChanged, toast }) {
  const [catalogue, setCatalogue] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/admin/settings').then((j) => setCatalogue(j.catalogue), (e) => toast(e.message, 'bad'));
  }, [toast]);

  const setPremium = async (v) => {
    setBusy(true);
    try {
      const j = await api('/api/admin/settings', { method: 'PATCH', body: { new_entries_premium: v } });
      setCatalogue(j.catalogue);
      toast(v ? 'New entries start as members only' : 'New entries start public');
      onChanged();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
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
            <b>New entries start as members only</b>
            <span className='k-small k-dim'>
              Applies to links added here, in bulk and from the iOS shortcut. You can change any entry later.
            </span>
          </div>
          <Toggle
            on={!!catalogue?.new_entries_premium}
            label='New entries start as members only'
            disabled={!catalogue || busy}
            onChange={setPremium}
          />
        </div>
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
