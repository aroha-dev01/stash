'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TOOLKITS } from '@/lib/taxonomy';
import { PRO } from '@/lib/plans';
import EntryCard, { SkeletonCard } from '../_ui/EntryCard';
import { CloseIcon, LockIcon, SearchIcon, SparkIcon } from '../_ui/icons';
import GoogleButton from '../_ui/GoogleButton';
import { track } from '../_ui/track';
import EntryDetail from './EntryDetail';

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
const SORTS = [
  ['newest', 'Recently added'],
  ['title', 'A to Z'],
  ['stars', 'Most GitHub stars'],
  ['oldest', 'Oldest first'],
];
const SUGGEST = ['auth for a Next.js app', 'scroll animations', 'record the screen as a gif', 'agent workflows'];
const PAGE = 24;

function params({ q, toolkit, type, access, sort, saved }) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (toolkit) p.set('toolkit', toolkit);
  if (type) p.set('type', type);
  if (access) p.set('access', access);
  if (sort && sort !== 'newest' && !q) p.set('sort', sort);
  if (saved) p.set('saved', '1');
  return p;
}

export default function Explore({ signedIn, level, initial, initialPage, overview, featured, welcome }) {
  const [input, setInput] = useState(initial.q);
  const [q, setQ] = useState(initial.q);
  const [toolkit, setToolkit] = useState(initial.toolkit);
  const [type, setType] = useState(initial.type);
  const [access, setAccess] = useState(initial.access);
  const [sort, setSort] = useState(initial.sort);
  const [saved, setSaved] = useState(initial.saved);
  const [page, setPage] = useState(initialPage); // { items, total, hidden, locked } or null
  const [loading, setLoading] = useState(!initialPage);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(initial.open);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const first = useRef(!!initialPage);
  const opener = useRef(null);
  const pushed = useRef(false);

  const state = { q, toolkit, type, access, sort, saved };

  useEffect(() => { track('explore_opened', { level }); }, [level]);

  // Typing settles for a moment before it searches.
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => { if (q) track('search_submitted', { level }); }, [q, level]);

  // What you are looking at is in the address, so it can be shared. Filters
  // replace the entry; opening a detail pushes one, so Back closes it.
  useEffect(() => {
    const p = params(state);
    if (openId) p.set('open', String(openId));
    const next = '/explore' + (p.toString() ? '?' + p : '');
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', next);
  }, [q, toolkit, type, access, sort, saved, openId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPop = () => {
      const id = Number(new URLSearchParams(window.location.search).get('open')) || null;
      pushed.current = false;
      setOpenId(id);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const fetchPage = useCallback((offset) => {
    const p = params({ q, toolkit, type, access, sort, saved });
    p.set('limit', String(PAGE));
    p.set('offset', String(offset));
    return fetch('/api/catalog?' + p).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'The catalogue did not load.');
      return j;
    });
  }, [q, toolkit, type, access, sort, saved, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (first.current) { first.current = false; return; } // the server already rendered this page
    const n = ++seq.current;
    setLoading(true);
    fetchPage(0)
      .then((j) => { if (n === seq.current) { setPage(j); setError(null); } })
      .catch((e) => { if (n === seq.current) setError(e.message); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [fetchPage]);

  const loadMore = async () => {
    setMore(true);
    try {
      const j = await fetchPage(page.items.length);
      setPage((cur) => ({ ...cur, items: [...cur.items, ...(j.items || [])] }));
    } catch (e) {
      setError(e.message);
    } finally {
      setMore(false);
    }
  };

  const toggleSave = async (item) => {
    const next = !item.saved;
    const mark = (v) => setPage((cur) => cur && { ...cur, items: cur.items.map((i) => (i.id === item.id ? { ...i, saved: v } : i)) });
    mark(next);
    const res = next
      ? await fetch('/api/saves', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ link_id: item.id }) })
      : await fetch('/api/saves?link_id=' + item.id, { method: 'DELETE' });
    if (!res.ok) mark(!next);
    else if (saved && !next) setPage((cur) => ({ ...cur, items: cur.items.filter((i) => i.id !== item.id), total: cur.total - 1 }));
  };

  const open = (item) => {
    opener.current = document.activeElement;
    setOpenId(item.id);
    const p = params(state);
    p.set('open', String(item.id));
    window.history.pushState({ stashOpen: item.id }, '', '/explore?' + p);
    pushed.current = true;
    track('entry_opened', { from: 'explore' });
  };
  const close = useCallback(() => {
    if (pushed.current) window.history.back(); // popstate clears it
    else setOpenId(null);
    pushed.current = false;
    setTimeout(() => opener.current?.focus?.(), 0);
  }, []);

  const pickKit = (key) => {
    setSaved(false);
    setToolkit(key);
    if (key) track('category_selected', { toolkit: key });
    const kit = overview?.toolkits.find((t) => t.key === key);
    if (kit?.needs) track('premium_locked_clicked', { toolkit: key });
  };
  const clearAll = () => { setInput(''); setQ(''); setType(null); setToolkit(null); setAccess(null); setSaved(false); };

  const kit = overview?.toolkits.find((t) => t.key === toolkit);
  const typeCounts = new Map((overview?.types || []).map((t) => [t.name, t.count]));
  const browsing = !q && !toolkit && !type && !access && !saved;
  const heading = saved ? 'Your saved tools' : q ? 'Best matches' : kit ? kit.label : 'Everything in the library';
  const items = page?.items || [];
  const total = page?.total || 0;

  return (
    <>
      <header className='k-ex-head'>
        <span className='k-eyebrow'>Explore</span>
        <h1 className='k-h1'>Explore the library</h1>
        <p className='k-lede'>
          {level === 'free' && overview
            ? 'Start with ' + overview.levels.free + ' hand-picked skills and tools. Unlock the full library when you need more.'
            : 'Find skills, plugins, MCP servers and tools for the work you’re doing.'}
        </p>
        {overview ? <Allowance level={level} levels={overview.levels} /> : null}
        <form className='k-search' role='search' onSubmit={(e) => { e.preventDefault(); setQ(input.trim()); }}>
          <SearchIcon />
          <label className='k-sr' htmlFor='k-q'>Search the library</label>
          <input
            id='k-q'
            type='search'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Describe what you’re building or search by tool…'
            autoComplete='off'
            enterKeyHint='search'
          />
        </form>
        {browsing ? (
          <div className='k-suggest'>
            <span>Try</span>
            {SUGGEST.map((s) => <button key={s} type='button' className='k-chip' onClick={() => setInput(s)}>{s}</button>)}
          </div>
        ) : null}
        {welcome ? (
          <div className='k-welcome' role='status'>
            <div>
              <b>Welcome to Stash.</b>
              <p>Everything for members is open to you now. Next, connect your agent so it can search the library while you build.</p>
            </div>
            <Link className='k-btn k-btn-accent' href='/connect?welcome=1'>Connect your agent</Link>
          </div>
        ) : null}
      </header>

      {browsing && featured?.length ? (
        <section className='k-ex-feature' aria-labelledby='ex-feat-h'>
          <div className='k-ex-label'>
            <h2 id='ex-feat-h' className='k-h3'>Featured</h2>
            <span className='k-small k-dim'>Picked by the curator</span>
          </div>
          <div className='k-ex-feature-row'>
            {featured.map((item) => <EntryCard key={item.id} item={item} size='sm' onOpen={open} />)}
          </div>
        </section>
      ) : null}

      <nav className='k-kits' aria-label='Categories'>
        <button type='button' className='k-kit' aria-pressed={!toolkit && !saved} onClick={() => pickKit(null)}>
          All <small>{overview ? overview.open : ''}</small>
        </button>
        {(overview?.toolkits || TOOLKITS).map((t) => (
          <button key={t.key} type='button' className='k-kit' aria-pressed={toolkit === t.key && !saved} onClick={() => pickKit(t.key)}>
            {t.needs ? <LockIcon size={13} /> : null}
            {t.label}
            {t.needs ? <small>{PRO.name}</small> : t.open != null ? <small>{t.open}</small> : null}
          </button>
        ))}
        {signedIn ? (
          <button type='button' className='k-kit' aria-pressed={saved} onClick={() => { setSaved(true); setToolkit(null); }}>Saved</button>
        ) : null}
      </nav>

      <div className='k-filters' role='group' aria-label='Kind of entry'>
        <button type='button' className='k-chip' aria-pressed={!type} onClick={() => setType(null)}>All kinds</button>
        {TYPES.filter(([k]) => !overview || typeCounts.get(k)).map(([k, label]) => (
          <button key={k} type='button' className='k-chip' aria-pressed={type === k} onClick={() => setType(type === k ? null : k)}>{label}</button>
        ))}
        <span className='k-filters-sp' />
        {signedIn ? (
          <select className='k-select' aria-label='Access' value={access || ''} onChange={(e) => setAccess(e.target.value || null)}>
            <option value=''>Any access</option>
            <option value='public'>Public</option>
            <option value='free'>Members</option>
            {level === 'premium' || level === 'admin' ? <option value='premium'>{PRO.name}</option> : null}
          </select>
        ) : null}
        {!q ? (
          <select className='k-select' aria-label='Sort' value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        ) : null}
      </div>

      <section aria-labelledby='k-results-h' aria-busy={loading}>
        <h2 id='k-results-h' className='k-h3' style={{ marginTop: 20 }}>{heading}</h2>
        <p className='k-count' aria-live='polite'>
          {page?.locked ? '' : loading ? 'Loading' : q ? 'Best matches for “' + q + '”, closest first' : total + (total === 1 ? ' entry' : ' entries')}
        </p>

        {page?.locked && kit ? (
          <LockedToolkit kit={kit} signedIn={signedIn} back={backUrl(state)} />
        ) : error ? (
          <div className='k-empty-box' role='alert'>
            <h3 className='k-h3'>The library did not load</h3>
            <p>{error}</p>
            <button type='button' className='k-btn k-btn-sm' onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button>
          </div>
        ) : loading && !items.length ? (
          <div className='k-grid'>{Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}</div>
        ) : !items.length ? (
          <div className='k-empty-box'>
            {saved ? (
              <>
                <h3 className='k-h3'>Nothing saved yet</h3>
                <p>Use the bookmark on any entry to keep it here. Your agent can add to this list too.</p>
                <button type='button' className='k-btn k-btn-sm' onClick={() => setSaved(false)}>Browse the library</button>
              </>
            ) : (
              <>
                <h3 className='k-h3'>Nothing here matches yet</h3>
                <p>{q ? 'Try describing the job instead of a product name, or widen the filters.' : 'No entries fit these filters.'}</p>
                <button type='button' className='k-btn k-btn-sm' onClick={clearAll}>Clear search and filters</button>
              </>
            )}
            {page?.hidden ? <Hidden by={page.hiddenBy} level={level} back={backUrl(state)} /> : null}
          </div>
        ) : (
          <>
            <div className={'k-grid' + (loading ? ' k-grid-busy' : '')}>
              {items.map((item, i) => (
                <EntryCard key={item.id} item={item} onOpen={open} onSave={toggleSave} signedIn={signedIn} eager={i < 3} />
              ))}
            </div>
            {page?.hidden ? <Hidden by={page.hiddenBy} level={level} back={backUrl(state)} /> : null}
            {items.length < total ? (
              <div className='k-more'>
                <button type='button' className='k-btn' onClick={loadMore} disabled={more}>
                  {more ? 'Loading' : q ? 'Show more matches' : 'Show more (' + (total - items.length) + ' left)'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {openId ? <Drawer id={openId} signedIn={signedIn} pro={level === 'premium' || level === 'admin'} onClose={close} onSaved={(id, v) => setPage((cur) => cur && { ...cur, items: cur.items.map((i) => (i.id === id ? { ...i, saved: v } : i)) })} /> : null}
    </>
  );
}

/** Where "Continue with Free" on the upgrade screen comes back to: this exact view. */
function backUrl(state) {
  const p = params(state);
  return '/explore' + (p.toString() ? '?' + p : '');
}

/**
 * What this account opens, as the server counts it. Only ever a number the
 * policy enforces, so "50 free entries" is true by construction.
 */
function Allowance({ level, levels }) {
  const text =
    level === 'visitor'
      ? levels.visitor + ' entries open to everyone · ' + levels.free + ' with a free account'
      : level === 'free'
        ? levels.free + ' free entries available'
        : 'All ' + levels.premium + ' entries open to you';
  return <p className='k-allowance'><span aria-hidden='true' className={'k-dot' + (level === 'premium' || level === 'admin' ? ' k-dot-ok' : '')} />{text}</p>;
}

/** How many more entries match, and the one step that opens them. Counts only, never names. */
function Hidden({ by, level, back }) {
  if (!by) return null;
  const parts = [];
  if (by.members) parts.push(by.members + ' with a free account');
  if (by.premium) parts.push(by.premium + ' with ' + PRO.name);
  return (
    <div className='k-notice'>
      <p><b>More match here:</b> {parts.join(', ')}.</p>
      <div className='k-notice-acts'>
        {level === 'visitor' && by.members ? (
          <GoogleButton next='/explore' from='hidden-notice' size='medium' text='signup_with' label='Sign in free' className='k-btn k-btn-sm k-btn-accent' />
        ) : null}
        {by.premium ? (
          <Link className='k-btn k-btn-sm' href={'/upgrade?back=' + encodeURIComponent(back)} onClick={() => track('premium_locked_clicked', { from: 'hidden-notice' })}>See {PRO.name}</Link>
        ) : null}
      </div>
    </div>
  );
}

/** A Premium toolkit: a deliberate destination, never an error. Nothing inside it is fetched. */
function LockedToolkit({ kit, signedIn, back }) {
  const href = '/upgrade?toolkit=' + kit.key + '&back=' + encodeURIComponent(back);
  return (
    <div className='k-locked'>
      <span className='k-locked-icon'><SparkIcon size={18} /></span>
      <span className='k-eyebrow'>{PRO.name} toolkit</span>
      <h3 className='k-h2'>Unlock the full {kit.label} library</h3>
      <p>{kit.pitch}</p>
      <p className='k-small'>{kit.count} entries. {PRO.name} opens them here and in your agent.</p>
      <div className='k-locked-acts'>
        <Link className='k-btn k-btn-accent' href={href} onClick={() => track('premium_locked_clicked', { toolkit: kit.key })}>Explore {PRO.name}</Link>
        {!signedIn ? <Link className='k-btn' href={'/login?next=' + encodeURIComponent('/explore?toolkit=' + kit.key)}>Sign in</Link> : null}
      </div>
    </div>
  );
}

function Drawer({ id, signedIn, pro, onClose, onSaved }) {
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const closeRef = useRef(null);
  const sheet = useRef(null);

  useEffect(() => {
    setLink(null);
    setError(null);
    fetch('/api/catalog/' + id)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error === 'Not found' ? 'This entry is no longer in the library.' : j.error || 'Could not open this entry.');
        setLink(j.link);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  // Focus moves into the dialog and stays there until it closes.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !sheet.current) return;
      const f = sheet.current.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const [a, z] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className='k-scrim' onClick={onClose} />
      <aside className='k-sheet' role='dialog' aria-modal='true' aria-label={link?.title || 'Entry details'} ref={sheet}>
        <div className='k-sheet-head'>
          {link && !link.locked ? <Link className='k-small k-link' href={'/explore/' + link.id}>Open as a page</Link> : <span />}
          <button ref={closeRef} type='button' className='k-x' onClick={onClose} aria-label='Close'><CloseIcon /></button>
        </div>
        <div className='k-sheet-body'>
          {error ? <p className='k-error'>{error}</p> : !link ? <p className='k-muted'>Opening</p> : <EntryDetail link={link} signedIn={signedIn} pro={pro} onSaved={onSaved} />}
        </div>
      </aside>
    </>
  );
}
