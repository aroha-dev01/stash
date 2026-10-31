'use client';

import { useEffect, useState } from 'react';

/**
 * Opens the main nav on small screens, and marks the header once the page
 * has scrolled so it can take on its background. One passive listener.
 */
export default function MenuToggle() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const head = document.querySelector('[data-k-head]');
    if (!head) return;
    const onScroll = () => head.toggleAttribute('data-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const nav = document.getElementById('k-nav');
    nav?.classList.toggle('k-nav-open', open);
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (e.target.closest?.('#k-nav a')) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [open]);

  return (
    <button type='button' className='k-btn k-btn-sm k-menu-btn' aria-expanded={open} aria-controls='k-nav' onClick={() => setOpen((v) => !v)}>
      {open ? 'Close' : 'Menu'}
    </button>
  );
}
