'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TYPE_LABELS, slugOf } from '@/lib/labels';
import { PRESETS, QUICK_FOLDERS, LIMITS, hintOf, queryOf, kindForName, templateOf } from '@/lib/projectTemplates';
import { Fav } from '../../_ui/EntryCard';
import CodeBox from '../../_ui/CodeBox';
import { CheckIcon, CloseIcon, GripIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon, UpIcon } from '../../_ui/icons';
import { track } from '../../_ui/track';
import ProjectMap, { DRAG_TYPE } from '../ProjectMap';

// One project: the map, its folders and what is filed in them, and a search
// panel that files catalogue entries into the folder you are working on.
// Every change is shown at once and saved in the background; if the server
// says no, the change is put back and the reason is announced.

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
};

export default function Workspace({ initial, agent }) {
  const router = useRouter();
  const [project, setProject] = useState(initial.project);
  const [folders, setFolders] = useState(initial.folders);
  const [active, setActive] = useState(initial.folders[0]?.id || null);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toastTimer = useRef(null);

  const say = useCallback((text, bad = false) => {
    clearTimeout(toastTimer.current);
    setToast({ text, bad });
    toastTimer.current = setTimeout(() => setToast(null), 3400);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const call = useCallback(async (method, path, payload) => {
    const res = await fetch('/api/projects/' + project.id + path, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'That did not save. Try again.');
    return j;
  }, [project.id]);

  const activeFolder = folders.find((f) => f.id === active) || null;
  const skills = folders.reduce((n, f) => n + f.items.length, 0);

  /* ------------------------------------------------------------ skills */

  const addSkill = async (folderId, link) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    if (folder.items.some((i) => i.link_id === link.id)) return say(link.title + ' is already in ' + folder.name + '.');
    if (folder.items.length >= LIMITS.perFolder) return say('A folder holds up to ' + LIMITS.perFolder + ' skills.', true);
    const item = { link_id: link.id, note: '', link, locked: false };
    setFolders((fs) => fs.map((f) => (f.id === folderId ? { ...f, items: [...f.items, item] } : f)));
    try {
      await call('POST', '/items', { folder_id: folderId, link_id: link.id });
      say('Added ' + link.title + ' to ' + folder.name + '.');
      track('project_skill_added', { kind: folder.kind });
    } catch (e) {
      setFolders((fs) => fs.map((f) => (f.id === folderId ? { ...f, items: f.items.filter((i) => i.link_id !== link.id) } : f)));
      say(e.message, true);
    }
  };

  const removeSkill = async (folderId, linkId) => {
    const before = folders;
    const item = folders.find((f) => f.id === folderId)?.items.find((i) => i.link_id === linkId);
    setFolders((fs) => fs.map((f) => (f.id === folderId ? { ...f, items: f.items.filter((i) => i.link_id !== linkId) } : f)));
    try {
      await call('DELETE', '/items?folder_id=' + encodeURIComponent(folderId) + '&link_id=' + linkId);
      say('Removed ' + (item?.link?.title || 'it') + '.');
    } catch (e) {
      setFolders(before);
      say(e.message, true);
    }
  };

  const moveSkill = async (fromId, linkId, toId) => {
    if (fromId === toId) return;
    const from = folders.find((f) => f.id === fromId);
    const to = folders.find((f) => f.id === toId);
    const item = from?.items.find((i) => i.link_id === linkId);
    if (!from || !to || !item) return;
    if (to.items.some((i) => i.link_id === linkId)) return say(to.name + ' already has ' + (item.link.title || 'this skill') + '.');
    const before = folders;
    setFolders((fs) => fs.map((f) => {
      if (f.id === fromId) return { ...f, items: f.items.filter((i) => i.link_id !== linkId) };
      if (f.id === toId) return { ...f, items: [...f.items, item] };
      return f;
    }));
    try {
      await call('PATCH', '/items', { folder_id: fromId, link_id: linkId, to_folder_id: toId });
      say('Moved ' + (item.link.title || 'it') + ' to ' + to.name + '.');
    } catch (e) {
      setFolders(before);
      say(e.message, true);
    }
  };

  const saveNote = async (folderId, linkId, note) => {
    const before = folders;
    setFolders((fs) => fs.map((f) => (f.id === folderId ? { ...f, items: f.items.map((i) => (i.link_id === linkId ? { ...i, note } : i)) } : f)));
    try {
      await call('PATCH', '/items', { folder_id: folderId, link_id: linkId, note });
      say('Note saved.');
    } catch (e) {
      setFolders(before);
      say(e.message, true);
    }
  };

  const onDrop = (toId, e) => {
    let data;
    try {
      data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
    } catch {
      return;
    }
    if (!data?.link?.id) return;
    if (data.from) moveSkill(data.from, data.link.id, toId);
    else addSkill(toId, data.link);
    setActive(toId);
  };

  /* ------------------------------------------------------------ folders */

  const addFolder = async (name, kind) => {
    const { folder } = await call('POST', '/folders', { name, kind });
    setFolders((fs) => [...fs, { ...folder, items: [] }]);
    setActive(folder.id);
    say('Added the ' + folder.name + ' folder.');
    track('project_folder_added', { kind: folder.kind });
  };

  const renameFolder = async (id, name) => {
    const before = folders;
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)));
    try {
      const { folder } = await call('PATCH', '/folders', { folder_id: id, name });
      setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name: folder.name } : f)));
    } catch (e) {
      setFolders(before);
      say(e.message, true);
    }
  };

  const moveFolder = async (id, dir) => {
    const i = folders.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= folders.length) return;
    const before = folders;
    const next = folders.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setFolders(next);
    try {
      await call('PATCH', '/folders', { order: next.map((f) => f.id) });
    } catch (e) {
      setFolders(before);
      say(e.message, true);
    }
  };

  const deleteFolder = async (id) => {
    const before = folders;
    const f = folders.find((x) => x.id === id);
    setFolders((fs) => fs.filter((x) => x.id !== id));
    if (active === id) setActive(folders.find((x) => x.id !== id)?.id || null);
    try {
      await call('DELETE', '/folders?folder_id=' + encodeURIComponent(id));
      say('Deleted the ' + (f?.name || '') + ' folder.');
    } catch (e) {
      setFolders(before);
      say(e.message, true);
    }
  };

  /* ------------------------------------------------------------ project */

  const saveProject = async (patch) => {
    const { project: p } = await call('PATCH', '', patch);
    setProject((cur) => ({ ...cur, ...p }));
    setEditing(false);
    say('Project saved.');
  };

  const removeProject = async () => {
    try {
      await call('DELETE', '');
      track('project_deleted');
      router.push('/projects');
      router.refresh();
    } catch (e) {
      say(e.message, true);
      setConfirmDelete(false);
    }
  };

  const kind = templateOf(project.template);

  return (
    <>
      <nav className='k-crumbs' aria-label='Breadcrumb'>
        <Link href='/account'>Profile</Link><span aria-hidden='true'>/</span>
        <Link href='/projects'>Projects</Link><span aria-hidden='true'>/</span>
        <span aria-current='page'>{project.name}</span>
      </nav>

      <header className='k-pj-head'>
        {editing ? (
          <ProjectForm project={project} onSave={saveProject} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <div className='k-pj-title'>
              <span className='k-eyebrow'>{kind.key === 'blank' ? 'Project' : kind.label}</span>
              <h1 className='k-h1'>{project.name}</h1>
              {project.description ? <p className='k-lede'>{project.description}</p> : null}
              <p className='k-pj-stats'>
                <span>{folders.length} {folders.length === 1 ? 'folder' : 'folders'}</span>
                <span>{skills} {skills === 1 ? 'skill' : 'skills'}</span>
                <span>Edited {ago(project.updated_at)}</span>
              </p>
            </div>
            <div className='k-pj-head-acts'>
              <button type='button' className='k-btn k-btn-sm' onClick={() => setEditing(true)}><PencilIcon /> Edit</button>
              {confirmDelete ? (
                <span className='k-pj-confirm' role='group' aria-label='Confirm delete'>
                  <button type='button' className='k-btn k-btn-sm k-btn-danger' onClick={removeProject}>Delete for good</button>
                  <button type='button' className='k-btn k-btn-sm k-btn-quiet' onClick={() => setConfirmDelete(false)}>Keep it</button>
                </span>
              ) : (
                <button type='button' className='k-btn k-btn-sm k-btn-quiet' onClick={() => setConfirmDelete(true)}><TrashIcon /> Delete</button>
              )}
            </div>
          </>
        )}
      </header>

      <section className='k-pj-mapbox' aria-label='Project map'>
        <ProjectMap name={project.name} folders={folders} selected={active} onSelect={setActive} onDrop={onDrop} />
        <p className='k-pj-maphint k-small k-dim'>Select a folder to fill it. Drag a skill onto any folder to file or move it.</p>
      </section>

      <div className='k-pj-work'>
        <section className='k-pj-folders' aria-labelledby='pj-folders-h'>
          <h2 id='pj-folders-h' className='k-sr'>Folders</h2>
          {folders.map((f, i) => (
            <Folder
              key={f.id}
              folder={f}
              folders={folders}
              active={active === f.id}
              first={i === 0}
              last={i === folders.length - 1}
              onSelect={() => setActive(f.id)}
              onRename={(name) => renameFolder(f.id, name)}
              onMove={(dir) => moveFolder(f.id, dir)}
              onDelete={() => deleteFolder(f.id)}
              onRemove={(linkId) => removeSkill(f.id, linkId)}
              onMoveSkill={(linkId, to) => moveSkill(f.id, linkId, to)}
              onNote={(linkId, note) => saveNote(f.id, linkId, note)}
              onDrop={onDrop}
            />
          ))}
          <NewFolder folders={folders} onAdd={addFolder} onError={(m) => say(m, true)} />
        </section>

        <Finder folder={activeFolder} folders={folders} onAdd={addSkill} onPick={setActive} />
      </div>

      <AgentPanel project={project} agent={agent} skills={skills} />

      <div className='k-toasts' role='status' aria-live='polite'>
        {toast ? <div className={'k-toast' + (toast.bad ? ' k-toast-bad' : '')}>{toast.text}</div> : null}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- pieces */

function ProjectForm({ project, onSave, onCancel }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({ name, description });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className='k-pj-form' onSubmit={submit}>
      <label className='k-label' htmlFor='pj-name'>Name</label>
      <input id='pj-name' className='k-input' value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} autoFocus />
      <label className='k-label' htmlFor='pj-desc'>What it is</label>
      <textarea id='pj-desc' className='k-input' rows={2} value={description} maxLength={400} onChange={(e) => setDescription(e.target.value)} />
      <p className='k-small k-dim' style={{ margin: 0 }}>Renaming keeps the address <code>{project.slug}</code>, so agents set up with it still find the project.</p>
      {error ? <p className='k-error' role='alert'>{error}</p> : null}
      <div className='k-d-actions'>
        <button className='k-btn k-btn-sm k-btn-accent' type='submit' disabled={busy || !name.trim()}>{busy ? 'Saving' : 'Save'}</button>
        <button className='k-btn k-btn-sm k-btn-quiet' type='button' onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Folder({ folder, folders, active, first, last, onSelect, onRename, onMove, onDelete, onRemove, onMoveSkill, onNote, onDrop }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [over, setOver] = useState(false);
  const [sure, setSure] = useState(false);
  const hint = hintOf(folder);

  useEffect(() => setName(folder.name), [folder.name]);

  const accepts = (e) => Array.from(e.dataTransfer?.types || []).includes(DRAG_TYPE);
  const commit = () => {
    const n = name.trim();
    setRenaming(false);
    if (n && n !== folder.name) onRename(n);
    else setName(folder.name);
  };

  return (
    <section
      className={'k-pj-folder' + (active ? ' is-active' : '') + (over ? ' is-over' : '')}
      style={{ '--tone': folder.tone }}
      aria-label={folder.name + ' folder'}
      onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { if (accepts(e)) { e.preventDefault(); setOver(false); onDrop(folder.id, e); } }}
    >
      <div className='k-pj-folder-head'>
        <span className='k-pj-node' aria-hidden='true' />
        {renaming ? (
          <input
            className='k-input k-input-sm k-pj-rename'
            value={name}
            maxLength={40}
            aria-label='Folder name'
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setName(folder.name); setRenaming(false); }
            }}
          />
        ) : (
          <button type='button' className='k-pj-folder-name' aria-pressed={active} onClick={onSelect}>
            {folder.name}
            <span className='k-pj-count'>{folder.items.length}</span>
          </button>
        )}
        <span className='k-pj-sp' />
        <div className='k-pj-tools'>
          {sure ? (
            <>
              <button type='button' className='k-btn k-btn-sm k-btn-danger' onClick={onDelete}>
                Delete{folder.items.length ? ' with ' + folder.items.length + (folder.items.length === 1 ? ' skill' : ' skills') : ''}
              </button>
              <button type='button' className='k-btn k-btn-sm k-btn-quiet' onClick={() => setSure(false)}>Keep</button>
            </>
          ) : (
            <>
              <button type='button' className='k-icon-btn' aria-label={'Rename ' + folder.name} title='Rename' onClick={() => setRenaming(true)}><PencilIcon /></button>
              <button type='button' className='k-icon-btn' aria-label={'Move ' + folder.name + ' up'} title='Move up' disabled={first} onClick={() => onMove(-1)}><UpIcon /></button>
              <button type='button' className='k-icon-btn' aria-label={'Move ' + folder.name + ' down'} title='Move down' disabled={last} onClick={() => onMove(1)}><UpIcon down /></button>
              <button type='button' className='k-icon-btn' aria-label={'Delete ' + folder.name} title='Delete folder' onClick={() => setSure(true)}><TrashIcon /></button>
            </>
          )}
        </div>
      </div>
      {hint ? <p className='k-pj-hint'>{hint}</p> : null}

      {folder.items.length ? (
        <ul className='k-pj-skills'>
          {folder.items.map((i) => (
            <Skill
              key={i.link_id}
              item={i}
              folder={folder}
              folders={folders}
              onRemove={() => onRemove(i.link_id)}
              onMove={(to) => onMoveSkill(i.link_id, to)}
              onNote={(note) => onNote(i.link_id, note)}
            />
          ))}
        </ul>
      ) : (
        <button type='button' className='k-pj-drop' onClick={onSelect}>
          {active ? 'Pick skills from the suggestions, or drag them here.' : 'Empty. Select to fill it.'}
        </button>
      )}
    </section>
  );
}

function Skill({ item, folder, folders, onRemove, onMove, onNote }) {
  const [note, setNote] = useState(item.note || '');
  useEffect(() => setNote(item.note || ''), [item.note]);
  const link = item.link || {};
  const others = folders.filter((f) => f.id !== folder.id);

  if (item.locked) {
    return (
      <li className='k-pj-skill is-locked'>
        <span className='k-pj-skill-main'>
          <b>Locked entry</b>
          <span className='k-small k-dim'>Not open to your plan any more.</span>
        </span>
        <button type='button' className='k-icon-btn' aria-label='Remove locked entry' onClick={onRemove}><CloseIcon size={14} /></button>
      </li>
    );
  }

  const saveIfChanged = () => {
    const n = note.trim();
    if (n !== (item.note || '')) onNote(n);
  };

  return (
    <li
      className='k-pj-skill'
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ from: folder.id, link }));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <span className='k-pj-grip' aria-hidden='true'><GripIcon /></span>
      <Fav item={link} size={34} />
      <span className='k-pj-skill-main'>
        <span className='k-pj-skill-top'>
          <a href={'/explore/' + slugOf(link)} target='_blank' rel='noopener'>{link.title}</a>
          <span className='k-small k-dim'>{TYPE_LABELS[link.type] || 'Entry'}</span>
          {link.dead ? <span className='k-small' style={{ color: 'var(--color-danger)' }}>Link unreachable</span> : null}
        </span>
        <input
          className='k-pj-note'
          value={note}
          maxLength={280}
          placeholder='Why it is here, for your agent'
          aria-label={'Why ' + link.title + ' is in ' + folder.name}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveIfChanged}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        />
      </span>
      {others.length ? (
        <select className='k-select k-pj-move' aria-label={'Move ' + link.title + ' to another folder'} value='' onChange={(e) => e.target.value && onMove(e.target.value)}>
          <option value=''>Move to…</option>
          {others.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      ) : null}
      <button type='button' className='k-icon-btn' aria-label={'Remove ' + link.title + ' from ' + folder.name} title='Remove' onClick={onRemove}><CloseIcon size={14} /></button>
    </li>
  );
}

function NewFolder({ folders, onAdd, onError }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const full = folders.length >= LIMITS.folders;
  const have = new Set(folders.map((f) => f.name.toLowerCase()));
  const quick = QUICK_FOLDERS.filter((k) => !have.has(PRESETS[k].name.toLowerCase())).slice(0, 6);

  const add = async (n, kind) => {
    if (!n.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(n.trim(), kind || kindForName(n));
      setName('');
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (full) return <p className='k-small k-dim'>This project has {LIMITS.folders} folders, the most it can hold.</p>;

  return (
    <div className='k-pj-new'>
      <form className='k-field' onSubmit={(e) => { e.preventDefault(); add(name); }}>
        <label className='k-sr' htmlFor='pj-new-folder'>New folder name</label>
        <input id='pj-new-folder' value={name} maxLength={40} placeholder='New folder, e.g. Payments or SEO' onChange={(e) => setName(e.target.value)} />
        <button className='k-btn' type='submit' disabled={busy || !name.trim()}><PlusIcon /> Add folder</button>
      </form>
      {quick.length ? (
        <div className='k-suggest'>
          <span>Quick add</span>
          {quick.map((k) => (
            <button key={k} type='button' className='k-chip' disabled={busy} onClick={() => add(PRESETS[k].name, k)}>{PRESETS[k].name}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Search the catalogue for the folder being filled. Starts on that folder's own suggestions. */
function Finder({ folder, folders, onAdd, onPick }) {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const query = q || (folder ? queryOf(folder) : '');

  useEffect(() => {
    if (!query) { setResults(null); return; }
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    fetch('/api/catalog?q=' + encodeURIComponent(query.slice(0, 200)) + '&limit=12')
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Search did not load.');
        if (n === seq.current) setResults(j.items || []);
      })
      .catch((e) => { if (n === seq.current) setError(e.message); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [query]);

  if (!folders.length) {
    return (
      <aside className='k-pj-finder'>
        <h2 className='k-h3'>Add skills</h2>
        <p className='k-muted'>Make a folder first, such as Frontend or Backend. Then search for the skills it needs.</p>
      </aside>
    );
  }

  return (
    <aside className='k-pj-finder' aria-labelledby='pj-find-h' style={folder ? { '--tone': folder.tone } : undefined}>
      <div className='k-pj-finder-head'>
        <h2 id='pj-find-h' className='k-h3'>Add skills</h2>
        <label className='k-pj-target'>
          <span className='k-small k-dim'>to</span>
          <select className='k-select' value={folder?.id || ''} onChange={(e) => onPick(e.target.value)} aria-label='Folder to add to'>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      </div>
      <form className='k-search k-pj-search' role='search' onSubmit={(e) => { e.preventDefault(); setQ(input.trim()); }}>
        <SearchIcon />
        <label className='k-sr' htmlFor='pj-q'>Search the library</label>
        <input id='pj-q' type='search' value={input} onChange={(e) => setInput(e.target.value)} placeholder={'Search for ' + (folder?.name || 'this folder')} autoComplete='off' />
      </form>
      <p className='k-small k-dim' aria-live='polite' style={{ margin: 0 }}>
        {loading ? 'Searching' : q ? 'Best matches for “' + q + '”' : folder ? 'Suggested for ' + folder.name : ''}
      </p>
      {error ? <p className='k-error' role='alert'>{error}</p> : null}
      <ul className='k-pj-results'>
        {(results || []).map((r) => {
          const has = folder?.items.some((i) => i.link_id === r.id);
          return (
            <li
              key={r.id}
              className='k-pj-result'
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ from: null, link: r }));
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <Fav item={r} size={34} />
              <span className='k-pj-skill-main'>
                <a href={'/explore/' + slugOf(r)} target='_blank' rel='noopener'>{r.title}</a>
                <span className='k-pj-result-sum'>{r.summary || r.description}</span>
              </span>
              <button
                type='button'
                className={'k-btn k-btn-sm' + (has ? ' k-btn-quiet' : '')}
                disabled={has || !folder}
                aria-label={has ? r.title + ' is in ' + folder?.name : 'Add ' + r.title + ' to ' + folder?.name}
                onClick={() => onAdd(folder.id, r)}
              >
                {has ? <><CheckIcon /> Added</> : <><PlusIcon /> Add</>}
              </button>
            </li>
          );
        })}
      </ul>
      {results && !results.length && !loading ? <p className='k-muted k-small'>Nothing matches. Describe the job instead of a product name.</p> : null}
    </aside>
  );
}

function AgentPanel({ project, agent, skills }) {
  const snippet =
    '## Stash project\n' +
    'This repository is the Stash project "' + project.name + '".\n' +
    'Before choosing a library, skill or tool, call the Stash MCP tool get_project with\n' +
    'stash_project "' + project.slug + '" and use what is filed there, folder by folder, as the\n' +
    'standard for this project. File new picks with add_to_project once I agree.';
  const say = 'I’m working on my Stash project “' + project.name + '”. Use its skills.';

  return (
    <section className='k-block k-pj-agent' aria-labelledby='pj-agent-h'>
      <div className='k-block-row'>
        <div className='k-block-head'>
          <h2 id='pj-agent-h' className='k-h3'>Use it in your agent</h2>
          <p className='k-muted' style={{ margin: 0 }}>
            Your agent reads this project over MCP with <code>get_project</code>, so every session on {project.name} reaches for the same {skills === 1 ? 'skill' : skills + ' skills'}.
          </p>
        </div>
        <span className={'k-state' + (agent.connected ? ' k-state-ok' : ' k-state-warn')}>
          <span className='k-dot' aria-hidden='true' />
          {agent.connected ? 'Agent connected' : 'No agent connected yet'}
        </span>
      </div>
      <ol className='k-guide'>
        <li>
          <b>Say it in chat</b>
          <span>Start a session with this, in Claude, Cursor, Copilot or any MCP client:</span>
          <CodeBox text={say} />
        </li>
        <li>
          <b>Or make it permanent</b>
          <span>Paste this into the repo’s <code>AGENTS.md</code>, <code>CLAUDE.md</code> or <code>.cursorrules</code>, and every session starts from the project.</span>
          <CodeBox text={snippet} />
        </li>
        <li>
          <b>{agent.connected ? 'Connected' : 'Connect your agent'}</b>
          <span>
            {agent.connected
              ? 'Stash last answered your agent ' + (agent.lastClient ? 'in ' + agent.lastClient + ' ' : '') + 'recently. Nothing else to set up.'
              : 'Projects reach your agent through the Stash MCP server.'}{' '}
            <Link className='k-link' href='/connect'>{agent.connected ? 'Manage keys' : 'Set it up in a few minutes'}</Link>
          </span>
        </li>
      </ol>
    </section>
  );
}
