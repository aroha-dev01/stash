'use client';

import { useEffect, useRef } from 'react';

/**
 * Drag a sheet downwards to dismiss it, the way every native iOS sheet works.
 *
 * The subtlety is scrolling. A sheet whose content is scrolled halfway down
 * must scroll, not drag, or the panel runs away from your finger every time
 * you try to read it. So a drag only starts when the scroller is already at
 * the very top, which is exactly the moment a downward swipe has nowhere
 * else to go. That is the same rule the system sheets use, and it is why
 * they feel right without anyone noticing why.
 */
export function useSwipeDown(onClose, enabled = true) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let startY = 0;
    let delta = 0;
    let dragging = false;

    const scroller = () => el.querySelector('[data-sheet-scroll]') || el;

    const start = (e) => {
      if (scroller().scrollTop > 0) return;
      startY = e.touches[0].clientY;
      delta = 0;
      dragging = true;
      el.style.transition = 'none';
    };

    const move = (e) => {
      if (!dragging) return;
      delta = e.touches[0].clientY - startY;
      // Upward drags are ignored rather than resisted; the sheet is already
      // as tall as it goes.
      if (delta <= 0) {
        el.style.transform = '';
        return;
      }
      el.style.transform = 'translateY(' + delta + 'px)';
    };

    const end = () => {
      if (!dragging) return;
      dragging = false;
      el.style.transition = 'transform .22s cubic-bezier(.2,.8,.3,1)';

      if (delta > 110) {
        el.style.transform = 'translateY(100%)';
        setTimeout(() => closeRef.current && closeRef.current(), 170);
      } else {
        el.style.transform = '';
      }
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);

    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [enabled]);

  return ref;
}

/**
 * Makes the phone's back gesture close the open panel instead of leaving the
 * app entirely, which is what it does today and is jarring.
 */
export function useBackToClose(isOpen, onClose) {
  const pushed = useRef(false);
  const ignorePop = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ stashSheet: true }, '');
    pushed.current = true;

    const onPop = () => {
      if (ignorePop.current) {
        ignorePop.current = false;
        return;
      }
      pushed.current = false;
      closeRef.current && closeRef.current();
    };

    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed by tapping rather than by going back, so retire the history
      // entry we added. Without this, the next back press would appear to do
      // nothing at all.
      if (pushed.current) {
        pushed.current = false;
        ignorePop.current = true;
        window.history.back();
      }
    };
  }, [isOpen]);
}
