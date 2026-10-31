'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PRO } from '@/lib/plans';
import CodeBox from '../_ui/CodeBox';
import { CLIENTS, PLACEHOLDER_KEY, clientLabel, clientOf } from '../_ui/agents';
import { startGoogleSignIn } from '../_ui/signin';
import { track } from '../_ui/track';

// The setup guide. Every claim it makes about the connection is one the
// server can back: "Connected" appears only after Stash has answered a call
// made with one of the member's keys (mcp_keys.last_used_at), never because
// a config was copied. While a key is waiting for its first call the page
// checks every few seconds, and stops after ten minutes or when hidden.

const POLL_MS = 5000;
const POLL_FOR = 10 * 60 * 1000;

function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}

export default function Guide({ signedIn, name, mcpUrl, isPro, initialClient, welcome }) {
  const [client, setClient] = useState(clientOf(initialClient).key);
  const [keys, setKeys] = useState(signedIn ? null : []);
  const [max, setMax] = useState(5);
  const [keyName, setKeyName] = useState('');
  const [fresh, setFresh] = useState(null); // { id, key, name }: the full key, shown once
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pollUntil = useRef(0);
  const announced = useRef(false);
  const tabs = useRef([]);

  const c = clientOf(client);

  useEffect(() => { track('agent_setup_opened', { client: c.key, signedIn }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setKeyName(c.name === 'Other MCP clients' ? 'My MCP client' : c.name); setCopied(false); }, [c.name]);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      const r = await fetch('/api/account/keys', { cache: 'no-store' });
      const j = await r.json();
      if (r.ok) { setKeys(j.keys || []); setMax(j.max || 5); }
    } catch {
      setKeys((k) => k || []);
    }
  }, [signedIn]);

  useEffect(() => { load(); }, [load]);

  // Which key the status follows: the one just made, or any live key.
  const watched = fresh ? (keys || []).find((k) => k.id === fresh.id) : null;
  const used = (keys || []).filter((k) => k.last_used_at).sort((a, b) => b.last_used_at.localeCompare(a.last_used_at))[0] || null;
  const connected = fresh ? !!watched?.last_used_at : !!used;
  const shown = fresh ? watched : used;
  const waiting = signedIn && keys?.length > 0 && !connected;

  useEffect(() => {
    if (!waiting) return;
    if (!pollUntil.current) pollUntil.current = Date.now() + POLL_FOR;
    const t = setInterval(() => {
      if (Date.now() > pollUntil.current) return clearInterval(t);
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, load]);

  useEffect(() => {
    if (connected && fresh && !announced.current) {
      announced.current = true;
      track('mcp_connection_verified', { client: clientLabel(watched?.last_client) || 'unknown' });
    }
  }, [connected, fresh, watched]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: keyName || c.name }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'The key was not created. Try again.');
      setFresh({ id: j.record.id, key: j.key, name: j.record.name });
      pollUntil.current = Date.now() + POLL_FOR;
      announced.current = false;
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k) => {
    if (!confirm('Revoke "' + k.name + '"? Anything using it stops working straight away.')) return;
    await fetch('/api/account/keys?id=' + k.id, { method: 'DELETE' });
    if (fresh?.id === k.id) setFresh(null);
    load();
  };

  const signIn = async () => {
    setBusy(true);
    const err = await startGoogleSignIn('/connect?client=' + client, 'setup-guide');
    if (err) { setError(err); setBusy(false); }
  };

  const onTabKey = (e, i) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + CLIENTS.length) % CLIENTS.length;
    setClient(CLIENTS[n].key);
    tabs.current[n]?.focus();
  };

  const key = fresh?.key || PLACEHOLDER_KEY;
  const hasKey = !!keys?.length;
  const status = !signedIn
    ? { tone: '', word: 'Not connected', line: 'Sign in with Google to create your key. It takes a minute.' }
    : keys === null
      ? { tone: '', word: 'Checking', line: 'Looking up your keys.' }
      : connected
        ? {
            tone: 'ok',
            word: 'Connected',
            line: 'Stash answered ' + (clientLabel(shown?.last_client) || 'your agent') + ' ' + ago(shown?.last_used_at) + ', using the key "' + shown?.name + '".',
          }
        : hasKey
          ? { tone: 'wait', word: 'Waiting for the first call', line: 'Add the config below, reload ' + c.name + ' and ask it something. This updates by itself.' }
          : { tone: '', word: 'Not connected', line: 'Create a key below to connect your first agent.' };

  return (
    <>
      {welcome && signedIn ? (
        <div className='k-welcome' role='status'>
          <div>
            <b>Welcome to Stash{name ? ', ' + name.split(' ')[0] : ''}.</b>
            <p>Three steps from here: create a key, paste one config, ask your agent. Everything for members is already open to you on Explore.</p>
          </div>
        </div>
      ) : null}

      <div className={'k-status' + (status.tone ? ' k-status-' + status.tone : '')} role='status' aria-live='polite'>
        <div>
          <span className='k-status-word'>
            {status.tone === 'wait' ? <span className='k-pulse' aria-hidden='true' /> : <span className={'k-dot' + (status.tone === 'ok' ? ' k-dot-ok' : '')} aria-hidden='true' />}
            {status.word}
          </span>
          <p>{status.line}</p>
        </div>
        {connected ? <Link className='k-btn k-btn-sm' href='/explore'>Explore the library</Link> : null}
      </div>

      <div className='k-cx'>
        <div className='k-cx-list' role='tablist' aria-label='Choose your agent' aria-orientation='vertical'>
          <h2>Your agent</h2>
          {CLIENTS.map((x, i) => (
            <button
              key={x.key}
              ref={(el) => { tabs.current[i] = el; }}
              type='button'
              role='tab'
              id={'cx-tab-' + x.key}
              aria-selected={client === x.key}
              aria-controls='cx-panel'
              tabIndex={client === x.key ? 0 : -1}
              className='k-cx-item'
              onClick={() => setClient(x.key)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              <span className='k-agent-tile' style={{ '--tone': x.tone }}><x.Mark size={18} /></span>
              {x.name}
            </button>
          ))}
        </div>

        <div className='k-cx-main' role='tabpanel' id='cx-panel' aria-labelledby={'cx-tab-' + client}>
          <ol className='k-steps-big'>
            <li data-done={signedIn ? '' : undefined}>
              <h3>Sign in</h3>
              {signedIn ? (
                <p>You are signed in. Your keys belong to your account, and only you can see or revoke them.</p>
              ) : (
                <>
                  <p>Stash keys belong to a member account. Signing in with Google is free, and each account can hold up to {max} keys at once.</p>
                  <div><button type='button' className='k-btn k-btn-accent' onClick={signIn} disabled={busy}>{busy ? 'Opening Google' : 'Sign in with Google'}</button></div>
                </>
              )}
            </li>

            <li data-done={hasKey ? '' : undefined}>
              <h3>Create a key for {c.name}</h3>
              <p>One key per app or machine, so you can revoke one without touching the rest.</p>
              {signedIn ? (
                <form className='k-field' onSubmit={create}>
                  <label className='k-sr' htmlFor='key-name'>Key name</label>
                  <input id='key-name' value={keyName} onChange={(e) => setKeyName(e.target.value)} maxLength={40} placeholder='Where you will use it, for example Cursor on my laptop' />
                  <button className='k-btn k-btn-accent' type='submit' disabled={busy || keys === null || keys.length >= max}>
                    {busy ? 'Creating key' : 'Create key'}
                  </button>
                </form>
              ) : null}
              {keys && keys.length >= max ? <p className='k-small'>You have {max} keys. Revoke one below to make another.</p> : null}
              {error ? <p className='k-error' role='alert'>{error}</p> : null}
              {fresh ? (
                <div className='k-newkey' role='status'>
                  <b>Your new key, “{fresh.name}”</b>
                  <CodeBox text={fresh.key} label='Copy key' />
                  <span className='k-small k-muted'>
                    Copy it now: Stash keeps only a fingerprint, so this is the only time the full key is shown. It is already
                    filled into the config below.
                  </span>
                </div>
              ) : null}
            </li>

            <li>
              <h3>Add Stash to {c.name}</h3>
              {c.steps.map((s, i) => <p key={i}>{s}</p>)}
              <CodeBox
                text={c.code(mcpUrl, key)}
                onCopy={() => { setCopied(true); track('config_copied', { client: c.key, withKey: !!fresh }); }}
              />
              <dl className='k-facts' style={{ paddingTop: 12 }}>
                <div><dt>Remote MCP address</dt><dd style={{ textTransform: 'none' }}><code>{mcpUrl}</code></dd></div>
                <div><dt>Your key</dt><dd style={{ textTransform: 'none' }}>{fresh ? 'Filled in above' : signedIn ? 'Create one in step 2' : 'After you sign in'}</dd></div>
                <div><dt>Where it goes</dt><dd style={{ textTransform: 'none' }}>{c.file}</dd></div>
                <div><dt>Sent as</dt><dd style={{ textTransform: 'none' }}>{c.key === 'claude' ? 'Part of the address' : 'Authorization: Bearer header'}</dd></div>
              </dl>
              {copied ? <p className='k-small k-dim'>Copied. Paste it into {c.file}. Stash shows Connected only once your agent actually calls it.</p> : null}
              {!fresh ? <p className='k-small k-dim'>{PLACEHOLDER_KEY} is a placeholder. {signedIn ? 'Create a key in step 2 and it is filled in here.' : 'Sign in and create a key, and it is filled in here.'}</p> : null}
            </li>

            <li>
              <h3>Reload {c.name}</h3>
              <p>{c.reload}</p>
            </li>

            <li data-done={connected ? '' : undefined}>
              <h3>Test it</h3>
              <p>Ask your agent: <b>“Use Stash to find a library for scroll animations.”</b> It should call <code>search_tools</code> and answer with entries from the library.</p>
              <p className='k-small k-dim'>
                {connected
                  ? 'Verified: Stash has received a call from your agent.'
                  : signedIn && hasKey
                    ? 'This page is listening for the first call and updates by itself.'
                    : 'Once your key is in place, this step confirms the connection by itself.'}
              </p>
            </li>
          </ol>

          {signedIn ? (
            <section className='k-block' id='keys' aria-labelledby='keys-h'>
              <div className='k-block-head'>
                <h2 id='keys-h' className='k-h3'>Your keys</h2>
                <p className='k-muted k-small' style={{ margin: 0 }}>
                  To rotate a key, create a new one, update your config, then revoke the old one. A revoked key stops working on its next call.
                </p>
              </div>
              {keys === null ? (
                <p className='k-muted k-small' style={{ margin: 0 }}>Loading</p>
              ) : !keys.length ? (
                <p className='k-muted k-small' style={{ margin: 0 }}>No keys yet.</p>
              ) : (
                <ul className='k-keys'>
                  {keys.map((k) => (
                    <li key={k.id}>
                      <div>
                        <b>{k.name}</b> <code>{k.prefix}…</code>
                        <div className='k-small k-dim'>
                          Created {ago(k.created_at)}.{' '}
                          {k.last_used_at ? 'Last call ' + ago(k.last_used_at) + (k.last_client ? ' from ' + clientLabel(k.last_client) : '') + '.' : 'Not used yet.'}
                        </div>
                      </div>
                      <button type='button' className='k-btn k-btn-sm' onClick={() => revoke(k)}>Revoke</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <section className='k-block' aria-labelledby='plan-h'>
            <div className='k-block-head'>
              <h2 id='plan-h' className='k-h3'>What your agent can do</h2>
              <p className='k-muted' style={{ margin: 0 }}>
                {isPro
                  ? 'Every Stash tool and every entry: search, details and install steps, plus stack building, comparisons, project reviews and ask_stash.'
                  : 'On Free your agent searches the Free collection, reads details and install steps, and saves tools to your list. ' +
                    PRO.name + ' opens the full library and the AI tools: stack building, comparisons, project reviews and ask_stash.'}
              </p>
            </div>
            {!isPro ? <div><Link className='k-btn k-btn-sm' href='/pricing'>See {PRO.name}</Link></div> : null}
          </section>

          <section aria-labelledby='trouble-h' style={{ display: 'grid', gap: 12 }}>
            <h2 id='trouble-h' className='k-h3'>Troubleshooting</h2>
            <dl className='k-trouble'>
              <div>
                <dt>Stash does not appear in {c.name}</dt>
                <dd>Check the config is in <b>{c.file}</b> and is valid JSON, then reload: {c.reload}</dd>
              </div>
              <div>
                <dt>“Unauthorised” or a 401 error</dt>
                <dd>The key is wrong, revoked, or still the placeholder. Create a new key here, paste it in, and reload.</dd>
              </div>
              <div>
                <dt>The config does not load</dt>
                <dd>Make sure the address is exactly <b>{mcpUrl}</b> and that only one server is named <b>stash</b>. For Claude connectors, the key must be in the address.</dd>
              </div>
              <div>
                <dt>Still waiting for the first call</dt>
                <dd>The status changes only when your agent actually calls Stash. Ask it to use Stash by name once; some agents only call tools when asked.</dd>
              </div>
              <div>
                <dt>Regenerate or revoke a key</dt>
                <dd>{signedIn ? 'Use Your keys above.' : 'Sign in, then use Your keys on this page.'} Revoking takes effect on the next call.</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}
