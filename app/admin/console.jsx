'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, useToasts } from './ui';
import Overview from './overview';
import Catalogue from './catalogue';
import Members from './members';
import Shortcut from './shortcut';
import Settings from './settings';

const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'members', label: 'Members' },
  { key: 'shortcut', label: 'iOS shortcut' },
  { key: 'settings', label: 'Settings' },
];

export default function Console({ initialTab, origin, viewer }) {
  const [tab, setTab] = useState(initialTab);
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState(null);
  // Where Overview sends you into the catalogue, for example "needs attention".
  const [catalogueView, setCatalogueView] = useState('all');
  const [toast, toasts] = useToasts();

  const loadOverview = useCallback(() => {
    setOverviewError(null);
    return api('/api/admin/overview').then(setOverview, (e) => setOverviewError(e.message));
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  // The section lives in the address, so a reload or a shared link lands on it.
  const go = useCallback((key, view) => {
    if (view) setCatalogueView(view);
    setTab(key);
    const u = new URL(window.location.href);
    if (key === 'overview') u.searchParams.delete('tab');
    else u.searchParams.set('tab', key);
    window.history.replaceState(null, '', u);
    window.scrollTo({ top: 0 });
  }, []);

  const s = overview?.stats;
  const attention = s ? s.errored + s.working + s.dead : 0;
  const sc = overview?.health?.shortcut;

  const hint = (key) => {
    if (key === 'catalogue' && attention) return <span className='k-rail-flag'>{attention}</span>;
    if (key === 'catalogue' && s?.entries != null) return <span>{s.entries}</span>;
    if (key === 'members' && s?.members != null) return <span>{s.members}</span>;
    if (key === 'shortcut' && sc) return <span>{sc.enabled ? (sc.keys ? 'On' : 'No key') : 'Off'}</span>;
    return <span />;
  };

  return (
    <main className='k-wrap k-explore k-console'>
      <aside className='k-rail' aria-label='Console sections'>
        <div>
          <h2>Curate</h2>
          <div className='k-rail-list'>
            {SECTIONS.map((x) => (
              <button key={x.key} type='button' className='k-rail-item' aria-pressed={tab === x.key} onClick={() => go(x.key)}>
                <span>{x.label}</span>
                {hint(x.key)}
              </button>
            ))}
          </div>
        </div>
        <div className='k-rail-foot k-small k-dim'>
          Signed in as {viewer.email}
        </div>
      </aside>

      <div className='k-con-main'>
        {tab === 'overview' ? (
          <Overview data={overview} error={overviewError} onReload={loadOverview} onGo={go} toast={toast} />
        ) : null}
        {tab === 'catalogue' ? (
          <Catalogue initialView={catalogueView} onChanged={loadOverview} toast={toast} />
        ) : null}
        {tab === 'members' ? <Members me={viewer.id} onChanged={loadOverview} toast={toast} /> : null}
        {tab === 'shortcut' ? <Shortcut origin={origin} onChanged={loadOverview} toast={toast} /> : null}
        {tab === 'settings' ? <Settings overview={overview} onChanged={loadOverview} toast={toast} /> : null}
      </div>
      {toasts}
    </main>
  );
}
