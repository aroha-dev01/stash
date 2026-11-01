'use client';

import Link from 'next/link';
import { track } from '../_ui/track';

/**
 * The one "connect" action. It always opens the setup guide, which shows the
 * right step: Google sign-in for visitors, a key for members, and the live
 * connection status once an agent has called.
 */
export default function ConnectButton({ signedIn, connected, from, className = 'k-btn k-btn-accent', children = 'Connect to your agent' }) {
  const label = connected ? 'See your connection' : children;
  const state = connected ? 'connected' : signedIn ? 'member' : 'visitor';
  return (
    <Link className={className} href='/connect' onClick={() => track('connect_cta_clicked', { from, state })}>
      {label}
    </Link>
  );
}
