'use client';

import { useMemo, useState } from 'react';
import { backlinkPlan } from '@/lib/audit/backlinks';

// "Earn links" plan for the audited site. Everything is generated from what
// the audit already knows; nothing is sent anywhere. The city box fills the
// search queries and templates.

const TONE = { high: 'g', medium: 'y', low: '' };

function Copy({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button type='button' className='zbtn' style={{ padding: '2px 8px', fontSize: 12 }}
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}>
      {done ? 'Copied' : label}
    </button>
  );
}

export function BacklinkCard({ audit }) {
  const [city, setCity] = useState('');
  const [open, setOpen] = useState(null);
  const plan = useMemo(() => backlinkPlan(audit, { city: city.trim() || undefined }), [audit, city]);
  const rows = plan.channels;

  return (
    <section id='links' className='zcard pad'>
      <h2>Earn backlinks</h2>
      <div className='sub'>A plan for earning links that help {plan.brand} be found on Google. Ranked by value for a {plan.noun} site. Only methods Google allows.</div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
        <label className='sub' htmlFor='bl-city'>City or area served</label>
        <input id='bl-city' value={city} onChange={(e) => setCity(e.target.value)} placeholder='e.g. Hyderabad' style={{ maxWidth: 200 }} />
        {!plan.city_known ? <span className='sub'>Add it to fill in the searches below.</span> : null}
      </div>

      <h3 className='prg-h'>Profiles to claim or link</h3>
      <div className='pills'>
        {plan.profiles.map((p) => <span key={p.name} className={'zpill ' + (p.done ? 'g' : '')} title={p.why}>{p.done ? '✓ ' : ''}{p.name}</span>)}
      </div>
      <p className='sub'>Ticked profiles are already linked from the site. Hover for why each matters.</p>

      <h3 className='prg-h'>Where to earn links, best first</h3>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {rows.map((c, i) => (
          <li key={c.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line, #e7e3da)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <b>{i + 1}. {c.title}</b>
              <span className={'zpill ' + (TONE[c.impact] || '')}>{c.impact} value</span>
              <span className='zpill'>{c.effort} effort</span>
              <button type='button' className='zbtn' style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide' : 'How'}</button>
            </div>
            <p style={{ margin: '4px 0' }}>{c.why}</p>
            {open === c.id ? (
              <div>
                <p style={{ margin: '4px 0' }}><b>How:</b> {c.how}</p>
                {c.queries.length ? (
                  <div>
                    <div className='sub'>Google searches that find prospects</div>
                    {c.queries.map((q) => (
                      <div key={q} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '3px 0' }}>
                        <code style={{ fontSize: 12.5, wordBreak: 'break-word' }}>{q}</code>
                        <a className='sub' href={'https://www.google.com/search?q=' + encodeURIComponent(q)} target='_blank' rel='noopener noreferrer'>Search</a>
                        <Copy text={q} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      <h3 className='prg-h'>One page worth linking to <span className='sub'>ideas for {plan.noun}</span></h3>
      <ul>{plan.ideas.map((x) => <li key={x}>{x}</li>)}</ul>

      <h3 className='prg-h'>Outreach templates</h3>
      {plan.templates.map((t) => (
        <details key={t.name} style={{ margin: '6px 0' }}>
          <summary><b>{t.name}</b></summary>
          <p className='sub' style={{ margin: '4px 0' }}>Subject: {t.subject}</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '4px 0' }}>{t.body}</pre>
          <Copy text={'Subject: ' + t.subject + '\n\n' + t.body} label='Copy email' />
        </details>
      ))}

      <h3 className='prg-h'>Avoid</h3>
      <ul>{plan.avoid.map((x) => <li key={x}>{x}</li>)}</ul>

      <h3 className='prg-h'>How to measure it</h3>
      <ul>{plan.measure.map((x) => <li key={x}>{x}</li>)}</ul>
      <p className='sub'>Links take weeks to count. Nothing here can promise a ranking; it builds the signals Google looks for.</p>
    </section>
  );
}
