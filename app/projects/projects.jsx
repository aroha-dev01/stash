'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TEMPLATES, PRESETS, TONES, LIMITS, templateOf } from '@/lib/projectTemplates';
import { ArrowIcon, PlusIcon } from '../_ui/icons';
import { track } from '../_ui/track';
import ProjectMap from './ProjectMap';

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
};

export default function ProjectsHome({ initial, startOpen }) {
  const [creating, setCreating] = useState(startOpen || !initial.length);
  const full = initial.length >= LIMITS.projects;

  return (
    <>
      {creating && !full ? (
        <Creator onCancel={initial.length ? () => setCreating(false) : null} />
      ) : (
        <div className='k-pj-bar'>
          <span className='k-muted'>{initial.length} {initial.length === 1 ? 'project' : 'projects'}{full ? ', the most there can be' : ''}</span>
          {full ? null : (
            <button type='button' className='k-btn k-btn-accent' onClick={() => setCreating(true)}><PlusIcon /> New project</button>
          )}
        </div>
      )}

      {initial.length ? (
        <ul className='k-pj-cards'>
          {initial.map((p) => (
            <li key={p.id} className='k-pj-card'>
              <ProjectMap name={p.name} folders={p.folders} mini />
              <div className='k-pj-card-body'>
                <span className='k-small k-dim'>{templateOf(p.template).key === 'blank' ? 'Project' : templateOf(p.template).label}</span>
                <h2 className='k-h3'><Link className='k-card-link' href={'/projects/' + p.slug}>{p.name}</Link></h2>
                {p.description ? <p className='k-card-sum'>{p.description}</p> : null}
                <ul className='k-pj-card-folders' aria-label='Folders'>
                  {p.folders.slice(0, 6).map((f) => (
                    <li key={f.id} style={{ '--tone': f.tone }}>{f.name}<span>{f.count}</span></li>
                  ))}
                  {p.folders.length > 6 ? <li>+{p.folders.length - 6}</li> : null}
                </ul>
                <div className='k-card-foot'>
                  <span className='k-small k-dim'>{p.skills} {p.skills === 1 ? 'skill' : 'skills'} · edited {ago(p.updated_at)}</span>
                  <span className='k-card-sp' />
                  <span className='k-card-go' aria-hidden='true'>Open <ArrowIcon size={14} /></span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Creator({ onCancel }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState('web-app');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description, template }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'The project was not made. Try again.');
      track('project_created', { template });
      router.push('/projects/' + j.project.slug);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const picked = templateOf(template);
  const preview = picked.folders.map((k, i) => ({ id: k + i, name: PRESETS[k].name, tone: TONES[PRESETS[k].tone] || TONES.sage, count: 3 - (i % 3) }));

  return (
    <form className='k-block k-pj-create' onSubmit={submit} aria-labelledby='pj-new-h'>
      <div className='k-pj-create-grid'>
        <div className='k-pj-create-fields'>
          <h2 id='pj-new-h' className='k-h3'>New project</h2>
          <label className='k-label' htmlFor='pj-new-name'>Name</label>
          <input id='pj-new-name' className='k-input' value={name} maxLength={60} required placeholder='ABC website' onChange={(e) => setName(e.target.value)} autoFocus />
          <label className='k-label' htmlFor='pj-new-desc'>What it is <span className='k-dim'>(optional, your agent reads it)</span></label>
          <textarea id='pj-new-desc' className='k-input' rows={2} maxLength={400} value={description} placeholder='Marketing site and booking flow for a dental clinic. Next.js, Supabase.' onChange={(e) => setDescription(e.target.value)} />

          <fieldset className='k-pj-templates'>
            <legend className='k-label'>Start from</legend>
            {TEMPLATES.map((t) => (
              <label key={t.key} className='k-pj-template'>
                <input type='radio' name='template' value={t.key} checked={template === t.key} onChange={() => setTemplate(t.key)} />
                <span>
                  <b>{t.label}</b>
                  <span className='k-small k-dim'>{t.blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>

        <div className='k-pj-create-preview' aria-live='polite'>
          <ProjectMap name={name.trim() || 'New project'} folders={preview} height={300} />
          <p className='k-small k-dim' style={{ margin: 0 }}>
            {picked.folders.length
              ? 'Starts with ' + picked.folders.map((k) => PRESETS[k].name).join(', ') + '. Rename, reorder or add folders any time.'
              : 'Starts empty. Add folders that fit the work.'}
          </p>
        </div>
      </div>

      {error ? <p className='k-error' role='alert'>{error}</p> : null}
      <div className='k-d-actions'>
        <button className='k-btn k-btn-accent' type='submit' disabled={busy || !name.trim()}>{busy ? 'Making it' : 'Create project'}</button>
        {onCancel ? <button className='k-btn k-btn-quiet' type='button' onClick={onCancel}>Cancel</button> : null}
      </div>
    </form>
  );
}
