'use client';

import { useEffect, useMemo, useState } from 'react';
import { SECTIONS as SECTION_ORDER } from '@/lib/taxonomy';
import './index.css';

// The library home, "Index" layout: a sticky toolbar, one row per saved item,
// and a row that opens in place with every action that makes sense for it.
// All data and behaviour stays in page.jsx; this file only presents it, so
// nothing about saving, searching or filtering can drift.

const TYPES = [
  ['library', 'Libraries'],
  ['reference', 'References'],
  ['mcp-server', 'MCP & skills'],
  ['app', 'Apps'],
  ['template', 'Templates'],
];
const TYPE_LABEL = {
  library: 'Library', template: 'Template', app: 'App', saas: 'SaaS', cli: 'CLI', 'mcp-server': 'MCP / skill',
  reference: 'Reference', article: 'Article', dataset: 'Dataset', other: 'Other',
};
const PRICE = { 'open-source': 'Open source', free: 'Free', freemium: 'Freemium', paid: 'Paid', unknown: '' };

const label = (s) => (s === 'cta' || s === 'faq' ? s.toUpperCase() : String(s || '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const fmtNum = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600 * 20) return 'today';
  const d = Math.round(s / 86400);
  if (d < 7) return d + 'd';
  if (d < 60) return Math.round(d / 7) + 'w';
  return Math.round(d / 30) + 'mo';
}

const TONES = ['#DCD6C8', '#D0D6CE', '#D8CECD', '#CDD2D8', '#DDD5C1', '#D2CBD4'];
const tone = (n) => TONES[[...String(n)].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

function Thumb({ link, big }) {
  const [bad, setBad] = useState(false);
  const src = big ? link.image || link.favicon : link.favicon || link.image;
  const init = String(link.title || link.domain || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2);
  return (
    <span className={big ? 'ix-big' : 'ix-th'} style={{ background: tone(link.title || link.domain) }}>
      <span className='ix-mono'>{init}</span>
      {src && !bad ? <img src={src} alt='' loading='lazy' referrerPolicy='no-referrer' onError={() => setBad(true)} /> : null}
    </span>
  );
}

function Row({ link, open, current, onToggle, a }) {
  const working = link.status === 'pending' || link.status === 'enriching';
  const price = PRICE[link.pricing] || '';
  const free = link.pricing === 'free' || link.pricing === 'open-source' || link.is_open_source;
  const helps = (link.use_cases || [])[0];
  return (
    <>
      <tr
        className={'ix-r' + (current ? ' cur' : '') + (open ? ' open' : '')}
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onToggle(); } }}
      >
        <td>
          <div className='ix-nmc'>
            <Thumb link={link} />
            <div>
              <div className='ix-nm'>{link.title || link.domain || 'Untitled'}</div>
              <div className='ix-u'>{link.domain}</div>
            </div>
          </div>
        </td>
        <td className='ix-sum'>{working ? <span className='ix-work'>Reading this link…</span> : link.summary || link.description || ''}</td>
        <td><span className='ix-tag'>{TYPE_LABEL[link.type] || link.category || 'Link'}</span></td>
        <td className={'ix-pr' + (free ? ' f' : '')}>{link.is_open_source ? 'Open source' : price}{link.repo_stars != null ? <span className='ix-st'> {fmtNum(link.repo_stars)}★</span> : null}</td>
        <td className='ix-dt'>{link.status === 'error' || link.dead ? <span className='ix-bad'>{link.dead ? 'broken' : 'failed'}</span> : ago(link.created_at)}</td>
      </tr>
      {open ? (
        <tr className='ix-x'>
          <td colSpan={5}>
            <div className='ix-det'>
              <Thumb link={link} big />
              <div className='ix-body'>
                <h3>{link.title || link.domain}</h3>
                <p>{link.summary || link.description}</p>
                {helps ? <p className='ix-helps'>{helps}</p> : null}
                {link.avoid_when ? <p className='ix-avoid'><b>Skip it if</b> {link.avoid_when}</p> : null}
                {link.install ? (
                  <div className='ix-code'><code>{link.install}</code><button type='button' onClick={(e) => { e.stopPropagation(); a.copy(link.install, 'Install command copied'); }}>Copy</button></div>
                ) : null}
                {(link.sections || []).length || (link.tags || []).length ? (
                  <div className='ix-chips'>
                    {(link.sections || []).slice(0, 5).map((s) => (
                      <button key={'s' + s} type='button' className='ix-chip sec' onClick={(e) => { e.stopPropagation(); a.section(s); }} title={'Show everything for the ' + label(s)}>{label(s)}</button>
                    ))}
                    {(link.tags || []).slice(0, 5).map((t) => (
                      <button key={'t' + t} type='button' className='ix-chip' onClick={(e) => { e.stopPropagation(); a.tag(t); }} title={'Filter by ' + t}>#{t}</button>
                    ))}
                  </div>
                ) : null}
                {(link.collections || []).length ? <p className='ix-u' style={{ marginTop: 10 }}>In projects: {link.collections.join(', ')}</p> : null}
              </div>
              <div className='ix-acts'>
                <a className='p' href={link.url} target='_blank' rel='noopener noreferrer' onClick={(e) => e.stopPropagation()}>Open ↗</a>
                <button type='button' onClick={(e) => { e.stopPropagation(); a.details(link.id); }}>Details &amp; projects</button>
                <button type='button' onClick={(e) => { e.stopPropagation(); a.copy(link.url, 'Link copied'); }}>Copy link</button>
                <button type='button' onClick={(e) => { e.stopPropagation(); a.copy(a.forAgent(link), 'Copied for your agent'); }}>Copy for agent</button>
                <button type='button' className={link.starred ? 'on' : ''} onClick={(e) => { e.stopPropagation(); a.star(link); }}>{link.starred ? '★ Starred' : '☆ Star'}</button>
                <button type='button' onClick={(e) => { e.stopPropagation(); a.ask(link.title || link.domain); }}>Ask Stash</button>
                <a href={'/audit?url=' + encodeURIComponent(link.url)} onClick={(e) => e.stopPropagation()}>Audit this site</a>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function IndexHome(p) {
  const { items, total, facets, filters, query, input, setInput, isUrl, saving, busy, dbError, recents, omniRef } = p;
  const [openId, setOpenId] = useState(null);
  const [cur, setCur] = useState(0);
  const [showRefine, setShowRefine] = useState(true);

  const typeCount = (k) => (facets.types || []).find((t) => t.name === k)?.count;
  const phases = (facets.stages || []).filter((s) => s.count > 0);
  const sections = SECTION_ORDER.map((k) => (facets.sections || []).find((s) => s.name === k)).filter(Boolean);

  // Keyboard: arrows move, Enter opens, as long as you are not typing.
  useEffect(() => {
    const onKey = (e) => {
      const t = document.activeElement;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); omniRef.current && omniRef.current.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setCur((c) => Math.min(c + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); }
      else if (e.key === 'Enter' && t === document.body && items[cur]) { setOpenId((o) => (o === items[cur].id ? null : items[cur].id)); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [items, cur, omniRef]);
  useEffect(() => { setCur(0); setOpenId(null); }, [query, filters]);

  const actions = useMemo(() => ({
    copy: p.onCopyText,
    details: p.onDetails,
    star: p.onStar,
    ask: p.onAsk,
    tag: p.onTag,
    section: (s) => p.onPatch({ section: s }),
    forAgent: (l) => [
      l.title + ' — ' + l.url,
      l.summary || '',
      l.install ? 'Install: ' + l.install : '',
      l.quickstart ? 'Quickstart:\n' + l.quickstart : '',
      l.avoid_when ? 'Skip it if: ' + l.avoid_when : '',
    ].filter(Boolean).join('\n'),
  }), [p.onCopyText, p.onDetails, p.onStar, p.onAsk, p.onTag, p.onPatch]);

  const st = facets.stats;
  const anyFilter = filters.type || filters.stage || filters.section || filters.collection || filters.category || filters.starred || filters.oss || filters.status || filters.language || filters.tags.length;

  return (
    <div className='ix-wrap'>
      <div className='ix-bar'>
        <a className='ix-logo' href='/'>stash<i>.</i></a>
        <span className='ix-sp' />
        <button type='button' className='ix-btn' onClick={() => setShowRefine((v) => !v)} aria-pressed={showRefine}>Projects &amp; phases</button>
        <button type='button' className='ix-btn' onClick={p.onFilters}>Filters{p.activeFilterCount ? ' · ' + p.activeFilterCount : ''}</button>
        <button type='button' className='ix-btn' onClick={p.onMenu} aria-label='More'>More</button>
        <a className='ix-btn p' href='/audit'>Audit a site</a>
      </div>

      <section className='ix-hero'>
        <h1>What you’ve saved, <em>found in a second.</em></h1>
        <div className='ix-stats'>
          <button type='button' onClick={p.onClear}><b>{st.total}</b>saved</button>
          <button type='button' onClick={() => p.onPatch({ oss: !filters.oss })} aria-pressed={filters.oss}><b>{st.oss}</b>open source</button>
          <button type='button' onClick={() => p.onPatch({ starred: !filters.starred })} aria-pressed={filters.starred}><b>{st.starred}</b>starred</button>
          {st.errored ? <button type='button' onClick={() => p.onPatch({ status: filters.status === 'error' ? null : 'error' })} aria-pressed={filters.status === 'error'}><b>{st.errored}</b>need a look</button> : null}
        </div>
      </section>

      <div className='ix-tools'>
        <div className={'ix-s' + (isUrl ? ' url' : '')}>
          <svg width='15' height='15' viewBox='0 0 24 24' aria-hidden='true'><circle cx='11' cy='11' r='7' /><path d='M20 20l-4-4' /></svg>
          <input
            ref={omniRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); p.onSubmit(); } }}
            placeholder='Describe what you need, or paste a link to save it'
            aria-label='Search your library, or paste a link to save'
            autoComplete='off' autoCapitalize='off' autoCorrect='off' spellCheck={false}
          />
          {input ? <button type='button' className='ix-clr' onClick={() => { setInput(''); p.onClearQuery(); }} aria-label='Clear search'>✕</button> : <kbd>/</kbd>}
        </div>
        {isUrl || saving ? <button type='button' className='ix-btn p' onClick={p.onSubmit} disabled={saving}>{saving ? 'Saving…' : 'Save link'}</button> : null}
        {isUrl && !saving ? <a className='ix-btn' href={'/audit?url=' + encodeURIComponent(input.trim())}>Audit this site</a> : null}
        <div className='ix-seg' role='group' aria-label='Type'>
          <button type='button' aria-pressed={!filters.type} onClick={() => p.onPatch({ type: null })}>All</button>
          {TYPES.map(([k, l]) => (
            <button key={k} type='button' aria-pressed={filters.type === k} onClick={() => p.onPatch({ type: filters.type === k ? null : k })}>
              {l}{typeCount(k) != null ? <sup>{typeCount(k)}</sup> : null}
            </button>
          ))}
        </div>
      </div>

      {!input && !query && recents.length > 0 ? (
        <div className='ix-recents'>
          <span>Recent</span>
          {recents.map((r) => <button key={r} type='button' onClick={() => p.onRecent(r)}>{r}</button>)}
          <button type='button' className='quiet' onClick={p.onClearRecents}>clear</button>
        </div>
      ) : null}

      {showRefine ? (
        <div className='ix-refine'>
          {phases.length ? (
            <div className='ix-rail'>
              <span>Build phase</span>
              {phases.map((s) => (
                <button key={s.key} type='button' title={s.hint} aria-pressed={filters.stage === s.key} onClick={() => p.onPatch({ stage: filters.stage === s.key ? null : s.key, category: null })}>{s.label}<sup>{s.count}</sup></button>
              ))}
            </div>
          ) : null}
          {sections.length ? (
            <div className='ix-rail'>
              <span>Page section</span>
              {sections.map((s) => (
                <button key={s.name} type='button' aria-pressed={filters.section === s.name} onClick={() => p.onPatch({ section: filters.section === s.name ? null : s.name })}>{label(s.name)}<sup>{s.count}</sup></button>
              ))}
            </div>
          ) : null}
          {(facets.collections || []).length ? (
            <div className='ix-rail'>
              <span>Projects</span>
              {facets.collections.map((c) => (
                <button key={c.name} type='button' aria-pressed={filters.collection === c.name} onClick={() => p.onPatch({ collection: filters.collection === c.name ? null : c.name })}>{c.name}<sup>{c.count}</sup></button>
              ))}
            </div>
          ) : null}
          {(facets.categories || []).length ? (
            <div className='ix-rail'>
              <span>Category</span>
              {facets.categories.slice(0, 14).map((c) => (
                <button key={c.name} type='button' aria-pressed={filters.category === c.name} onClick={() => p.onPatch({ category: filters.category === c.name ? null : c.name, stage: null })}>{c.name}<sup>{c.count}</sup></button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {p.children}

      <div className='ix-head'>
        <div><b>{p.crumb}</b><span>{total}</span>{anyFilter ? <button type='button' className='ix-reset' onClick={p.onClear}>Clear filters</button> : null}</div>
        <select value={p.sort} onChange={(e) => p.onSort(e.target.value)} aria-label='Sort'>
          <option value='newest'>Newest</option>
          <option value='oldest'>Oldest</option>
          <option value='stars'>Most stars</option>
          <option value='title'>A to Z</option>
        </select>
      </div>

      <div className='ix-scroll'>
        <table className='ix-table'>
          <thead><tr><th>Name</th><th>What it does</th><th>Type</th><th>Price</th><th style={{ textAlign: 'right' }}>Saved</th></tr></thead>
          <tbody>
            {items.map((l, i) => (
              <Row key={l.id} link={l} current={i === cur} open={openId === l.id} a={actions}
                onToggle={() => { setCur(i); setOpenId((o) => (o === l.id ? null : l.id)); }} />
            ))}
          </tbody>
        </table>
      </div>

      {!busy && items.length === 0 && !dbError ? (
        <div className='ix-empty'>
          {query ? (
            <>
              <b>Nothing matches that</b>
              <p>Describe the job, not the name. Try “record my screen as a gif” or “add login to a side project”.</p>
              <button type='button' className='ix-btn p' onClick={() => p.onAsk(query)}>Ask Stash about “{query.length > 28 ? query.slice(0, 28) + '…' : query}”</button>
            </>
          ) : anyFilter ? (
            <><b>Nothing here yet</b><p>Clear a filter, or save something new.</p><button type='button' className='ix-btn' onClick={p.onClear}>Clear filters</button></>
          ) : (
            <><b>Your stash is empty</b><p>Paste a link above, or share one from any app. It gets read, summarised and filed on its own.</p><button type='button' className='ix-btn p' onClick={p.onPaste}>Paste from clipboard</button></>
          )}
        </div>
      ) : null}

      {items.length < total ? (
        <div className='ix-more'><button type='button' className='ix-btn' onClick={p.onMore}>Show 40 more <span>({items.length} of {total})</span></button></div>
      ) : null}

      <div className='ix-foot'>↑ ↓ to move · Enter to open a row · / to search · ⌘K to jump to search</div>
    </div>
  );
}
