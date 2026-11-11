'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { CheckIcon, NodesIcon } from './icons';
import { track } from './track';

/**
 * "Add to project" on an entry, for Premium members: pick a project, then one
 * of its folders. A disclosure, not a menu: plain buttons in tab order, and
 * Escape or a click outside closes it.
 */
export default function AddToProject({ link }) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState({}); // folder id -> true
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState('');
  const wrap = useRef(null);
  const button = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    if (!projects) {
      fetch('/api/projects')
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'Projects did not load.');
          setProjects(j.projects || []);
        })
        .catch((e) => setError(e.message));
    }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, projects]);

  const add = async (project, folder) => {
    setBusy(folder.id);
    setStatus('');
    try {
      const r = await fetch('/api/projects/' + project.id + '/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folder_id: folder.id, link_id: link.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That did not save.');
      setDone((d) => ({ ...d, [folder.id]: true }));
      setStatus((j.already ? 'Already in ' : 'Added to ') + project.name + ' / ' + folder.name + '.');
      track('project_skill_added', { from: 'entry' });
    } catch (e) {
      setStatus(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className='k-acct k-a2p' ref={wrap}>
      <button ref={button} type='button' className='k-btn' aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <NodesIcon /> Add to project
      </button>
      {open ? (
        <div className='k-acct-pop k-a2p-pop' id={id}>
          {error ? (
            <p className='k-error k-small'>{error}</p>
          ) : !projects ? (
            <p className='k-small k-dim' style={{ margin: 8 }}>Loading your projects</p>
          ) : !projects.length ? (
            <div style={{ padding: 8, display: 'grid', gap: 8 }}>
              <span className='k-small k-muted'>No projects yet.</span>
              <Link className='k-btn k-btn-sm k-btn-accent' href='/projects?new=1'>Make a project</Link>
            </div>
          ) : (
            projects.map((p) => (
              <div key={p.id} className='k-a2p-proj'>
                <b>{p.name}</b>
                {p.folders.length ? (
                  <div className='k-a2p-folders'>
                    {p.folders.map((f) => (
                      <button key={f.id} type='button' className='k-a2p-folder' style={{ '--tone': f.tone }} disabled={busy === f.id} onClick={() => add(p, f)}>
                        <span className='k-pj-node' aria-hidden='true' />
                        {f.name}
                        {done[f.id] ? <CheckIcon size={12} /> : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <Link className='k-small k-link' href={'/projects/' + p.slug}>Add a folder first</Link>
                )}
              </div>
            ))
          )}
          <p className='k-small k-dim k-a2p-status' role='status' aria-live='polite'>{status}</p>
        </div>
      ) : null}
    </div>
  );
}
