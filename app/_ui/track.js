'use client';

import { track as vercelTrack } from '@vercel/analytics';

// Funnel events for Vercel Web Analytics. Names only, plus small labels such
// as which button or client: never keys, prompts, search text or anything a
// member typed. Analytics failing must never break the page.

export function track(name, props) {
  try {
    vercelTrack(name, props);
  } catch {
    /* analytics is best effort */
  }
}
