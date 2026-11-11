'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { PRO } from '@/lib/plans';

/**
 * The avatar and what hangs off it. A disclosure, not an ARIA menu: plain
 * links in tab order, Escape and an outside click close it, and focus goes
 * back to the button.
 */
export default function AccountMenu({ viewer }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const initial = (viewer.name || '?').slice(0, 1).toUpperCase();
  const close = () => setOpen(false);

  return (
    <div className='k-acct' ref={wrap}>
      <button
        ref={button}
        type='button'
        className='k-avatar k-avatar-btn'
        aria-expanded={open}
        aria-controls={id}
        aria-label='Account menu'
        title={viewer.email}
        onClick={() => setOpen((v) => !v)}
      >
        {viewer.avatar ? <img className='k-avatar' src={viewer.avatar} alt='' referrerPolicy='no-referrer' /> : initial}
      </button>
      {open ? (
        <div className='k-acct-pop' id={id}>
          <div className='k-acct-who'>
            <b>{viewer.name}</b>
            <span>{viewer.email}</span>
          </div>
          <nav aria-label='Account'>
            <Link href='/account' onClick={close}>Profile</Link>
            <Link href='/projects' onClick={close}>Projects{viewer.isPro ? null : <span className='k-pro'>{PRO.name}</span>}</Link>
            <Link href='/explore' onClick={close}>Explore</Link>
            <Link href='/explore?saved=1' onClick={close}>Saved tools</Link>
            <Link href='/connect' onClick={close}>Connect your agent</Link>
            <Link href='/account#settings' onClick={close}>Settings</Link>
            <Link href='/assistant' onClick={close}>Assistant{viewer.isPro ? null : <span className='k-pro'>{PRO.name}</span>}</Link>
            <Link href='/pricing' onClick={close}>{viewer.isPro ? 'Plan' : 'Upgrade to ' + PRO.name}</Link>
            {viewer.isAdmin ? <Link href='/admin' onClick={close}>Curator console</Link> : null}
          </nav>
          <form method='post' action='/auth/signout'>
            <button type='submit'>Sign out</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
