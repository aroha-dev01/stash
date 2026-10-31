'use client';

import { useState } from 'react';
import { TYPE_LABELS, slugOf } from '@/lib/labels';
import { TOOLKITS } from '@/lib/taxonomy';
import AccessBadge from './AccessBadge';
import { BookmarkIcon } from './icons';

const initials = (t) => String(t || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?';
const toolkitLabel = (key) => TOOLKITS.find((t) => t.key === key)?.label;

/** A site's favicon on a tile, with its initials underneath for when it fails. */
export function Fav({ item, size = 40 }) {
  const [bad, setBad] = useState(false);
  return (
    <span className='k-fav' aria-hidden='true' style={{ width: size, height: size }}>
      {initials(item.title)}
      {item.favicon && !bad ? <img src={item.favicon} alt='' loading='lazy' referrerPolicy='no-referrer' onError={() => setBad(true)} /> : null}
    </span>
  );
}

/**
 * The entry's own preview image, at one ratio for every card. When there is
 * none, or it fails, a quiet panel with its favicon stands in: never stock art.
 */
export function Preview({ item, eager }) {
  const [bad, setBad] = useState(false);
  const show = item.image && !bad;
  return (
    <div className={'k-card-media' + (show ? '' : ' k-card-media-empty')} data-toolkit={item.toolkit}>
      {show ? (
        <img src={item.image} alt='' loading={eager ? 'eager' : 'lazy'} decoding='async' referrerPolicy='no-referrer' onError={() => setBad(true)} />
      ) : (
        <Fav item={item} size={52} />
      )}
    </div>
  );
}

/**
 * One catalogue entry. The whole card is one link to its page; with `onOpen`
 * a plain click opens it in place instead (modified clicks still open the
 * page, so a new tab works). Everything that matters is visible without hover.
 */
export default function EntryCard({ item, size = 'md', onOpen, onSave, signedIn, eager }) {
  const href = '/explore/' + slugOf(item);
  const tags = (item.tags || []).slice(0, size === 'lg' ? 4 : 3);
  const click = (e) => {
    if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(item);
  };

  return (
    <article className={'k-card k-card-' + size}>
      <Preview item={item} eager={eager} />
      <div className='k-card-body'>
        <div className='k-card-meta'>
          <span>{TYPE_LABELS[item.type] || 'Entry'}</span>
          {toolkitLabel(item.toolkit) ? <span className='k-card-kit'>{toolkitLabel(item.toolkit)}</span> : null}
        </div>
        <h3 className='k-card-title'>
          <a href={href} onClick={click} className='k-card-link'>{item.title}</a>
        </h3>
        <p className='k-card-sum'>{item.summary || item.description}</p>
        {tags.length ? (
          <ul className='k-card-tags' aria-label='Tags'>
            {tags.map((t) => <li key={t}>{t.replace(/-/g, ' ')}</li>)}
          </ul>
        ) : null}
        <div className='k-card-foot'>
          <AccessBadge tier={item.access} quiet={item.access === 'public'} />
          {item.is_open_source ? <span className='k-card-oss'>Open source</span> : null}
          <span className='k-card-sp' />
          {signedIn && onSave ? (
            <button
              type='button'
              className='k-save'
              aria-pressed={!!item.saved}
              aria-label={item.saved ? 'Remove ' + item.title + ' from saved' : 'Save ' + item.title}
              onClick={() => onSave(item)}
            >
              <BookmarkIcon filled={item.saved} />
            </button>
          ) : null}
          <span className='k-card-go' aria-hidden='true'>View details</span>
        </div>
      </div>
    </article>
  );
}

export function SkeletonCard({ size = 'md' }) {
  return (
    <div className={'k-card k-card-' + size + ' k-card-skel'} aria-hidden='true'>
      <div className='k-card-media' />
      <div className='k-card-body'>
        <span className='k-skel-line' style={{ width: '40%' }} />
        <span className='k-skel-line k-skel-title' style={{ width: '70%' }} />
        <span className='k-skel-line' />
        <span className='k-skel-line' style={{ width: '85%' }} />
      </div>
    </div>
  );
}
