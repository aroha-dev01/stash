'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TYPE_LABELS } from '@/lib/labels';
import { TOOLKITS } from '@/lib/taxonomy';
import { PRO } from '@/lib/plans';
import AccessBadge from '../_ui/AccessBadge';
import CodeBox from '../_ui/CodeBox';
import { Fav } from '../_ui/EntryCard';
import { BookmarkIcon, ExternalIcon, LockIcon } from '../_ui/icons';
import { startGoogleSignIn } from '../_ui/signin';
import { track } from '../_ui/track';

const PRICE = { 'open-source': 'Open source', free: 'Free', freemium: 'Freemium', paid: 'Paid' };
const WHO = {
  public: 'Anyone can open it.',
  free: 'Free with a Stash account. Your agent sees it once you connect.',
  premium: 'Part of ' + PRO.name + '. Your agent sees it when you are on ' + PRO.name + '.',
};

const kitOf = (key) => TOOLKITS.find((t) => t.key === key);

/** Everything about one entry. The Explore drawer and /explore/[slug] both use it. */
export default function EntryDetail({ link, signedIn, headingLevel = 2, onSaved }) {
  const [saved, setSaved] = useState(!!link.saved);
  const [img, setImg] = useState(true);
  const H = 'h' + headingLevel;
  const kit = kitOf(link.toolkit);
  const kind = TYPE_LABELS[link.type] || 'Entry';

  if (link.locked) return <LockedEntry link={link} kind={kind} kit={kit} H={H} />;

  const save = async () => {
    const next = !saved;
    setSaved(next);
    const res = next
      ? await fetch('/api/saves', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ link_id: link.id }) })
      : await fetch('/api/saves?link_id=' + link.id, { method: 'DELETE' });
    if (res.ok) onSaved?.(link.id, next);
    else setSaved(!next);
  };

  const facts = [
    ['Pricing', PRICE[link.pricing] || null],
    ['Licence', link.repo_license],
    ['Language', link.repo_language],
    ['GitHub stars', link.repo_stars != null ? Number(link.repo_stars).toLocaleString() : null],
    ['Setup effort', link.integration_effort && link.integration_effort !== 'unknown' ? link.integration_effort.replace(/-/g, ' ') : null],
    ['Maturity', link.maturity && link.maturity !== 'unknown' ? link.maturity : null],
  ].filter(([, v]) => v);

  const reference = link.type === 'reference' || link.type === 'article';

  return (
    <>
      {link.image && img ? (
        <div className='k-d-hero'><img src={link.image} alt={'Preview of ' + link.title} referrerPolicy='no-referrer' onError={() => setImg(false)} /></div>
      ) : null}

      <div className='k-d-title'>
        <Fav item={link} size={48} />
        <div style={{ minWidth: 0 }}>
          <H>{link.title}</H>
          {link.domain ? <span className='k-dim k-small'>{link.domain}</span> : null}
        </div>
      </div>

      <div className='k-d-meta'>
        <span className='k-pill'>{kind}</span>
        {kit ? <Link className='k-pill' href={'/explore?toolkit=' + kit.key}>{kit.label}</Link> : null}
        {link.category ? <span className='k-pill'>{link.category}</span> : null}
        <AccessBadge tier={link.access} />
        {link.is_open_source ? <span className='k-card-oss'>Open source</span> : null}
      </div>

      {link.summary || link.description ? <p className='k-lede' style={{ color: 'var(--color-text-primary)' }}>{link.summary || link.description}</p> : null}
      {link.description && link.summary && link.description !== link.summary ? <p className='k-muted' style={{ margin: 0 }}>{link.description}</p> : null}

      <div className='k-d-actions'>
        <a className='k-btn k-btn-primary' href={link.url} target='_blank' rel='noopener noreferrer'>
          Visit {link.domain || 'site'} <ExternalIcon />
        </a>
        {link.repo_owner ? (
          <a className='k-btn' href={'https://github.com/' + link.repo_owner + '/' + link.repo_name} target='_blank' rel='noopener noreferrer'>
            Repository <ExternalIcon />
          </a>
        ) : null}
        {signedIn ? (
          <button type='button' className='k-btn' aria-pressed={saved} onClick={save}>
            <BookmarkIcon filled={saved} size={16} /> {saved ? 'Saved' : 'Save'}
          </button>
        ) : (
          <Link className='k-btn k-btn-quiet' href={'/login?next=' + encodeURIComponent('/explore?open=' + link.id)}>Sign in to save</Link>
        )}
      </div>

      {link.use_cases?.length ? (
        <div className='k-d-sec'>
          <h3>What it is useful for</h3>
          <ul>{link.use_cases.slice(0, 5).map((u) => <li key={u}>{u}</li>)}</ul>
        </div>
      ) : null}

      <div className='k-d-sec'>
        <h3>{reference ? 'How to use it' : 'Install'}</h3>
        {link.install ? (
          <CodeBox text={link.install} />
        ) : (
          <p className='k-muted'>
            {reference ? 'A reference to read for ideas. There is nothing to install.' : 'No install command was captured. Follow the setup on its own site.'}
          </p>
        )}
      </div>

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

      {link.tags?.length ? (
        <div className='k-d-sec'>
          <h3>Tags</h3>
          <div className='k-pills'>
            {link.tags.slice(0, 10).map((t) => <Link key={t} className='k-pill' href={'/explore?q=' + encodeURIComponent(t.replace(/-/g, ' '))}>{t.replace(/-/g, ' ')}</Link>)}
          </div>
        </div>
      ) : null}

      <div className='k-d-sec'>
        <h3>Access</h3>
        <p className='k-muted'>{WHO[link.access] || WHO.public}</p>
      </div>

      {facts.length ? (
        <dl className='k-facts'>
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      ) : null}
    </>
  );
}

/** A useful preview of what is behind the lock, and the one step that opens it. */
function LockedEntry({ link, kind, kit, H }) {
  const [busy, setBusy] = useState(false);
  const pro = link.needs === 'pro';
  const signIn = async () => {
    setBusy(true);
    const error = await startGoogleSignIn('/explore?open=' + link.id, 'locked-entry');
    if (error) setBusy(false);
  };

  return (
    <div className='k-locked'>
      <span className='k-locked-icon'><LockIcon size={18} /></span>
      <div className='k-d-meta'>
        <span className='k-pill'>{kind}</span>
        {kit ? <span className='k-pill'>{kit.label}</span> : null}
        <AccessBadge tier={pro ? 'premium' : 'free'} />
      </div>
      <H className='k-h2'>{pro ? 'This entry is part of ' + PRO.name : 'This entry is for members'}</H>
      <p>
        {pro
          ? (kit?.pitch ? kit.pitch + ' ' : '') + PRO.name + ' opens it on the web and in your agent, together with AI recommendations.'
          : 'Sign in free with Google to see what it does, how to install it and when to skip it, and to let your agent find it.'}
      </p>
      <div className='k-locked-acts'>
        {pro ? (
          <Link className='k-btn k-btn-accent' href={'/upgrade?entry=' + link.id} onClick={() => track('premium_locked_clicked', { from: 'locked-entry' })}>Explore {PRO.name}</Link>
        ) : (
          <button type='button' className='k-btn k-btn-accent' onClick={signIn} disabled={busy}>{busy ? 'Opening Google' : 'Sign in free with Google'}</button>
        )}
        <Link className='k-btn' href={kit ? '/explore?toolkit=' + kit.key : '/explore'}>Browse what is open</Link>
      </div>
    </div>
  );
}
