'use client';

import { useCallback, useEffect, useState } from 'react';
import { Toggle, ago, api, date } from './ui';

export default function Members({ me, onChanged, toast }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => api('/api/admin/members').then((j) => { setMembers(j.members); setError(null); }, (e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const change = async (m, patch, done) => {
    setBusy(m.id);
    try {
      const { member } = await api('/api/admin/members', { method: 'PATCH', body: { id: m.id, ...patch } });
      setMembers((list) => list.map((x) => (x.id === m.id ? { ...x, ...member } : x)));
      toast(done);
      onChanged();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const f = filter.trim().toLowerCase();
  const shown = (members || []).filter((m) => !f || (m.email || '').toLowerCase().includes(f) || (m.name || '').toLowerCase().includes(f));
  const pro = (members || []).filter((m) => m.plan === 'pro').length;

  return (
    <section className='k-con-sec' aria-labelledby='mem-h'>
      <div className='k-con-head'>
        <h1 id='mem-h' className='k-h2'>Members</h1>
        <p className='k-lede'>
          Everyone who has signed in. Until payments open, this is where you give someone Pro.
        </p>
      </div>

      {error ? (
        <div className='k-alert'>
          <b>Members did not load.</b> {error}
          <div><button type='button' className='k-btn k-btn-sm' onClick={load}>Try again</button></div>
        </div>
      ) : (
        <div className='k-block'>
          <div className='k-block-head k-block-row'>
            <span className='k-muted'>
              {members ? members.length + ' members, ' + pro + ' on Pro' : 'Loading'}
            </span>
            <div className='k-field' style={{ flex: '0 1 320px' }}>
              <label className='k-sr' htmlFor='mem-q'>Find a member</label>
              <input id='mem-q' value={filter} onChange={(e) => setFilter(e.target.value)} placeholder='Find by name or email' />
            </div>
          </div>

          <ul className='k-members'>
            {shown.map((m) => (
              <li key={m.id}>
                <span className='k-me'>
                  {m.avatar_url ? (
                    <img className='k-avatar' src={m.avatar_url} alt='' referrerPolicy='no-referrer' />
                  ) : (
                    <span className='k-avatar'>{(m.name || m.email || '?').slice(0, 1).toUpperCase()}</span>
                  )}
                  <span style={{ minWidth: 0 }}>
                    <b className='k-clip'>{m.name || m.email}{m.id === me ? ' (you)' : ''}</b>
                    <span className='k-small k-dim k-clip'>{m.email}</span>
                  </span>
                </span>

                <span className='k-small k-dim k-mem-meta'>
                  Joined {date(m.created_at)}
                  <br />
                  {m.saves} saved, {m.keys} agent {m.keys === 1 ? 'key' : 'keys'}
                  {m.agent_last_used ? ', agent used ' + ago(m.agent_last_used) : ''}
                </span>

                <span className='k-mem-ctl'>
                  <label className='k-sr' htmlFor={'plan-' + m.id}>Plan for {m.email}</label>
                  <select
                    id={'plan-' + m.id}
                    className='k-input k-input-sm'
                    value={m.plan}
                    disabled={busy === m.id}
                    onChange={(e) => change(m, { plan: e.target.value }, (m.name || m.email) + ' is on ' + (e.target.value === 'pro' ? 'Pro' : 'Free') + ' now')}
                  >
                    <option value='free'>Free</option>
                    <option value='pro'>Pro</option>
                  </select>
                </span>

                <span className='k-mem-ctl'>
                  <span className='k-small k-muted'>Curator</span>
                  <Toggle
                    on={m.is_admin}
                    label={'Curator role for ' + m.email}
                    disabled={busy === m.id || m.id === me}
                    onChange={(v) => {
                      if (v && !confirm('Make ' + m.email + ' a curator? They can edit and delete every entry, manage members and use the iOS shortcut.')) return;
                      change(m, { is_admin: v }, (m.name || m.email) + (v ? ' can curate now' : ' is no longer a curator'));
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
          {members && !shown.length ? <p className='k-muted' style={{ margin: 0 }}>No member matches "{filter}".</p> : null}
        </div>
      )}
    </section>
  );
}
