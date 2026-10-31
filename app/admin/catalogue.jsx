'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORIES, PRICING, TOOLKITS, toolkitFor } from '@/lib/taxonomy';
import { TYPE_LABELS } from '@/lib/labels';
import { PRO } from '@/lib/plans';
import { CloseIcon, SearchIcon } from '../_ui/icons';
import AccessBadge from '../_ui/AccessBadge';
import { State, Toggle, ago, api, date } from './ui';

// Every view is the whole catalogue, curators included: nothing here is
// filtered by the curator's own plan. Tier views go by the tier an entry
// effectively has, Premium toolkits included.
const VIEWS = [
  ['all', 'All'],
  ['collection', 'Free collection'],
  ['public', 'Visitor sample'],
  ['free', 'Members'],
  ['premium', PRO.name],
  ['featured', 'Featured'],
  ['attention', 'Needs a look'],
  ['starred', 'Starred'],
];
const VIEW_PARAMS = {
  all: {},
  collection: { access: 'collection' },
  public: { access: 'public' },
  free: { access: 'free' },
  premium: { access: 'premium' },
  featured: { featured: '1' },
  attention: { attention: '1' },
  starred: { starred: '1' },
};

// Who may open an entry. The tier names are lib/access.js's; the words are what members read.
const ACCESS = [
  ['public', 'Visitor sample', 'Anyone can open it, signed out included. Part of the Free collection.'],
  ['free', 'Members', 'Part of the Free collection: any signed-in member. Signed-out visitors never see it.'],
  ['premium', PRO.name, 'Only members on ' + PRO.name + ', and curators. Agents on Free never see it either.'],
];
const PAGE = 40;

/** The tier an entry effectively has, and who it is hidden from, in words. */
function visibility(l, locked) {
  const kit = TOOLKITS.find((t) => t.key === toolkitFor(l.category));
  if (l.dead) return { tier: l.access, why: 'Hidden from everyone: the link is broken.' };
  if (locked.includes(kit?.key)) {
    return { tier: 'premium', why: 'Hidden from Free and visitors: ' + kit.label + ' is a ' + PRO.name + ' toolkit.' };
  }
  if (l.access === 'premium') return { tier: 'premium', why: 'Hidden from Free and visitors: a ' + PRO.name + ' entry.' };
  if (l.access === 'free') return { tier: 'free', why: 'Hidden from signed-out visitors. In the Free collection.' };
  return { tier: 'public', why: 'Open to everyone. In the visitor sample and the Free collection.' };
}

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

/** What state an entry is in, in words. */
function statusOf(l) {
  if (l.dead) return ['bad', 'Broken link'];
  if (l.status === 'error') return ['bad', 'Failed to read'];
  if (l.status === 'pending' || l.status === 'enriching') return ['warn', 'Reading'];
  return null;
}

export default function Catalogue({ initialView, onChanged, toast }) {
  const [view, setView] = useState(initialView || 'all');
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('newest');
  const [limit, setLimit] = useState(PAGE);
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState('');
  const [busyAdd, setBusyAdd] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState('');
  const [toolkit, setToolkit] = useState('');
  const [type, setType] = useState('');
  const [locks, setLocks] = useState({ premium_toolkits: [], free_target: null });
  const [levels, setLevels] = useState(null);
  const seq = useRef(0);

  const loadCounts = useCallback(() => {
    api('/api/admin/settings').then((j) => setLocks(j.catalogue), () => {});
    api('/api/catalog/overview').then((j) => setLevels(j.levels), () => {});
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 280);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => { setLimit(PAGE); }, [q, view, sort, toolkit, type]);

  const load = useCallback(async () => {
    const n = ++seq.current;
    const p = new URLSearchParams({ sort, limit: String(limit), ...VIEW_PARAMS[view] });
    if (q) p.set('q', q);
    if (toolkit) p.set('toolkit', toolkit);
    if (type) p.set('type', type);
    try {
      const j = await api('/api/links?' + p);
      if (n !== seq.current) return;
      setItems(j.items || []);
      setTotal(j.total || 0);
      setError(null);
    } catch (e) {
      if (n === seq.current) setError(e.message);
    }
  }, [q, view, sort, limit, toolkit, type]);

  useEffect(() => { load(); }, [load]);

  // Entries being read fill themselves in.
  useEffect(() => {
    if (!items?.some((l) => l.status === 'pending' || l.status === 'enriching')) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [items, load]);

  const enrich = (path) => fetch(path, { method: 'POST' }).then(() => { load(); onChanged(); }, () => {});

  const addOne = async (e) => {
    e.preventDefault();
    const url = adding.trim();
    if (!url) return;
    setBusyAdd(true);
    try {
      const j = await api('/api/links', { method: 'POST', body: { url } });
      setAdding('');
      if (j.duplicate) {
        toast('Already in the catalogue');
        setOpenId(j.link.id);
      } else {
        toast('Added. Reading it now');
        enrich(j.enrich);
      }
      load();
      onChanged();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusyAdd(false);
    }
  };

  const addMany = async () => {
    if (!bulk.trim()) return;
    setBusyAdd(true);
    try {
      const r = await api('/api/links/bulk', { method: 'POST', body: { text: bulk } });
      toast(r.added + ' added' + (r.duplicates ? ', ' + r.duplicates + ' already in the catalogue' : ''));
      setBulk('');
      setBulkOpen(false);
      (r.enrich || []).forEach(enrich);
      load();
      onChanged();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusyAdd(false);
    }
  };

  return (
    <section className='k-con-sec' aria-labelledby='cat-h'>
      <div className='k-con-head'>
        <h1 id='cat-h' className='k-h2'>Catalogue</h1>
        <p className='k-lede'>Every entry, whatever its tier. Add tools, correct what the AI wrote, and choose who can open each one.</p>
        {levels ? (
          <p className='k-small k-muted' style={{ margin: 0 }}>
            Free collection: <b>{levels.free}</b>{locks.free_target ? ' of a ' + locks.free_target + ' target' : ''}.
            {' '}Visitor sample: <b>{levels.visitor}</b>. {PRO.name} only: <b>{levels.premium - levels.free}</b>.
            {' '}{PRO.name} toolkits: {locks.premium_toolkits?.length ? TOOLKITS.filter((t) => locks.premium_toolkits.includes(t.key)).map((t) => t.label).join(', ') : 'none'}.
          </p>
        ) : null}
      </div>

      <div className='k-block k-block-tight'>
        <form className='k-field' onSubmit={addOne}>
          <label className='k-sr' htmlFor='add-url'>Link to add</label>
          <input id='add-url' value={adding} onChange={(e) => setAdding(e.target.value)} placeholder='Paste a link to add it, for example https://github.com/...' inputMode='url' />
          <button className='k-btn k-btn-brass' type='submit' disabled={busyAdd || !adding.trim()}>{busyAdd ? 'Adding' : 'Add'}</button>
          <button className='k-btn' type='button' aria-expanded={bulkOpen} onClick={() => setBulkOpen((v) => !v)}>Add many</button>
        </form>
        {bulkOpen ? (
          <div className='k-form'>
            <label className='k-label' htmlFor='bulk'>Paste a list, a thread or exported bookmarks. Every link in it is added once.</label>
            <textarea id='bulk' className='k-input k-mono' rows={6} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder='https://...' />
            <div className='k-d-actions'>
              <button type='button' className='k-btn k-btn-brass k-btn-sm' onClick={addMany} disabled={busyAdd || !bulk.trim()}>Add these links</button>
              <button type='button' className='k-btn k-btn-sm' onClick={() => setBulkOpen(false)}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>

      <div>
        <div className='k-search'>
          <SearchIcon />
          <label className='k-sr' htmlFor='cat-q'>Search the catalogue</label>
          <input id='cat-q' value={input} onChange={(e) => setInput(e.target.value)} placeholder='Search by name, domain or what it does' />
        </div>
        <div className='k-filters'>
          {VIEWS.map(([k, label]) => (
            <button key={k} type='button' className='k-chip' aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>
          ))}
          <label className='k-sr' htmlFor='cat-kit'>Toolkit</label>
          <select id='cat-kit' className='k-select' value={toolkit} onChange={(e) => setToolkit(e.target.value)}>
            <option value=''>Every toolkit</option>
            {TOOLKITS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <label className='k-sr' htmlFor='cat-type'>Kind</label>
          <select id='cat-type' className='k-select' value={type} onChange={(e) => setType(e.target.value)}>
            <option value=''>Every kind</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className='k-sr' htmlFor='cat-sort'>Sort</label>
          <select id='cat-sort' className='k-select' value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value='newest'>Newest</option>
            <option value='oldest'>Oldest</option>
            <option value='title'>A to Z</option>
            <option value='stars'>Most stars</option>
          </select>
        </div>
        <p className='k-count' aria-live='polite'>
          {items === null ? 'Loading' : items.length < total ? 'Showing ' + items.length + ' of ' + total + ' entries' : total + (total === 1 ? ' entry' : ' entries')}
          {items && view === 'all' && !q ? ', broken links included' : ''}
        </p>

        {error ? (
          <div className='k-alert'>
            <b>The catalogue did not load.</b> {error}
            <div><button type='button' className='k-btn k-btn-sm' onClick={load}>Try again</button></div>
          </div>
        ) : items && !items.length ? (
          <div className='k-empty'>
            <p style={{ margin: 0 }}>{q ? 'Nothing matches "' + q + '".' : 'Nothing in this view.'}</p>
            {view !== 'all' ? <button type='button' className='k-btn k-btn-sm' onClick={() => setView('all')}>Show everything</button> : null}
          </div>
        ) : (
          <ul className='k-list'>
            {(items || []).map((l) => {
              const st = statusOf(l);
              const vis = visibility(l, locks.premium_toolkits || []);
              return (
                <li key={l.id}>
                  <button type='button' className='k-row k-row-btn' aria-current={openId === l.id} onClick={() => setOpenId(l.id)}>
                    <Fav item={l} />
                    <span>
                      <span className='k-row-title'>
                        <b>{l.title || l.domain}</b>
                        <span className='k-row-kind'>{TYPE_LABELS[l.type] || l.domain}</span>
                        {st ? <State tone={st[0]}>{st[1]}</State> : null}
                      </span>
                      <span className='k-row-sum'>{l.summary || l.description || l.url}</span>
                      <span className='k-small k-dim' style={{ display: 'block', marginTop: 4 }}>{vis.why}</span>
                    </span>
                    <span className='k-row-side'>
                      {l.featured ? <span className='k-small k-dim'>Featured</span> : null}
                      <AccessBadge tier={vis.tier} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {items && items.length < total ? (
          <div className='k-more'>
            <button type='button' className='k-btn' onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, total - items.length)} more</button>
            <button type='button' className='k-btn k-btn-quiet' onClick={() => setLimit(total)}>Show all {total}</button>
          </div>
        ) : null}
      </div>

      {openId ? (
        <Editor
          id={openId}
          onClose={() => setOpenId(null)}
          locks={locks.premium_toolkits || []}
          onSaved={() => { load(); loadCounts(); onChanged(); }}
          toast={toast}
        />
      ) : null}
    </section>
  );
}

function Editor({ id, locks, onClose, onSaved, toast }) {
  const [link, setLink] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    let live = true;
    setLink(null);
    api('/api/links/' + id).then(({ link: l }) => {
      if (!live) return;
      setLink(l);
      setForm({
        title: l.title || '',
        summary: l.summary || '',
        category: l.category || '',
        type: l.type || '',
        pricing: l.pricing || 'unknown',
        tags: (l.tags || []).join(', '),
        note: l.note || '',
        access: l.access || 'public',
        featured: !!l.featured,
        starred: !!l.starred,
        is_open_source: !!l.is_open_source,
      });
    }, (e) => toast(e.message, 'bad'));
    return () => { live = false; };
  }, [id, toast]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { link: l } = await api('/api/links/' + id, {
        method: 'PATCH',
        body: {
          ...form,
          title: form.title.trim(),
          summary: form.summary.trim(),
          category: form.category.trim(),
          note: form.note.trim(),
          tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        },
      });
      setLink(l);
      toast('Changes saved');
      onSaved();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  const reread = async () => {
    toast('Reading it again. This takes up to a minute');
    try {
      await api('/api/enrich/' + id, { method: 'POST' });
      toast('Read again');
    } catch (err) {
      toast(err.message, 'bad');
    }
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!confirm('Delete "' + (link.title || link.domain) + '" from the catalogue? This cannot be undone.')) return;
    await api('/api/links/' + id, { method: 'DELETE' }).then(
      () => { toast('Deleted'); onSaved(); onClose(); },
      (err) => toast(err.message, 'bad')
    );
  };

  const st = link ? statusOf(link) : null;
  const categories = form && form.category && !CATEGORIES.includes(form.category) ? [form.category, ...CATEGORIES] : CATEGORIES;

  return (
    <>
      <div className='k-scrim' onClick={onClose} />
      <aside className='k-sheet' role='dialog' aria-modal='true' aria-label='Edit entry'>
        <div className='k-sheet-head'>
          <span className='k-small k-dim'>Entry {id}</span>
          <button ref={closeRef} type='button' className='k-x' onClick={onClose} aria-label='Close'><CloseIcon /></button>
        </div>

        {!link || !form ? (
          <div className='k-sheet-body'><p className='k-muted'>Loading</p></div>
        ) : (
          <form className='k-sheet-body' onSubmit={save}>
            <div className='k-d-title'>
              <Fav item={link} />
              <div style={{ minWidth: 0 }}>
                <h2 className='k-h3'>{link.title || link.domain}</h2>
                <a className='k-link k-small k-clip' href={link.url} target='_blank' rel='noopener noreferrer'>{link.url}</a>
              </div>
            </div>

            {st || link.error ? (
              <div className='k-alert'>
                {st ? <State tone={st[0]}>{st[1]}</State> : null}
                <span className='k-small'>{link.dead ? link.dead_reason || 'Did not answer the last check.' : link.error}</span>
              </div>
            ) : null}

            <fieldset className='k-access-pick'>
              <legend><b>Who can open it</b></legend>
              {ACCESS.map(([tier, label, hint]) => (
                <label key={tier} className='k-radio'>
                  <input type='radio' name='access' value={tier} checked={form.access === tier} onChange={() => setForm({ ...form, access: tier })} />
                  <span><b>{label}</b><span className='k-small k-dim'>{hint}</span></span>
                </label>
              ))}
              <p className='k-small k-muted' style={{ margin: '4px 0 0' }}>
                Right now: {visibility({ ...link, ...form }, locks).why}
              </p>
            </fieldset>
            <div className='k-setting'>
              <div>
                <b>Featured</b>
                <span className='k-small k-dim'>Shown on the homepage and at the top of Explore, to whoever can open it.</span>
              </div>
              <Toggle on={form.featured} label='Featured' onChange={(v) => setForm({ ...form, featured: v })} />
            </div>
            <div className='k-setting'>
              <div>
                <b>Starred</b>
                <span className='k-small k-dim'>Your strongest picks. Agents rank them higher.</span>
              </div>
              <Toggle on={form.starred} label='Starred' onChange={(v) => setForm({ ...form, starred: v })} />
            </div>
            <div className='k-setting'>
              <div>
                <b>Open source</b>
                <span className='k-small k-dim'>Shown as Open source on Explore.</span>
              </div>
              <Toggle on={form.is_open_source} label='Open source' onChange={(v) => setForm({ ...form, is_open_source: v })} />
            </div>

            <div className='k-form'>
              <label className='k-label' htmlFor='f-title'>Name</label>
              <input id='f-title' className='k-input' value={form.title} onChange={set('title')} />

              <label className='k-label' htmlFor='f-sum'>One-line summary</label>
              <textarea id='f-sum' className='k-input' rows={3} value={form.summary} onChange={set('summary')} />

              <div className='k-form-2'>
                <div className='k-form'>
                  <label className='k-label' htmlFor='f-cat'>Category</label>
                  <select id='f-cat' className='k-input' value={form.category} onChange={set('category')}>
                    <option value=''>None</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className='k-form'>
                  <label className='k-label' htmlFor='f-type'>Kind</label>
                  <select id='f-type' className='k-input' value={form.type} onChange={set('type')}>
                    <option value=''>Not set</option>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className='k-form'>
                  <label className='k-label' htmlFor='f-price'>Pricing</label>
                  <select id='f-price' className='k-input' value={form.pricing} onChange={set('pricing')}>
                    {PRICING.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              <label className='k-label' htmlFor='f-tags'>Tags, separated by commas</label>
              <input id='f-tags' className='k-input' value={form.tags} onChange={set('tags')} />

              <label className='k-label' htmlFor='f-note'>Curator note. Never shown to members or agents.</label>
              <textarea id='f-note' className='k-input' rows={3} value={form.note} onChange={set('note')} placeholder='Why it is in the catalogue, where you used it' />
            </div>

            <dl className='k-facts'>
              <div><dt>Added</dt><dd>{date(link.created_at)}</dd></div>
              <div><dt>Saved from</dt><dd>{link.source || 'web'}</dd></div>
              <div><dt>Last changed</dt><dd>{ago(link.updated_at)}</dd></div>
              <div><dt>Link last checked</dt><dd>{ago(link.checked_at)}</dd></div>
              {link.repo_stars != null ? <div><dt>GitHub stars</dt><dd>{link.repo_stars.toLocaleString()}</dd></div> : null}
            </dl>

            <div className='k-d-actions k-sheet-actions'>
              <button type='submit' className='k-btn k-btn-brass' disabled={saving}>{saving ? 'Saving' : 'Save changes'}</button>
              <button type='button' className='k-btn' onClick={reread}>Read again with AI</button>
              <a className='k-btn' href={'/explore?open=' + id} target='_blank' rel='noopener'>View on Explore</a>
              <button type='button' className='k-btn k-btn-danger' onClick={remove}>Delete</button>
            </div>
          </form>
        )}
      </aside>
    </>
  );
}
