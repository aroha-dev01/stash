'use client';

import { useState } from 'react';

/** Opens the main nav on small screens. */
export default function MenuToggle() {
  const [open, setOpen] = useState(false);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    document.getElementById('k-nav')?.classList.toggle('k-nav-open', next);
  };
  return (
    <button type='button' className='k-btn k-btn-sm k-menu-btn' aria-expanded={open} aria-controls='k-nav' onClick={toggle}>
      Menu
    </button>
  );
}
