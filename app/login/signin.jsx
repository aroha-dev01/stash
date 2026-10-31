'use client';

import { useEffect, useState } from 'react';
import { GoogleIcon } from '../_ui/icons';
import { startGoogleSignIn } from '../_ui/signin';

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get('error'));
  }, []);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const next = new URLSearchParams(window.location.search).get('next') || '/explore';
    const message = await startGoogleSignIn(next, 'login');
    // On success the browser is already on its way to Google.
    if (message) {
      setError(message);
      setBusy(false);
    }
  };

  return (
    <div className='k-auth-card'>
      <span className='k-eyebrow'>Sign in</span>
      <h1 className='k-h2'>Sign in to Stash</h1>
      <p className='k-lede'>
        Members open the Free collection, keep a list of saved tools and connect their agents with their own MCP key.
      </p>
      <button type='button' className='k-btn k-google' onClick={signIn} disabled={busy}>
        <GoogleIcon /> {busy ? 'Opening Google' : 'Continue with Google'}
      </button>
      {error ? <p role='alert' className='k-error'>{error}</p> : null}
      <p className='k-small k-dim' style={{ margin: 0 }}>Free to join. Stash only reads your name, email and picture from Google.</p>
    </div>
  );
}
