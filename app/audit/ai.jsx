'use client';

import { useState } from 'react';

// "Found by AI assistants": how ready the site is to be read and cited by
// ChatGPT, Claude, Perplexity, Google AI and Copilot, and which crawlers it
// lets in or turns away. All from audit.site.ai (see lib/audit/aeo.js).

const ROLE = { search: 'Search bots', user: 'Asked by a person', training: 'Model training' };
const VERDICT = {
  allowed: ['Allowed', 'g'], partly: ['Partly blocked', 'y'], blocked: ['Blocked', 'r'], unknown: ['Not stated', ''],
};
const colOf = (v) => (v >= 75 ? '#15803d' : v >= 50 ? '#b45309' : '#b91c1c');
const GRADE = (v) => (v >= 80 ? 'Well prepared' : v >= 60 ? 'Partly ready' : v >= 35 ? 'Needs work' : 'Largely invisible to AI');

/** Extra facts the fix snippets are filled in with. */
export function aiCtx(audit, base) {
  const site = audit?.site || {};
  const title = site.pages?.[0]?.title || site.title || '';
  const brand = (title.split(/\s*[|–—]\s*|\s+-\s+|:\s+/)[0] || '').trim();
  return {
    ...base,
    title,
    brand: brand || base.host,
    description: site.pages?.[0]?.description || site.description || '',
    pages: (site.pages || []).filter((p) => p.status === 'done').map((p) => ({ url: p.url, path: p.path, title: p.title })),
    sameAs: site.ai?.same_as || [],
    qa: site.ai?.signals?.qa_samples || [],
  };
}

const ASKERS = [
  ['ChatGPT', (q) => 'https://chatgpt.com/?q=' + encodeURIComponent(q)],
  ['Perplexity', (q) => 'https://www.perplexity.ai/search?q=' + encodeURIComponent(q)],
  ['Claude', (q) => 'https://claude.ai/new?q=' + encodeURIComponent(q)],
  ['Copilot', (q) => 'https://copilot.microsoft.com/?q=' + encodeURIComponent(q)],
  ['Google AI', (q) => 'https://www.google.com/search?udm=50&q=' + encodeURIComponent(q)],
];

function BotTable({ bots }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr><th>Assistant</th><th>robots.txt says</th><th>Firewall lets it in</th></tr></thead>
        <tbody>
          {bots.map((b) => {
            const [t, tone] = VERDICT[b.robots] || VERDICT.unknown;
            const live = b.live == null ? null : b.reachable ? ['Reached the page', 'g'] : ['Turned away' + (b.status ? ' (' + b.status + ')' : ''), 'r'];
            return (
              <tr key={b.name}>
                <td className='iss'><b>{b.name}</b><span>{b.vendor}</span></td>
                <td><span className={'zpill ' + tone}>{t}</span></td>
                <td>{live ? <span className={'zpill ' + live[1]}>{live[0]}</span> : <span className='sub'>Not tested</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AICard({ audit, items, copy }) {
  const ai = audit.site?.ai;
  const [q, setQ] = useState('');
  if (!ai) return null;
  const ctx = aiCtx(audit, { host: '', url: audit.url });
  const bots = ai.bots || [];
  const cite = bots.filter((b) => b.role !== 'training');
  const training = bots.filter((b) => b.role === 'training');
  const blockedCite = cite.filter((b) => b.robots === 'blocked' || b.live === true && !b.reachable);
  const scrapers = ai.scrapers || [];
  const letIn = scrapers.filter((s) => s.result === 'allowed');
  const fixes = (items || []).filter((it) => it.category === 'AI visibility');
  const query = q || (ai.prompts?.category ? 'Best ' + ai.prompts.category : '');
  const brand = ctx.brand;
  const questions = [
    query && ['Find you by what you do', query],
    brand && ['Check what it knows about you', 'What is ' + brand + ' and is it any good?'],
    brand && ['Reviews', 'Reviews of ' + brand + ' ' + (audit.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '')],
  ].filter(Boolean);
  const llms = fixes.find((f) => f.key === 'check:no-llms-txt');

  return (
    <section id='ai' className='zcard pad'>
      <div className='sechead'>
        <div>
          <h2>Found by AI assistants</h2>
          <div className='sub'>How ready the site is to be read and quoted by ChatGPT, Claude, Perplexity, Google AI and Copilot (AEO, GEO and citations), and who is let in or kept out.</div>
        </div>
        <div className='prg-pct'><b style={{ color: colOf(ai.score) }}>{ai.score}</b><span>{GRADE(ai.score)}</span></div>
      </div>

      <div className='bars'>
        {Object.values(ai.parts || {}).map((p) => {
          const v = Math.round((p.got / p.of) * 100);
          return (
            <div className='bar' key={p.label}>
              <div className='l'><span>{p.label}</span><span>{p.got} / {p.of}</span></div>
              <div className='t'><i style={{ width: v + '%', background: colOf(v) }} /></div>
            </div>
          );
        })}
      </div>

      <h3 className='prg-h'>Assistants that can send you customers <span className='sub'>{cite.length - blockedCite.length} of {cite.length} can read the site</span></h3>
      {ai.baseline && !ai.baseline.ok ? <p className='sub'>The site did not answer an ordinary browser test reliably, so the bot results below may be unreliable.</p> : null}
      <BotTable bots={cite} />
      <p className='sub' style={{ marginTop: 8 }}>These are the bots that look pages up to answer a question, so being blocked here costs you mentions. {blockedCite.length ? 'Blocked right now: ' + blockedCite.map((b) => b.name).join(', ') + '.' : 'None of them are blocked.'}</p>

      <h3 className='prg-h'>Model-training crawlers <span className='sub'>your choice</span></h3>
      <BotTable bots={training} />
      <p className='sub' style={{ marginTop: 8 }}>Blocking these keeps your pages out of future model training. It does not stop you being cited by the search bots above.</p>

      <h3 className='prg-h'>Scrapers and unknown bots <span className='sub'>{letIn.length} of {scrapers.length} got in</span></h3>
      {scrapers.length ? (
        <div className='pills'>
          {scrapers.map((s) => <span key={s.name} className={'zpill ' + (s.result === 'allowed' ? 'y' : 'g')}>{s.name}: {s.result === 'allowed' ? 'got in' : 'blocked' + (s.status ? ' (' + s.status + ')' : '')}</span>)}
        </div>
      ) : null}
      <p className='sub' style={{ marginTop: 8 }}>
        {letIn.length ? 'Generic scraping tools can read the site freely, so listings and text can be copied in bulk.' : 'Generic scraping tools are turned away.'}
        {' '}This test only changes the name a request carries. Real bots are verified by network address, so it shows what your firewall does with the name, not a guarantee.
      </p>

      <h3 className='prg-h'>What the site gives AI to work with</h3>
      <div className='pills'>
        {[['Business facts (JSON-LD)', ai.schema_types?.length], ['llms.txt', ai.llms_txt], ['FAQ markup', ai.signals?.faq], ['Question headings', ai.signals?.qa], ['Direct answers', ai.signals?.direct_answers], ['Author or date', ai.signals?.byline || ai.signals?.dates], ['Phone and address', ai.signals?.phone && ai.signals?.address], ['Profile links', ai.same_as?.length]].map(([n, ok]) => (
          <span key={n} className={'zpill ' + (ok ? 'g' : 'r')}>{ok ? '✓' : '✗'} {n}</span>
        ))}
        {(ai.schema_types || []).slice(0, 6).map((t) => <span key={t} className='zpill'>{t}</span>)}
      </div>

      <h3 className='prg-h'>How to get cited more</h3>
      {fixes.length ? (
        <ol className='prg-log'>
          {fixes.map((f) => (
            <li key={f.key}><span><a href={'#fix-' + (f.n ?? f.key)}>{f.title}</a>{f.why ? ' — ' + String(f.why).slice(0, 140) : ''}</span></li>
          ))}
        </ol>
      ) : <p className='sub'>No gaps found. Keep the key pages current and answer real customer questions in plain words.</p>}

      <h3 className='prg-h'>Try it in the assistants</h3>
      <p className='sub'>Ask the question a customer would. If you are not named, that is the gap to close.</p>
      <label className='sub' style={{ display: 'block', margin: '8px 0' }}>
        What would a customer search for?{' '}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={query || 'e.g. best plots near Chikmagalur'} style={{ padding: '6px 10px', border: '1px solid var(--line, #ddd)', borderRadius: 8, minWidth: 260 }} />
      </label>
      <div style={{ display: 'grid', gap: 10 }}>
        {questions.map(([why, text]) => (
          <div key={text} className='zcard' style={{ padding: 12 }}>
            <div className='sub'>{why}</div>
            <b>{text}</b>
            <div className='pills'>
              {ASKERS.map(([n, mk]) => <a key={n} className='btn sm' href={mk(text)} target='_blank' rel='noopener noreferrer'>{n} ↗</a>)}
            </div>
          </div>
        ))}
      </div>
      {llms && copy ? <p className='sub' style={{ marginTop: 12 }}>A ready-made llms.txt is in <a href={'#fix-' + (llms.n ?? llms.key)}>this fix</a>.</p> : null}
    </section>
  );
}

/** The client-facing version for the shared report. */
export function AIReport({ ai }) {
  if (!ai) return null;
  const cite = (ai.bots || []).filter((b) => b.role !== 'training');
  const blocked = cite.filter((b) => b.robots === 'blocked' || (b.live === true && !b.reachable));
  const col = colOf(ai.score);
  return (
    <div id='r-ai' style={{ marginTop: 28 }}>
      <h2>Being found by AI assistants</h2>
      <p>When people ask ChatGPT, Perplexity, Claude or Google&apos;s AI for a recommendation, these tools pick a few sites to quote. Your readiness score: <b style={{ color: col }}>{ai.score} / 100</b> ({GRADE(ai.score)}).</p>
      <p>{blocked.length ? 'Currently turned away: ' + blocked.map((b) => b.name).join(', ') + '. Until that changes they cannot mention you.' : 'The main AI search assistants can read your site.'}</p>
      <div className='pills'>
        {cite.map((b) => {
          const bad = b.robots === 'blocked' || (b.live === true && !b.reachable);
          return <span key={b.name} className={'zpill ' + (bad ? 'r' : 'g')}>{bad ? '✗' : '✓'} {b.name}</span>;
        })}
      </div>
    </div>
  );
}
