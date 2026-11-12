'use client';

import { useEffect, useRef, useState } from 'react';
import { GoogleIcon } from './icons';
import { startGoogleSignIn } from './signin';
import { track } from './track';

// Google's own "Sign in with Google" button. The sign-in happens on this site
// and Google hands back an ID token, which our server turns into a Supabase
// session (app/auth/google, signInWithIdToken). Because nobody is sent through
// Supabase's callback, Google's screen names this site instead of
// <project>.supabase.co, and the browser never needs to reach supabase.co.
//
// It turns on when GOOGLE_CLIENT_ID is set (next.config.mjs passes it to the
// browser), and the site's origin is one of that client's Authorized
// JavaScript origins in Google Cloud.
// Without the ID, or when Google's script cannot load (blockers, strict
// privacy settings), it falls back to the redirect sign-in in ./signin.js,
// drawn as this site's own button.

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const HEIGHT = { large: 40, medium: 32 };

let script = null;
function loadGoogle() {
  script ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('no google.accounts.id')));
    s.onerror = () => { script = null; reject(new Error('Google sign-in did not load')); };
    document.head.appendChild(s);
  });
  return script;
}

// Google gets the SHA-256 of the nonce and puts it in the token; Supabase gets
// the nonce itself and checks the two match, so a token cannot be replayed.
async function makeNonce() {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return { raw, hashed: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') };
}

export default function GoogleButton({
  next = '/explore',
  from = 'login',
  text = 'continue_with', // Google's wording: continue_with | signin_with | signup_with
  size = 'large',
  width,
  label = 'Continue with Google', // for the fallback button
  className = 'k-btn k-google',
}) {
  const box = useRef(null);
  const [mode, setMode] = useState(CLIENT_ID ? 'loading' : 'redirect'); // loading | google | busy | redirect
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let live = true;
    Promise.all([loadGoogle(), makeNonce()])
      .then(([id, nonce]) => {
        if (!live || !box.current) return;
        id.initialize({
          client_id: CLIENT_ID,
          nonce: nonce.hashed,
          ux_mode: 'popup',
          itp_support: true,
          callback: async ({ credential }) => {
            setMode('busy');
            setError(null);
            // Our server trades the token for a session (app/auth/google), so
            // the browser never has to reach <project>.supabase.co, which some
            // networks block.
            let failed = null;
            try {
              const res = await fetch('/auth/google', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ credential, nonce: nonce.raw }),
              });
              if (!res.ok) failed = (await res.json().catch(() => null))?.error || 'Sign-in did not complete. Try again.';
            } catch {
              failed = 'Could not reach Stash. Check your connection and try again.';
            }
            if (failed) {
              setError(failed);
              setMode('google');
              return;
            }
            // The session is set; the callback welcomes new members and records the sign-in.
            document.cookie = 'stash_next=' + encodeURIComponent(next) + '; path=/; max-age=600; samesite=lax';
            window.location.assign('/auth/callback?via=google');
          },
        });
        id.renderButton(box.current, {
          type: 'standard',
          theme: 'filled_black',
          size,
          text,
          shape: 'pill',
          logo_alignment: 'left',
          ...(width ? { width } : {}),
          click_listener: () => track('google_sign_in_started', { from }),
        });
        setMode('google');
      })
      .catch(() => { if (live) setMode('redirect'); });
    return () => { live = false; };
  }, [next, from, text, size, width]);

  const redirect = async () => {
    setMode('busy');
    const message = await startGoogleSignIn(next, from);
    // On success the browser is already on its way to Google.
    if (message) { setError(message); setMode('redirect'); }
  };

  if (mode === 'redirect' || (mode === 'busy' && !CLIENT_ID)) {
    return (
      <>
        <button type='button' className={className} onClick={redirect} disabled={mode === 'busy'}>
          {className.includes('k-google') ? <GoogleIcon /> : null} {mode === 'busy' ? 'Opening Google' : label}
        </button>
        {error ? <p role='alert' className='k-error'>{error}</p> : null}
      </>
    );
  }

  return (
    <div className='k-gsi'>
      <div ref={box} className='k-gsi-box' style={{ minHeight: HEIGHT[size] || 40 }} aria-busy={mode !== 'google'} />
      {mode === 'busy' ? <p className='k-small k-dim' role='status'>Signing you in…</p> : null}
      {error ? (
        <p role='alert' className='k-error'>
          {error}{' '}
          <button type='button' className='k-link' onClick={redirect}>Try signing in another way</button>
        </p>
      ) : null}
    </div>
  );
}
