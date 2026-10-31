'use client';

import Link from 'next/link';
import { useState } from 'react';
import { startGoogleSignIn } from '../_ui/signin';
import { track } from '../_ui/track';

/**
 * The one "connect" action, routed by state:
 *   signed out            straight to Google, then to the setup guide
 *   signed in, no agent   the setup guide
 *   agent connected       the guide's status, which says so
 */
export default function ConnectButton({ signedIn, connected, from, className = 'k-btn k-btn-accent', children = 'Connect to your agent' }) {
  const [busy, setBusy] = useState(false);
  const label = connected ? 'See your connection' : children;

  if (signedIn) {
    return (
      <Link className={className} href='/connect' onClick={() => track('connect_cta_clicked', { from, state: connected ? 'connected' : 'member' })}>
        {label}
      </Link>
    );
  }

  const go = async () => {
    track('connect_cta_clicked', { from, state: 'visitor' });
    setBusy(true);
    const error = await startGoogleSignIn('/connect', from);
    // Only reached when Google could not be opened.
    if (error) window.location.href = '/login?next=/connect&error=' + encodeURIComponent(error);
  };

  return (
    <button type='button' className={className} onClick={go} disabled={busy} aria-busy={busy}>
      {busy ? 'Opening Google' : label}
    </button>
  );
}
