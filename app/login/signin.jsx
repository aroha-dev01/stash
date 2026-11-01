'use client';

import { useEffect, useState } from 'react';
import GoogleButton from '../_ui/GoogleButton';

export default function SignIn() {
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setNext(p.get('next') || '/explore');
    setError(p.get('error'));
  }, []);

  return (
    <div className='k-auth-card'>
      <span className='k-eyebrow'>Sign in</span>
      <h1 className='k-h2'>Sign in to Stash</h1>
      <p className='k-lede'>
        Members open the Free collection, keep a list of saved tools and connect their agents with their own MCP key.
      </p>
      {next ? <GoogleButton next={next} from='login' width={320} /> : <div style={{ minHeight: 52 }} />}
      {error ? <p role='alert' className='k-error'>{error}</p> : null}
      <p className='k-small k-dim' style={{ margin: 0 }}>Free to join. Stash only reads your name, email and picture from Google.</p>
    </div>
  );
}
