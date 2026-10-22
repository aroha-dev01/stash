'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ChatSheet from './chat';
import IndexHome from './home';
import { useSwipeDown, useBackToClose } from './swipe';
import { stageLabel, SECTIONS as SECTION_ORDER } from '@/lib/taxonomy';

const RECENTS_KEY = 'stash.recents';

const LOOKS_LIKE_URL = /^(https?:\/\/\S+|(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?)$/i;
// "how-it-works" -> "How it works", "cta" -> "CTA"
const sectionLabel = (s) =>
  s === 'cta' || s === 'faq'
    ? s.toUpperCase()
    : String(s || '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

const fmtNum = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));

const EMPTY_FACETS = {
  categories: [], collections: [], languages: [], types: [], tags: [], sources: [], pricing: [], stages: [],
  sections: [], styles: [], effects: [],
  stats: { total: 0, oss: 0, starred: 0, errored: 0, working: 0, dead: 0, unchecked: 0, repos: 0, stars_total: 0 },
};

export default function Page() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState(EMPTY_FACETS);
  const [meta, setMeta] = useState(null);

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({
    category: null, collection: null, language: null, tags: [], pricing: null,
    source: null, status: null, oss: false, starred: false, dead: false, stage: null, section: null, type: null,
  });
  const [sort, setSort] = useState('newest');
  const [limit, setLimit] = useState(40);

  const [detailId, setDetailId] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chatSeed, setChatSeed] = useState(null);
  const [recents, setRecents] = useState([]);
  const [dbError, setDbError] = useState(null);

  const omniRef = useRef(null);
  const loadSeq = useRef(0);
  const kicked = useRef(new Set());

  const isUrl = LOOKS_LIKE_URL.test(input.trim());

  const toast = useCallback((msg, kind) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind: kind || '' }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const queryString = useCallback(() => {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (filters.stage) p.set('stage', filters.stage);
    if (filters.section) p.set('section', filters.section);
    if (filters.type) p.set('type', filters.type);
    if (filters.category) p.set('category', filters.category);
    if (filters.collection) p.set('collection', filters.collection);
    if (filters.language) p.set('language', filters.language);
    if (filters.dead) p.set('dead', '1');
    if (filters.pricing) p.set('pricing', filters.pricing);
    if (filters.source) p.set('source', filters.source);
    if (filters.status) p.set('status', filters.status);
    if (filters.oss) p.set('oss', '1');
    if (filters.starred) p.set('starred', '1');
    filters.tags.forEach((t) => p.append('tag', t));
    p.set('sort', sort);
    p.set('limit', String(limit));
    return p.toString();
  }, [query, filters, sort, limit]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await fetch('/api/links?' + queryString());
      const data = await res.json();
      if (seq !== loadSeq.current) return;

      // An unreachable database used to render as "Your stash is empty",
      // which is the most alarming lie the app could tell: it looks like the
      // data is gone rather than briefly out of reach. Say what is true.
      if (!res.ok) {
        setDbError(data.error || 'Could not reach the database');
        return;
      }
      setDbError(null);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      if (seq === loadSeq.current) setDbError('No connection');
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  }, [queryString]);

  const loadFacets = useCallback(async () => {
    try {
      const res = await fetch('/api/facets');
      const j = await res.json();
      setFacets({ ...EMPTY_FACETS, ...j });
    } catch (e) {}
  }, []);

  useEffect(() => { load(); }, [load]);

  // The phone's back gesture should close whatever panel is on top, not exit
  // the app. Treated as one concern for every panel, so it cannot drift.
  const anyPanelOpen = !!(sheet || detailId);
  const closeTopPanel = useCallback(() => {
    setDetailId(null);
    setSheet(null);
    setChatSeed(null);
  }, []);
  useBackToClose(anyPanelOpen, closeTopPanel);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENTS_KEY);
      if (raw) setRecents(JSON.parse(raw).slice(0, 6));
    } catch {}
  }, []);

  // Frosts the search bar only once content is actually passing underneath it.
  // Blur is expensive on a phone, so it is not paid for while sitting at rest.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const target = document.querySelector('.main');
    const read = () => {
      const y = target && target.scrollTop ? target.scrollTop : window.scrollY;
      setScrolled(y > 8);
    };
    window.addEventListener('scroll', read, { passive: true });
    if (target) target.addEventListener('scroll', read, { passive: true });
    return () => {
      window.removeEventListener('scroll', read);
      if (target) target.removeEventListener('scroll', read);
    };
  }, []);

  /** Remembered so a repeated lookup is one tap instead of retyping. */
  const rememberSearch = useCallback((text) => {
    const t = (text || '').trim();
    if (t.length < 3) return;
    setRecents((cur) => {
      const next = [t, ...cur.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6);
      try { window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    loadFacets();
    fetch('/api/meta').then((r) => r.json()).then(setMeta).catch(() => {});
  }, [loadFacets]);

  // /?open=42 opens that tool's detail panel — used by audit tool cards.
  useEffect(() => {
    const open = Number(new URLSearchParams(window.location.search).get('open'));
    if (Number.isFinite(open) && open > 0) setDetailId(open);
  }, []);

  // Cards fill themselves in as enrichment finishes.
  useEffect(() => {
    const working = items.some((l) => l.status === 'pending' || l.status === 'enriching');
    if (!working) return;
    const t = setTimeout(() => { load(); loadFacets(); }, 2500);
    return () => clearTimeout(t);
  }, [items, load, loadFacets]);

  const enrich = useCallback((path) => {
    // Fire and forget: enrichment runs in its own request with its own budget.
    fetch(path, { method: 'POST' })
      .then(() => { load(); loadFacets(); })
      .catch(() => {});
  }, [load, loadFacets]);

  /**
   * Safety net. A link saved from the iOS share sheet has no page open to kick
   * off enrichment, and a phone that loses signal mid-save leaves a row stuck
   * on 'pending' forever. Whenever the app opens, anything still pending gets
   * picked up once. The ref stops the poll loop from firing it repeatedly.
   */
  useEffect(() => {
    const stuck = items.filter((l) => l.status === 'pending' && !kicked.current.has(l.id));
    if (!stuck.length) return;
    stuck.forEach((l) => {
      kicked.current.add(l.id);
      fetch('/api/enrich/' + l.id, { method: 'POST' })
        .then(() => { load(); loadFacets(); })
        .catch(() => {});
    });
  }, [items, load, loadFacets]);

  const saveUrl = useCallback(async (url) => {
    setInput('');
    setSaving(true);
    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save that');
      toast(data.duplicate ? 'Already saved' : 'Saved - reading it now', data.duplicate ? '' : 'ok');
      setQuery('');
      await load();
      if (data.enrich) enrich(data.enrich);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setSaving(false);
    }
  }, [load, enrich, toast]);

  /**
   * The whole point on a phone: you copied a link in Twitter or Reddit,
   * you switch here, you tap once. No long-press, no keyboard.
   */
  const pasteAndSave = useCallback(async () => {
    try {
      const text = (await navigator.clipboard.readText() || '').trim();
      if (!text) return toast('Clipboard is empty', 'bad');
      const match = text.match(/https?:\/\/[^\s]+/);
      const url = match ? match[0] : text;
      if (!LOOKS_LIKE_URL.test(url)) return toast('No link in your clipboard', 'bad');
      saveUrl(url);
    } catch {
      // Safari refuses without a gesture it trusts, or permission was denied.
      toast('Tap the box, then paste', 'bad');
      if (omniRef.current) omniRef.current.focus();
    }
  }, [saveUrl, toast]);

  const onSubmit = useCallback(() => {
    const v = input.trim();
    if (!v) return;
    if (omniRef.current) omniRef.current.blur();
    if (LOOKS_LIKE_URL.test(v)) saveUrl(v);
    else { setQuery(v); rememberSearch(v); }
  }, [input, saveUrl, rememberSearch]);

  // Typing a non-URL searches as you go; a URL waits for the button or Enter.
  useEffect(() => {
    const v = input.trim();
    if (LOOKS_LIKE_URL.test(v)) return;
    const t = setTimeout(() => setQuery(v), 250);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (detailId || sheet) { setDetailId(null); setSheet(null); return; }
        if (omniRef.current) omniRef.current.blur();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (omniRef.current) { omniRef.current.focus(); omniRef.current.select(); }
      }
    };
    const onPaste = (e) => {
      if (document.activeElement === omniRef.current) return;
      const text = e.clipboardData ? (e.clipboardData.getData('text') || '').trim() : '';
      const match = text.match(/https?:\/\/[^\s]+/);
      if (match) saveUrl(match[0]);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  }, [detailId, sheet, saveUrl]);

  const patchFilters = (p) => setFilters((f) => ({ ...f, ...p }));
  const toggleTag = (name) =>
    setFilters((f) => ({ ...f, tags: f.tags.indexOf(name) >= 0 ? f.tags.filter((t) => t !== name) : [...f.tags, name] }));
  const clearAll = () =>
    setFilters({
      category: null, collection: null, language: null, tags: [], pricing: null,
      source: null, status: null, oss: false, starred: false, dead: false, stage: null, section: null, type: null,
    });

  const activeFilterCount =
    filters.tags.length +
    [filters.pricing, filters.source, filters.status, filters.collection, filters.language].filter(Boolean).length +
    (filters.oss ? 1 : 0) + (filters.starred ? 1 : 0) + (filters.dead ? 1 : 0);

  let crumb = 'All';
  if (query) crumb = 'Results';
  else if (filters.section) crumb = 'For the ' + sectionLabel(filters.section);
  else if (filters.language) crumb = filters.language;
  else if (filters.collection) crumb = filters.collection;
  else if (filters.dead) crumb = 'Broken links';
  else if (filters.category) crumb = filters.category;
  else if (filters.stage) crumb = facets.stages.find((s) => s.key === filters.stage)?.label || 'Build phase';
  else if (filters.starred) crumb = 'Starred';
  else if (filters.oss) crumb = 'Open source';
  else if (filters.status === 'error') crumb = 'Needs attention';

  async function toggleStar(link) {
    setItems((cur) => cur.map((i) => (i.id === link.id ? { ...i, starred: !i.starred } : i)));
    await fetch('/api/links/' + link.id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ starred: !link.starred }),
    });
    loadFacets();
  }

  const configMissing = meta && meta.supabase === false;
  const aiOff = meta && meta.llm && !meta.llm.enabled;

  return (
    <div className={scrolled ? 'app ix is-scrolled' : 'app ix'}>
      <IndexHome
        items={items} total={total} facets={facets} filters={filters} query={query}
        input={input} setInput={setInput} isUrl={isUrl} saving={saving} busy={busy}
        dbError={dbError} recents={recents} omniRef={omniRef} crumb={crumb} sort={sort}
        activeFilterCount={activeFilterCount}
        onPatch={patchFilters} onClear={clearAll} onSubmit={onSubmit} onPaste={pasteAndSave}
        onClearQuery={() => setQuery('')}
        onSort={setSort} onMore={() => setLimit((l) => l + 40)}
        onFilters={() => setSheet('filters')} onMenu={() => setSheet('menu')}
        onDetails={(id) => setDetailId(id)} onStar={toggleStar}
        onTag={toggleTag}
        onAsk={(text) => { setChatSeed(text || null); setSheet('chat'); }}
        onCopyText={(text, msg) => {
          navigator.clipboard.writeText(text).then(() => toast(msg || 'Copied', 'ok'), () => toast('Could not copy', 'bad'));
        }}
        onRecent={(r) => { setInput(r); setQuery(r); }}
        onClearRecents={() => {
          setRecents([]);
          try { window.localStorage.removeItem(RECENTS_KEY); } catch {}
        }}
      >
      {dbError ? (
        <div className='banner'>
          <b>Cannot reach the database.</b> Your links are safe, they are just
          out of reach right now — nothing has been deleted. This is usually a
          paused Supabase project: open the Supabase dashboard and press
          Restore, then reload.
          <div style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--text-3)' }}>
            {dbError}
          </div>
          <button className='ghost-btn' style={{ marginTop: 12 }} onClick={() => { setBusy(true); load(); loadFacets(); }}>
            Try again
          </button>
        </div>
      ) : configMissing ? (
        <div className='banner'>
          <b>Not connected to the database yet.</b> Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
          Vercel, Settings, Environment Variables, then redeploy.
        </div>
      ) : aiOff ? (
        <div className='banner'>
          <b>DEEPSEEK_API_KEY is not set.</b> Links will save, but nothing gets summarised or categorised until you add it.
        </div>
      ) : null}
      </IndexHome>

      {/* The two things done most often, parked where the thumb already is.
          Everything else stays at the top where it does not compete. */}
      {!detailId && !sheet ? (
        <div className='fabs'>
          <button className='fab paste' onClick={pasteAndSave} disabled={saving} aria-label='Paste a link'>
            <svg viewBox='0 0 24 24'>
              <path d='M9 4h6a1 1 0 011 1v1H8V5a1 1 0 011-1z' />
              <path d='M8 6H6a2 2 0 00-2 2v11a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-2' />
            </svg>
            <span>{saving ? 'Saving' : 'Paste'}</span>
          </button>

          <button
            className='fab ask'
            onClick={() => { setChatSeed(null); setSheet('chat'); }}
            aria-label='Ask your stash'
          >
            <svg viewBox='0 0 24 24'>
              <path d='M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z' />
              <path d='M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z' />
            </svg>
            <span>Ask</span>
          </button>
        </div>
      ) : null}

      {detailId || sheet ? <div className='scrim' onClick={closeTopPanel} /> : null}

      {detailId ? (
        <Detail
          id={detailId}
          categories={meta && meta.categories ? meta.categories : []}
          allCollections={facets.collections}
          onClose={() => setDetailId(null)}
          onChanged={() => { load(); loadFacets(); }}
          onPickTag={(t) => { setDetailId(null); setInput(''); setQuery(''); toggleTag(t); }}
          toast={toast}
        />
      ) : null}

      {sheet === 'filters' ? (
        <FilterSheet
          facets={facets} filters={filters}
          onPatch={patchFilters} onToggleTag={toggleTag}
          onClear={() => { clearAll(); setSheet(null); }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'menu' ? (
        <MenuSheet
          meta={meta} facets={facets}
          onBulk={() => setSheet('bulk')}
          onShortcut={() => setSheet('shortcut')}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'shortcut' ? <ShortcutSheet onClose={() => setSheet(null)} toast={toast} /> : null}

      {sheet === 'chat' ? (
        <ChatSheet
          seed={chatSeed}
          onClose={() => { setSheet(null); setChatSeed(null); }}
          onOpenLink={(id) => { setSheet(null); setChatSeed(null); setDetailId(id); }}
        />
      ) : null}

      {sheet === 'bulk' ? (
        <BulkSheet
          onClose={() => setSheet(null)}
          onDone={(r) => {
            toast(r.added + ' added' + (r.duplicates ? ', ' + r.duplicates + ' already saved' : ''), 'ok');
            load(); loadFacets();
            (r.enrich || []).forEach(enrich);
          }}
        />
      ) : null}

      <div className='toast-stack'>
        {toasts.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}
      </div>
    </div>
  );
}

function Chips({ filters, onClear, onToggleTag }) {
  const chips = [];
  if (filters.stage) chips.push({ label: stageLabel(filters.stage), clear: () => onClear({ stage: null }) });
  if (filters.section) chips.push({ label: sectionLabel(filters.section), clear: () => onClear({ section: null }) });
  if (filters.category) chips.push({ label: filters.category, clear: () => onClear({ category: null }) });
  filters.tags.forEach((t) => chips.push({ label: '#' + t, clear: () => onToggleTag(t) }));
  if (filters.pricing) chips.push({ label: filters.pricing, clear: () => onClear({ pricing: null }) });
  if (filters.source) chips.push({ label: filters.source, clear: () => onClear({ source: null }) });
  if (filters.oss) chips.push({ label: 'open source', clear: () => onClear({ oss: false }) });
  if (filters.starred) chips.push({ label: 'starred', clear: () => onClear({ starred: false }) });
  if (filters.status === 'error') chips.push({ label: 'needs attention', clear: () => onClear({ status: null }) });

  if (!chips.length) return null;
  return (
    <div className='chips'>
      {chips.map((c, i) => (
        <div key={i} className='chip' onClick={c.clear}><b>{c.label}</b><span className='x'>clear</span></div>
      ))}
    </div>
  );
}

function Card({ link, index, onOpen, onStar, onCopy }) {
  const working = link.status === 'pending' || link.status === 'enriching';
  const helps = link.use_cases && link.use_cases.length > 0 ? link.use_cases[0] : null;

  return (
    // --i drives the entrance stagger; the CSS caps it so a long list still
    // finishes arriving quickly.
    <div
      className={working ? 'card working' : 'card'}
      style={{ '--i': index }}
      onClick={onOpen}
    >
      <div className='card-top'>
        {link.favicon ? (
          <img className='card-fav' src={link.favicon} alt='' loading='lazy' onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        ) : <span className='card-fav' />}
        <div className='card-headtext'>
          <div className='card-title'>{link.title || 'Untitled'}</div>
          <div className='card-domain'>{link.domain}</div>
        </div>
        {/* Copying a link is the most common reason to open a card at all, so
            it does not need the card opened. */}
        <button
          className='card-star'
          onClick={(e) => { e.stopPropagation(); onCopy(link); }}
          aria-label='Copy link'
        >
          <svg viewBox='0 0 24 24'>
            <rect x='9' y='9' width='11' height='11' rx='2' />
            <path d='M5 15V6a2 2 0 012-2h9' />
          </svg>
        </button>
        <button
          className={link.starred ? 'card-star on' : 'card-star'}
          onClick={(e) => { e.stopPropagation(); onStar(); }}
          aria-label='Star'
        >
          <svg viewBox='0 0 24 24'><path d='M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z' /></svg>
        </button>
      </div>

      {working ? (
        <div className='skeleton'>
          <div className='skeleton-line' style={{ width: '92%' }} />
          <div className='skeleton-line' style={{ width: '62%' }} />
        </div>
      ) : (
        <div>
          {link.summary || link.description ? (
            <div className='card-summary'>{link.summary || link.description}</div>
          ) : null}
          {helps ? <div className='card-helps' style={{ marginTop: 8 }}>{helps}</div> : null}
        </div>
      )}

      <div className='card-meta'>
        {link.category ? <span className='pill cat'>{link.category}</span> : null}
        {link.is_open_source ? <span className='pill oss'>open source</span> : null}
        {link.repo_stars != null ? <span className='pill stars'>{fmtNum(link.repo_stars)} stars</span> : null}
        {link.pricing && link.pricing !== 'unknown' && link.pricing !== 'open-source' ? <span className='pill'>{link.pricing}</span> : null}
        {link.status === 'error' ? <span className='pill err'>failed</span> : null}
        {link.dead ? <span className='pill err'>link broken</span> : null}
        {/* Reference material is worth flagging at a glance: it is the thing
            you read, not the thing you install. */}
        {link.type === 'reference' || link.type === 'article' ? (
          <span className='pill ref'>reference</span>
        ) : null}
        {link.maturity === 'archived' ? <span className='pill err'>archived</span> : null}
        {(link.collections || []).map((c) => <span key={c} className='pill coll'>{c}</span>)}
      </div>

      {link.tags && link.tags.length > 0 ? (
        <div className='card-tags'>
          {link.tags.slice(0, 4).map((t) => <span key={t} className='mini-tag'>#{t}</span>)}
        </div>
      ) : null}
    </div>
  );
}

function Detail({ id, categories, allCollections, onClose, onChanged, onPickTag, toast }) {
  const [link, setLink] = useState(null);
  const [form, setForm] = useState({ title: '', summary: '', category: '', tags: '', note: '' });
  const [collections, setCollections] = useState([]);
  const [newColl, setNewColl] = useState('');
  const sheetRef = useSwipeDown(onClose);

  /** Saved immediately: filing something is a decision, not a draft. */
  const writeCollections = async (next) => {
    setCollections(next);
    await fetch('/api/links/' + id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ collections: next }),
    });
    onChanged();
  };

  useEffect(() => {
    fetch('/api/links/' + id).then((r) => r.json()).then((res) => {
      const l = res.link;
      setLink(l);
      setCollections((l && l.collections) || []);
      setForm({
        title: (l && l.title) || '', summary: (l && l.summary) || '',
        category: (l && l.category) || '', tags: ((l && l.tags) || []).join(', '), note: (l && l.note) || '',
      });
    });
  }, [id]);

  if (!link) {
    return (
      <section className='sheet detail' ref={sheetRef}>
        <div className='skeleton'>
          <div className='skeleton-line' style={{ width: '60%' }} />
          <div className='skeleton-line' />
        </div>
      </section>
    );
  }

  const helps = link.use_cases && link.use_cases.length > 0 ? link.use_cases[0] : null;
  const rest = link.use_cases && link.use_cases.length > 1 ? link.use_cases.slice(1) : [];

  const save = async () => {
    await fetch('/api/links/' + id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: form.title.trim(),
        summary: form.summary.trim(),
        category: form.category.trim(),
        note: form.note.trim(),
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      }),
    });
    toast('Saved', 'ok');
    onClose(); onChanged();
  };

  const remove = async () => {
    if (!confirm('Delete this permanently?')) return;
    await fetch('/api/links/' + id, { method: 'DELETE' });
    toast('Deleted');
    onClose(); onChanged();
  };

  const reenrich = async () => {
    toast('Re-reading it now', 'ok');
    onClose();
    await fetch('/api/enrich/' + id, { method: 'POST' });
    onChanged();
  };

  return (
    <section className='sheet detail' ref={sheetRef}>
      <div className='d-head'>
        {link.favicon ? <img className='d-fav' src={link.favicon} alt='' onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{link.title || 'Untitled'}</h2>
          <a className='d-url' href={link.url} target='_blank' rel='noopener noreferrer'>{link.url}</a>
        </div>
      </div>

      <div className='d-actions'>
        <a className='primary-btn' href={link.url} target='_blank' rel='noopener noreferrer'>Open</a>
        <button className='ghost-btn' onClick={() => { navigator.clipboard.writeText(link.url); toast('Link copied', 'ok'); }}>
          Copy link
        </button>
        <button className='ghost-btn' onClick={reenrich}>Re-enrich</button>
      </div>

      {link.dead ? (
        <div className='banner' style={{ margin: '0 0 18px' }}>
          <b>This link looks broken.</b> Last check said {link.dead_reason || 'unreachable'}.
          The details below are whatever was captured while it still worked.
        </div>
      ) : null}

      {/* Projects. Tapping an existing one files it there; typing makes a new
          one. Saved on the tap, not on a separate Save button. */}
      <div className='d-section'>
        <div className='d-label'>Projects</div>
        <div className='tag-cloud'>
          {[...new Set([...(allCollections || []).map((c) => c.name), ...collections])].map((name) => {
            const on = collections.indexOf(name) >= 0;
            return (
              <button
                key={name}
                className={on ? 'tag-chip active' : 'tag-chip'}
                onClick={() =>
                  writeCollections(on ? collections.filter((c) => c !== name) : [...collections, name])
                }
              >
                {name}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            className='d-input'
            placeholder='New project name'
            value={newColl}
            onChange={(e) => setNewColl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const v = newColl.trim();
              if (!v || collections.indexOf(v) >= 0) return;
              writeCollections([...collections, v]);
              setNewColl('');
            }}
          />
          <button
            className='ghost-btn'
            onClick={() => {
              const v = newColl.trim();
              if (!v || collections.indexOf(v) >= 0) return;
              writeCollections([...collections, v]);
              setNewColl('');
            }}
          >
            Add
          </button>
        </div>
      </div>

      {/* For anything visual, the screenshot settles it faster than the
          summary does. */}
      {link.image ? (
        <div className='d-section'>
          <img
            className='d-preview'
            src={link.image}
            alt=''
            loading='lazy'
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        </div>
      ) : null}

      {(link.used_in || []).length ? (
        <div className='d-section'>
          <div className='d-label'>You have used this</div>
          <div className='tag-cloud'>
            {link.used_in.map((p) => <span key={p} className='pill coll'>{p}</span>)}
            <span className='pill'>{link.used_count}&times;</span>
          </div>
        </div>
      ) : null}

      {link.summary ? (
        <div className='d-section'><div className='d-label'>What it is</div><div className='d-body'>{link.summary}</div></div>
      ) : null}

      {(link.sections || []).length || (link.effect_kind || []).length || (link.style_tags || []).length ? (
        <div className='d-section'>
          <div className='d-label'>Use it on</div>
          <div className='tag-cloud'>
            {(link.sections || []).map((s) => <span key={'s' + s} className='pill sect'>{sectionLabel(s)}</span>)}
            {(link.effect_kind || []).map((e) => <span key={'e' + e} className='pill'>{e.replace(/-/g, ' ')}</span>)}
            {(link.style_tags || []).map((t) => <span key={'t' + t} className='pill ref'>{t.replace(/-/g, ' ')}</span>)}
          </div>
        </div>
      ) : null}

      {link.install ? (
        <div className='d-section'>
          <div className='d-label'>Install</div>
          <div className='code install-row'>
            <span>{link.install}</span>
            <button
              className='ghost-btn'
              onClick={() => { navigator.clipboard.writeText(link.install); toast('Copied', 'ok'); }}
            >
              copy
            </button>
          </div>
        </div>
      ) : null}

      {link.quickstart ? (
        <div className='d-section'>
          <div className='d-label'>Quickstart</div>
          <div className='code' style={{ whiteSpace: 'pre-wrap' }}>{link.quickstart}</div>
        </div>
      ) : null}

      {link.avoid_when ? (
        <div className='d-section'>
          <div className='d-label'>Don&apos;t reach for it when</div>
          <div className='d-body' style={{ color: 'var(--amber)' }}>{link.avoid_when}</div>
        </div>
      ) : null}

      {link.limits ? (
        <div className='d-section'><div className='d-label'>Limits</div><div className='d-body'>{link.limits}</div></div>
      ) : null}

      {(link.works_with || []).length || (link.requires || []).length ? (
        <div className='d-section'>
          <div className='d-label'>Fit</div>
          <div className='tag-cloud'>
            {(link.works_with || []).map((w) => <span key={w} className='pill'>{w}</span>)}
            {(link.requires || []).map((r) => <span key={r} className='pill err'>needs {r}</span>)}
          </div>
        </div>
      ) : null}

      {helps ? (
        <div className='d-section'>
          <div className='d-label'>How it helps you</div>
          <div className='d-helps'>{helps}</div>
        </div>
      ) : null}

      {rest.length > 0 ? (
        <div className='d-section'>
          <div className='d-label'>Reach for it when</div>
          <div className='d-body'><ul>{rest.map((u, i) => <li key={i}>{u}</li>)}</ul></div>
        </div>
      ) : null}

      {link.description ? (
        <div className='d-section'><div className='d-label'>From the page</div><div className='d-body'>{link.description}</div></div>
      ) : null}

      <div className='d-section'>
        <div className='d-label'>Details</div>
        <div className='d-grid'>
          <div className='d-cell'><span>Category</span><b>{link.category || '-'}</b></div>
          <div className='d-cell'><span>Pricing</span><b>{link.pricing || 'unknown'}</b></div>
          {link.repo_stars != null ? <div className='d-cell'><span>Stars</span><b>{fmtNum(link.repo_stars)}</b></div> : null}
          {link.repo_forks != null ? <div className='d-cell'><span>Forks</span><b>{fmtNum(link.repo_forks)}</b></div> : null}
          {link.repo_open_prs != null ? <div className='d-cell'><span>Open PRs</span><b>{link.repo_open_prs}</b></div> : null}
          {link.repo_pushed_at ? (
            <div className='d-cell'><span>Last commit</span><b>{String(link.repo_pushed_at).slice(0, 10)}</b></div>
          ) : null}
          {link.repo_language ? <div className='d-cell'><span>Language</span><b>{link.repo_language}</b></div> : null}
          {link.repo_license ? <div className='d-cell'><span>License</span><b>{link.repo_license}</b></div> : null}
          <div className='d-cell'><span>Saved from</span><b>{link.source || 'web'}</b></div>
          <div className='d-cell'><span>Saved</span><b>{String(link.created_at).slice(0, 10)}</b></div>
        </div>
      </div>

      {link.tags && link.tags.length > 0 ? (
        <div className='d-section'>
          <div className='d-label'>Tags</div>
          <div className='tag-cloud'>
            {link.tags.map((t) => <button key={t} className='tag-chip' onClick={() => onPickTag(t)}>{t}</button>)}
          </div>
        </div>
      ) : null}

      {link.error ? (
        <div className='d-section'>
          <div className='d-label'>Notes from enrichment</div>
          <div className='d-body' style={{ color: 'var(--amber)', fontSize: 13 }}>{link.error}</div>
        </div>
      ) : null}

      <div className='d-section'>
        <div className='d-label'>Your note</div>
        <textarea className='d-area' rows={3} placeholder='Why did you save this?'
          value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </div>

      <details className='d-section'>
        <summary style={{ color: 'var(--text-3)', fontSize: 13, cursor: 'pointer', marginBottom: 10 }}>Edit fields</summary>
        <div className='d-field'><input className='d-input' placeholder='Title' value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div className='d-field'><input className='d-input' placeholder='One-line summary' value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
        <div className='d-field'>
          <input className='d-input' list='catlist' placeholder='Category' value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <datalist id='catlist'>{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className='d-field'><input className='d-input' placeholder='tags, comma, separated' value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div>
      </details>

      <div className='d-actions' style={{ marginTop: 6 }}>
        <button className='primary-btn' onClick={save}>Save changes</button>
        <button className='ghost-btn danger' onClick={remove}>Delete</button>
      </div>
    </section>
  );
}

function Group({ label, options, current, onPick }) {
  return (
    <div>
      <div className='d-label'>{label}</div>
      <div className='opt-row'>
        {options.map((o) => (
          <button key={String(o.value)} className={o.value === current ? 'opt active' : 'opt'} onClick={() => onPick(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterSheet({ facets, filters, onPatch, onToggleTag, onClear, onClose }) {
  return (
    <section className='sheet filters'>
      <h3>Filters</h3>

      <Group
        label='Pricing'
        current={filters.pricing}
        onPick={(v) => onPatch({ pricing: v })}
        options={[{ label: 'Any', value: null }].concat(facets.pricing.map((p) => ({ label: p.name + ' (' + p.count + ')', value: p.name })))}
      />
      <Group
        label='Saved from'
        current={filters.source}
        onPick={(v) => onPatch({ source: v })}
        options={[{ label: 'Anywhere', value: null }].concat(facets.sources.map((s) => ({ label: s.name + ' (' + s.count + ')', value: s.name })))}
      />

      <div className='d-label'>Flags</div>
      <div className='opt-row'>
        <button className={filters.starred ? 'opt active' : 'opt'} onClick={() => onPatch({ starred: !filters.starred })}>Starred</button>
        <button className={filters.oss ? 'opt active' : 'opt'} onClick={() => onPatch({ oss: !filters.oss })}>Open source</button>
        <button className={filters.status === 'error' ? 'opt active' : 'opt'} onClick={() => onPatch({ status: filters.status === 'error' ? null : 'error' })}>Needs attention</button>
        <button className={filters.dead ? 'opt active' : 'opt'} onClick={() => onPatch({ dead: !filters.dead })}>
          Broken links{facets.stats.dead ? ' (' + facets.stats.dead + ')' : ''}
        </button>
      </div>

      {facets.collections.length > 0 ? (
        <Group
          label='Project'
          current={filters.collection}
          onPick={(v) => onPatch({ collection: v })}
          options={[{ label: 'Any', value: null }].concat(
            facets.collections.map((c) => ({ label: c.name + ' (' + c.count + ')', value: c.name }))
          )}
        />
      ) : null}

      {facets.tags.length > 0 ? (
        <div>
          <div className='d-label'>Tags</div>
          <div className='tag-cloud' style={{ marginBottom: 18 }}>
            {facets.tags.slice(0, 60).map((t) => (
              <button key={t.name} className={filters.tags.indexOf(t.name) >= 0 ? 'tag-chip active' : 'tag-chip'} onClick={() => onToggleTag(t.name)}>
                {t.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className='d-actions'>
        <button className='ghost-btn' onClick={onClear}>Clear all</button>
        <button className='primary-btn' onClick={onClose}>Done</button>
      </div>
    </section>
  );
}

function MenuSheet({ meta, facets, onBulk, onShortcut, onClose }) {
  const l = (meta && meta.llm) || {};
  return (
    <section className='sheet menu'>
      <h3>Stash</h3>

      <button className='menu-item' onClick={onShortcut}>
        <div><div>iPhone share sheet</div><small>Save links straight from Twitter, Reddit, anywhere</small></div>
      </button>
      <button className='menu-item' onClick={onBulk}>
        <div><div>Bulk add links</div><small>Paste a list, a thread, exported bookmarks</small></div>
      </button>
      <a className='menu-item' href='/api/export'>
        <div><div>Export everything</div><small>Download your whole stash as JSON</small></div>
      </a>
      <button
        className='menu-item'
        onClick={async () => {
          const r = await fetch('/api/links?status=error&limit=200').then((x) => x.json());
          await Promise.all((r.items || []).map((i) => fetch('/api/enrich/' + i.id, { method: 'POST' })));
          onClose();
        }}
      >
        <div><div>Retry everything that failed</div><small>{facets.stats.errored} item(s)</small></div>
      </button>

      <div className='status-line' style={{ marginTop: 16 }}>
        Summaries <b>{l.enabled ? l.provider + ' - ' + l.model : 'off - ' + (l.reason || '')}</b><br />
        Semantic <b>{meta && meta.semantic ? meta.semantic.via : 'off'}</b><br />
        Screenshots <b>paused</b>
      </div>
    </section>
  );
}

/** Shows the exact URL the iOS Shortcut needs, and copies it in one tap. */
function ShortcutSheet({ onClose, toast }) {
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const endpoint = origin + '/api/save?text=1&url=';

  return (
    <section className='sheet menu'>
      <h3>Save from the share sheet</h3>
      <p style={{ color: 'var(--text-3)', fontSize: 13.5, lineHeight: 1.6, margin: '0 0 14px' }}>
        Build a Shortcut once, and Stash appears in the iOS share sheet everywhere.
        Open <b>Shortcuts</b>, make a new one, then:
      </p>

      <ol style={{ color: 'var(--text-2)', fontSize: 13.5, lineHeight: 1.75, paddingLeft: 18, margin: '0 0 14px' }}>
        <li>Turn on <b>Show in Share Sheet</b>, accept type <b>URLs</b>.</li>
        <li>Add the action <b>Get Contents of URL</b>.</li>
        <li>For its URL, paste the address below, then tap <b>Shortcut Input</b> to append it on the end.</li>
        <li>Add <b>Show Notification</b> with the result, so you see the summary.</li>
        <li>Name it <b>Stash</b>.</li>
      </ol>

      <div className='d-label'>Paste this, then add Shortcut Input after it</div>
      <div className='code'>{endpoint}</div>

      <div className='d-actions'>
        <button
          className='primary-btn'
          onClick={() => { navigator.clipboard.writeText(endpoint); toast('Copied', 'ok'); }}
        >
          Copy address
        </button>
        <button className='ghost-btn' onClick={onClose}>Done</button>
      </div>
    </section>
  );
}

function BulkSheet({ onClose, onDone }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <section className='sheet menu'>
      <h3>Bulk add</h3>
      <p style={{ color: 'var(--text-3)', fontSize: 13.5, lineHeight: 1.5, margin: '0 0 12px' }}>
        Paste anything - a list of URLs, a copied thread, exported bookmarks. Every link found gets queued.
      </p>
      <textarea
        className='d-area' rows={8} placeholder='https://...'
        style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
        value={text} onChange={(e) => setText(e.target.value)}
      />
      <div className='d-actions' style={{ marginTop: 12 }}>
        <button
          className='primary-btn'
          disabled={saving}
          onClick={async () => {
            if (!text.trim()) return;
            setSaving(true);
            const r = await fetch('/api/links/bulk', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
            }).then((x) => x.json());
            onClose(); onDone(r);
          }}
        >
          {saving ? 'Adding...' : 'Add links'}
        </button>
        <button className='ghost-btn' onClick={onClose}>Cancel</button>
      </div>
    </section>
  );
}
