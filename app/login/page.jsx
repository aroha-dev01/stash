'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import '../index.css';

// Deliberately plain: the UI redesign comes later. Google is the only way in.

export default function Login() {
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
    const next = new URLSearchParams(window.location.search).get('next') || '/';
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth/callback?next=' + encodeURIComponent(next) },
    });
    // On success the browser is already navigating to Google.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <section style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>stash<i style={{ color: 'var(--accent, #7c9cff)' }}>.</i></h1>
        <p style={{ color: 'var(--text-2)', margin: '0 0 24px', lineHeight: 1.5 }}>
          The right tools for every task, one MCP connection away.
        </p>
        <button type='button' className='ix-btn p' onClick={signIn} disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error ? <p role='alert' style={{ color: 'var(--red, #f87171)', marginTop: 16, fontSize: 13.5 }}>{error}</p> : null}
      </section>
    </main>
  );
}
