'use client';

import { useEffect, useState } from 'react';
import CodeBox from '../_ui/CodeBox';

const PLACEHOLDER = 'YOUR_STASH_KEY';

// Exact setup for each client, with the key filled in once one exists.
const CLIENTS = [
  {
    key: 'claude',
    label: 'Claude',
    steps: (url) => [
      <>In Claude, open <b>Settings</b>, then <b>Connectors</b>, then <b>Add custom connector</b>.</>,
      <>Name it <b>Stash</b> and paste this address. Claude connectors take a URL only, so the key travels in it.</>,
    ],
    code: (url, key) => url + '?key=' + key,
  },
  {
    key: 'claude-code',
    label: 'Claude Code',
    steps: () => [<>Run this once in your terminal. Stash is then available in every project.</>],
    code: (url, key) => 'claude mcp add --transport http stash ' + url + ' \\\n  --header "Authorization: Bearer ' + key + '"',
  },
  {
    key: 'cursor',
    label: 'Cursor',
    steps: () => [<>Open <b>~/.cursor/mcp.json</b> (or <b>.cursor/mcp.json</b> in one project) and add:</>],
    code: (url, key) => JSON.stringify({ mcpServers: { stash: { url, headers: { Authorization: 'Bearer ' + key } } } }, null, 2),
  },
  {
    key: 'vscode',
    label: 'VS Code (Copilot)',
    steps: () => [
      <>Create <b>.vscode/mcp.json</b> in your project, or run <b>MCP: Open User Configuration</b> for every project.</>,
      <>Then turn on Stash in Copilot Chat&apos;s agent mode tool list.</>,
    ],
    code: (url, key) => JSON.stringify({ servers: { stash: { type: 'http', url, headers: { Authorization: 'Bearer ' + key } } } }, null, 2),
  },
  {
    key: 'windsurf',
    label: 'Windsurf',
    steps: () => [<>Open <b>~/.codeium/windsurf/mcp_config.json</b> and add:</>],
    code: (url, key) => JSON.stringify({ mcpServers: { stash: { serverUrl: url, headers: { Authorization: 'Bearer ' + key } } } }, null, 2),
  },
  {
    key: 'other',
    label: 'Other',
    steps: () => [<>Any client that supports remote MCP servers over HTTP works. Use this address and header:</>],
    code: (url, key) => 'URL     ' + url + '\nHeader  Authorization: Bearer ' + key,
  },
];

const when = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never');

export default function Connect({ mcpUrl, isPro }) {
  const [keys, setKeys] = useState(null);
  const [max, setMax] = useState(5);
  const [name, setName] = useState('My laptop');
  const [fresh, setFresh] = useState(null); // the full key, shown once
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [client, setClient] = useState('claude-code');

  const load = () =>
    fetch('/api/account/keys')
      .then((r) => r.json())
      .then((j) => { setKeys(j.keys || []); setMax(j.max || 5); })
      .catch(() => setKeys([]));

  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/account/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error || 'The key was not created. Try again.');
    setFresh({ key: j.key, name: j.record?.name });
    load();
  };

  const revoke = async (k) => {
    if (!confirm('Revoke "' + k.name + '"? Anything using it stops working straight away.')) return;
    await fetch('/api/account/keys?id=' + k.id, { method: 'DELETE' });
    load();
  };

  const c = CLIENTS.find((x) => x.key === client);
  const key = fresh?.key || PLACEHOLDER;

  return (
    <section className='k-block' id='connect' aria-labelledby='connect-h'>
      <div className='k-block-head'>
        <h2 id='connect-h' className='k-h3'>Connect your AI tools</h2>
        <p className='k-muted' style={{ margin: 0 }}>
          One key connects Stash to your agent. Make a separate key for each machine or app, so you can revoke one
          without touching the rest.
        </p>
      </div>

      <form className='k-field' onSubmit={create}>
        <label className='k-sr' htmlFor='key-name'>Key name</label>
        <input id='key-name' value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder='Where you will use it, for example My laptop' />
        <button className='k-btn k-btn-brass' type='submit' disabled={busy || (keys && keys.length >= max)}>
          {busy ? 'Creating key' : 'Create key'}
        </button>
      </form>
      {error ? <p className='k-error'>{error}</p> : null}

      {fresh ? (
        <div className='k-newkey' role='status'>
          <b>Your new key for {fresh.name}</b>
          <CodeBox text={fresh.key} label='Copy key' />
          <span className='k-small k-muted'>
            Copy it now. Stash keeps only a fingerprint of it, so this is the only time the full key is shown. It is
            already filled into the setup below.
          </span>
        </div>
      ) : null}

      <div>
        <div className='k-tabs' role='tablist' aria-label='Choose your app'>
          {CLIENTS.map((x) => (
            <button key={x.key} type='button' role='tab' className='k-tab' aria-selected={client === x.key} onClick={() => setClient(x.key)}>
              {x.label}
            </button>
          ))}
        </div>
        <div role='tabpanel' style={{ display: 'grid', gap: 12, paddingTop: 16 }}>
          <ol className='k-steps-mini'>{c.steps(mcpUrl).map((s, i) => <li key={i}>{s}</li>)}</ol>
          <CodeBox text={c.code(mcpUrl, key)} />
          {!fresh ? <span className='k-small k-dim'>Create a key above and it replaces {PLACEHOLDER} here.</span> : null}
          <span className='k-small k-muted'>
            {isPro
              ? 'Your agent gets every Stash tool, including stack building, comparisons and project reviews.'
              : 'On Free your agent can search, read details and install steps. Stack building, comparisons and reviews unlock with Pro.'}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <h3 className='k-h3' style={{ fontSize: 16 }}>Your keys</h3>
        {keys === null ? (
          <p className='k-muted k-small' style={{ margin: 0 }}>Loading</p>
        ) : !keys.length ? (
          <p className='k-muted k-small' style={{ margin: 0 }}>No keys yet. Create one above to connect your first app.</p>
        ) : (
          <ul className='k-keys'>
            {keys.map((k) => (
              <li key={k.id}>
                <div>
                  <b>{k.name}</b> <code>{k.prefix}…</code>
                  <div className='k-small k-dim'>Created {when(k.created_at)}. Last used {when(k.last_used_at)}.</div>
                </div>
                <button type='button' className='k-btn k-btn-sm' onClick={() => revoke(k)}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
