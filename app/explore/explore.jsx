'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookmarkIcon, CloseIcon, LockIcon, SearchIcon } from '../_ui/icons';
import CodeBox from '../_ui/CodeBox';

const TYPES = [
  ['mcp-server', 'MCP servers'],
  ['library', 'Libraries'],
  ['saas', 'SaaS'],
  ['app', 'Apps'],
  ['template', 'Templates'],
  ['cli', 'CLIs'],
  ['reference', 'References'],
  ['article', 'Articles'],
];
const KIND = {
  'mcp-server': 'MCP server', library: 'Library', saas: 'SaaS', app: 'App', template: 'Template',
  cli: 'CLI', reference: 'Reference', article: 'Article', dataset: 'Dataset', other: 'Other',
};
const PRICE = { 'open-source': 'Open source', free: 'Free', freemium: 'Freemium', paid: 'Paid' };
const PAGE = 24;

const initials = (t) => String(t || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?';

function Fav({ item }) {
  const [bad, setBad] = useState(false);
  return (
    <span className='k-fav' aria-hidden='true'>
      {initials(item.title)}
      {item.favicon && !bad ? <img src={item.favicon} alt='' loading='lazy' referrerPolicy='no-referrer' onError={() => setBad(true)} /> : null}
    </span>
  );
}

export default function Explore({ signedIn, initial }) {
  const [input, setInput] = useState(initial.q);
  const [q, setQ] = useState(initial.q);
  const [toolkit, setToolkit] = useState(initial.toolkit);
  const [type, setType] = useState(initial.type);
  const [saved, setSaved] = useState(initial.saved);
  const [sort, setSort] = useState('newest');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [overview, setOverview] = useState(null);
  const [openId, setOpenId] = useState(initial.open);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);

  // Typing settles for a moment before it searches.
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 280);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    fetch('/api/catalog/overview').then((r) => r.json()).then(setOverview).catch(() => {});
  }, []);

  const query = useCallback((offset) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (toolkit) p.set('toolkit', toolkit);
    if (type) p.set('type', type);
    if (saved) p.set('saved', '1');
    if (!q) p.set('sort', sort);
    p.set('limit', String(PAGE));
    p.set('offset', String(offset));
    return p;
  }, [q, toolkit, type, saved, sort, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the address shareable: what you are looking at is in the URL.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (toolkit) p.set('toolkit', toolkit);
    if (type) p.set('type', type);
    if (saved) p.set('saved', '1');
    if (openId) p.set('open', String(openId));
    const next = '/explore' + (p.toString() ? '?' + p : '');
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [q, toolkit, type, saved, openId]);

  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    fetch('/api/catalog?' + query(0))
      .then(async (r) => {
        const j = await r.json();
        if (n !== seq.current) return;
        if (!r.ok) throw new Error(j.error || 'The catalogue did not load.');
        setItems(j.items || []);
        setTotal(j.total || 0);
        setError(null);
      })
      .catch((e) => { if (n === seq.current) setError(e.message); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [query]);

  const more = async () => {
    const r = await fetch('/api/catalog?' + query(items.length));
    const j = await r.json();
    if (r.ok) setItems((cur) => [...cur, ...(j.items || [])]);
  };

  const toggleSave = async (item) => {
    const next = !item.saved;
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, saved: next } : i)));
    const res = next
      ? await fetch('/api/saves', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ link_id: item.id }) })
      : await fetch('/api/saves?link_id=' + item.id, { method: 'DELETE' });
    if (!res.ok) setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, saved: !next } : i)));
    if (saved && !next) setItems((cur) => cur.filter((i) => i.id !== item.id));
  };

  const pick = (key) => { setSaved(false); setToolkit(key); };
  const heading = saved
    ? 'Your saved tools'
    : toolkit
      ? overview?.toolkits.find((t) => t.key === toolkit)?.label || 'Toolkit'
      : 'Everything in the catalogue';

  return (
    <div className='k-explore'>
      <aside className='k-rail'>
        <div>
          <h2>Toolkits</h2>
          <div className='k-rail-list'>
            <button type='button' className='k-rail-item' aria-pressed={!toolkit && !saved} onClick={() => pick(null)}>
              <span>All</span><span>{overview?.total ?? ''}</span>
            </button>
            {(overview?.toolkits || []).map((t) => (
              <button key={t.key} type='button' className='k-rail-item' aria-pressed={toolkit === t.key && !saved} onClick={() => pick(t.key)}>
                <span>{t.label}</span><span>{t.count}</span>
              </button>
            ))}
            {signedIn ? (
              <button type='button' className='k-rail-item' aria-pressed={saved} onClick={() => { setSaved(true); setToolkit(null); }}>
                <span>Saved</span><span />
              </button>
            ) : null}
          </div>
        </div>
        {!signedIn ? (
          <div className='k-lockbox'>
            <span className='k-lock'><LockIcon /> {overview ? overview.premium + ' entries are members-only' : 'Some entries are members-only'}</span>
            <span className='k-small k-muted'>Sign in with Google to open them and connect your agent.</span>
            <Link className='k-btn k-btn-brass k-btn-sm' href={'/login?next=/explore'}>Sign in</Link>
          </div>
        ) : null}
      </aside>

      <section aria-labelledby='k-results-h'>
        <div className='k-search'>
          <SearchIcon />
          <label className='k-sr' htmlFor='k-q'>Search the catalogue</label>
          <input
            id='k-q'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Describe what you are building, for example "auth for a Next.js app"'
            autoComplete='off'
          />
        </div>

        <div className='k-filters' role='group' aria-label='Kind'>
          <button type='button' className='k-chip' aria-pressed={!type} onClick={() => setType(null)}>All kinds</button>
          {TYPES.map(([k, label]) => (
            <button key={k} type='button' className='k-chip' aria-pressed={type === k} onClick={() => setType(type === k ? null : k)}>{label}</button>
          ))}
          {!q ? (
            <select aria-label='Sort' value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value='newest'>Newest</option>
              <option value='title'>A to Z</option>
              <option value='stars'>Most GitHub stars</option>
              <option value='oldest'>Oldest</option>
            </select>
          ) : null}
        </div>

        <h1 id='k-results-h' className='k-h3' style={{ marginTop: 24 }}>{heading}</h1>
        <p className='k-count' aria-live='polite'>
          {loading ? 'Loading' : q ? 'Best matches for "' + q + '"' : total + ' entries'}
        </p>

        {error ? (
          <div className='k-empty'><p className='k-error'>{error}</p><button className='k-btn k-btn-sm' onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>
        ) : loading && !items.length ? (
          <div aria-hidden='true'>{[0, 1, 2, 3, 4].map((i) => <div key={i} className='k-skel' />)}</div>
        ) : !items.length ? (
          <div className='k-empty'>
            {saved ? (
              <>
                <p style={{ margin: 0 }}>Nothing saved yet. Use the bookmark on any entry to keep it here.</p>
                <button className='k-btn k-btn-sm' onClick={() => setSaved(false)}>Browse the catalogue</button>
              </>
            ) : (
              <>
                <p style={{ margin: 0 }}>Nothing matches that yet. Try describing the job instead of a product name.</p>
                <button className='k-btn k-btn-sm' onClick={() => { setInput(''); setType(null); setToolkit(null); }}>Clear search and filters</button>
              </>
            )}
          </div>
        ) : (
          <ul className='k-list'>
            {items.map((item) => (
              <li
                key={item.id}
                className={'k-row' + (item.locked ? ' k-row-locked' : '')}
                aria-current={openId === item.id ? 'true' : undefined}
                onClick={() => setOpenId(item.id)}
              >
                <Fav item={item} />
                <div style={{ minWidth: 0 }}>
                  <div className='k-row-title'>
                    <b><button type='button' onClick={(e) => { e.stopPropagation(); setOpenId(item.id); }} style={{ all: 'unset', cursor: 'pointer' }}>{item.title}</button></b>
                    <span className='k-row-kind'>{KIND[item.type] || item.category}</span>
                    {item.locked ? <span className='k-lock'><LockIcon size={12} /> Members only</span> : null}
                    {!item.locked && (item.is_open_source || item.pricing === 'free') ? (
                      <span className='k-tag-free'>{item.is_open_source ? 'Open source' : 'Free'}</span>
                    ) : null}
                  </div>
                  <p className='k-row-sum'>
                    {item.locked ? 'Sign in to see what it does, how to install it and when to skip it.' : item.summary || item.description}
                  </p>
                </div>
                {signedIn && !item.locked ? (
                  <button
                    type='button'
                    className='k-save'
                    aria-pressed={!!item.saved}
                    aria-label={item.saved ? 'Remove ' + item.title + ' from saved' : 'Save ' + item.title}
                    onClick={(e) => { e.stopPropagation(); toggleSave(item); }}
                  >
                    <BookmarkIcon filled={item.saved} />
                  </button>
                ) : <span />}
              </li>
            ))}
          </ul>
        )}

        {items.length && items.length < total ? (
          <div className='k-more'><button className='k-btn' onClick={more}>Show more</button></div>
        ) : null}
      </section>

      {openId ? (
        <Detail
          id={openId}
          signedIn={signedIn}
          onClose={() => setOpenId(null)}
          onSaved={(id, value) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, saved: value } : i)))}
        />
      ) : null}
    </div>
  );
}

function Detail({ id, signedIn, onClose, onSaved }) {
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    setLink(null);
    fetch('/api/catalog/' + id)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Could not open this entry.');
        setLink(j.link);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    const next = !link.saved;
    setLink({ ...link, saved: next });
    const res = next
      ? await fetch('/api/saves', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ link_id: link.id }) })
      : await fetch('/api/saves?link_id=' + link.id, { method: 'DELETE' });
    if (res.ok) onSaved(link.id, next);
    else setLink({ ...link, saved: !next });
  };

  const facts = link && !link.locked
    ? [
        ['Pricing', PRICE[link.pricing] || null],
        ['Licence', link.repo_license],
        ['Language', link.repo_language],
        ['GitHub stars', link.repo_stars != null ? Number(link.repo_stars).toLocaleString() : null],
        ['Setup effort', link.integration_effort && link.integration_effort !== 'unknown' ? link.integration_effort.replace(/-/g, ' ') : null],
        ['Maturity', link.maturity && link.maturity !== 'unknown' ? link.maturity : null],
      ].filter(([, v]) => v)
    : [];

  return (
    <>
      <div className='k-scrim' onClick={onClose} />
      <aside className='k-sheet' role='dialog' aria-modal='true' aria-label={link?.title || 'Entry details'}>
        <div className='k-sheet-head'>
          <span className='k-dim k-small'>{link ? KIND[link.type] || link.category : ''}</span>
          <button ref={closeRef} type='button' className='k-x' onClick={onClose} aria-label='Close'><CloseIcon /></button>
        </div>
        <div className='k-sheet-body'>
          {error ? <p className='k-error'>{error}</p> : !link ? <p className='k-muted'>Opening</p> : (
            <>
              <div className='k-d-title'>
                <Fav item={link} />
                <div>
                  <h2>{link.title}</h2>
                  {link.domain ? <span className='k-dim k-small'>{link.domain}</span> : null}
                </div>
              </div>

              {link.locked ? (
                <div className='k-lockbox'>
                  <span className='k-lock'><LockIcon /> Members only</span>
                  <p style={{ margin: 0 }}>
                    This {KIND[link.type]?.toLowerCase() || 'entry'} is one of the picks we keep for members. Sign in
                    with Google to see what it does, how to install it and when to skip it.
                  </p>
                  <Link className='k-btn k-btn-brass' href={'/login?next=' + encodeURIComponent('/explore?open=' + link.id)}>Sign in to open it</Link>
                </div>
              ) : (
                <>
                  {link.summary || link.description ? <p className='k-lede' style={{ color: 'var(--paper)' }}>{link.summary || link.description}</p> : null}

                  <div className='k-d-actions'>
                    <a className='k-btn k-btn-brass' href={link.url} target='_blank' rel='noopener noreferrer'>Visit {link.domain || 'site'}</a>
                    {signedIn ? (
                      <button type='button' className='k-btn' aria-pressed={!!link.saved} onClick={save}>
                        <BookmarkIcon filled={link.saved} size={16} /> {link.saved ? 'Saved' : 'Save'}
                      </button>
                    ) : null}
                  </div>

                  {link.use_cases?.length ? (
                    <div className='k-d-sec'>
                      <h3>Use it for</h3>
                      <ul>{link.use_cases.slice(0, 5).map((u) => <li key={u}>{u}</li>)}</ul>
                    </div>
                  ) : null}

                  {link.install ? (
                    <div className='k-d-sec'>
                      <h3>Install</h3>
                      <CodeBox text={link.install} />
                    </div>
                  ) : null}

                  {link.quickstart ? (
                    <div className='k-d-sec'>
                      <h3>Quickstart</h3>
                      <p className='k-muted' style={{ whiteSpace: 'pre-wrap' }}>{link.quickstart}</p>
                    </div>
                  ) : null}

                  {link.works_with?.length ? (
                    <div className='k-d-sec'>
                      <h3>Works with</h3>
                      <div className='k-pills'>{link.works_with.map((w) => <span key={w} className='k-pill'>{w}</span>)}</div>
                    </div>
                  ) : null}

                  {link.requires?.length ? (
                    <div className='k-d-sec'>
                      <h3>Needs</h3>
                      <div className='k-pills'>{link.requires.map((w) => <span key={w} className='k-pill'>{w}</span>)}</div>
                    </div>
                  ) : null}

                  {link.avoid_when ? (
                    <div className='k-d-sec'>
                      <h3>Skip it if</h3>
                      <p className='k-muted'>{link.avoid_when}</p>
                    </div>
                  ) : null}

                  {facts.length ? (
                    <dl className='k-facts'>
                      {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                    </dl>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
