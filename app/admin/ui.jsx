'use client';

import { useCallback, useState } from 'react';

// Small pieces shared by every section of the console.

/** A coloured dot plus a word. The word carries the meaning; colour only backs it up. */
export function State({ tone = 'off', children }) {
  return (
    <span className={'k-state k-state-' + tone}>
      <span className='k-dot' aria-hidden='true' />
      {children}
    </span>
  );
}

/** An on/off switch that says what it controls. */
export function Toggle({ on, onChange, label, disabled }) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={!!on}
      aria-label={label}
      className='k-switch'
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span aria-hidden='true' />
    </button>
  );
}

/** "3 min ago", "2 days ago", or "never". */
export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.round(s / 86400) + ' days ago';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const date = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

/** JSON fetch that turns a failed response into a thrown, readable error. */
export async function api(path, init) {
  const opts = init?.body && typeof init.body !== 'string'
    ? { ...init, headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }
    : init;
  const res = await fetch(path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Request failed (' + res.status + ')');
  return json;
}

/** Brief confirmations in one polite live region, so screen readers hear them too. */
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((msg, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  const view = (
    <div className='k-toasts' role='status' aria-live='polite'>
      {toasts.map((t) => (
        <div key={t.id} className={'k-toast k-toast-' + t.tone}>{t.msg}</div>
      ))}
    </div>
  );
  return [toast, view];
}
