'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { GoogleIcon } from '../_ui/icons';

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get('error'));
  }, []);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    );
    // Where to land after sign-in travels in a short-lived cookie, not in the
    // redirect address. Supabase only returns to an address on its allow-list,
    // and `/auth/callback?next=...` does not match a plain
    // `/auth/callback` entry. When nothing matches it silently falls back to
    // the Site URL, which sent new members to the wrong deployment.
    const next = new URLSearchParams(window.location.search).get('next') || '/explore';
    document.cookie = 'stash_next=' + encodeURIComponent(next) + '; path=/; max-age=600; samesite=lax';
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth/callback' },
    });
    // On success the browser is already on its way to Google.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  return (
    <div className='k-auth-card'>
      <h1 className='k-h2'>Sign in to Stash</h1>
      <p className='k-lede'>
        Members open every entry in the catalogue, keep a list of saved tools and connect their agents with their own
        MCP key.
      </p>
      <button type='button' className='k-btn k-google' onClick={signIn} disabled={busy}>
        <GoogleIcon /> {busy ? 'Opening Google' : 'Continue with Google'}
      </button>
      {error ? <p role='alert' className='k-error'>{error}</p> : null}
      <p className='k-small k-dim' style={{ margin: 0 }}>Free to join. Stash only reads your name, email and picture from Google.</p>
    </div>
  );
}
