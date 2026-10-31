'use client';

import { useCallback, useEffect, useState } from 'react';
import CodeBox from '../_ui/CodeBox';
import { State, Toggle, ago, api } from './ui';

const PLACEHOLDER = 'YOUR_SHORTCUT_KEY';
const PRODUCTION = 'https://stashkit.vercel.app';

/** Where the phone should send links. A phone cannot reach localhost, so local work points at production. */
const phoneOrigin = (origin) => (/\/\/(localhost|127\.0\.0\.1)/.test(origin) ? PRODUCTION : origin);

function verdict(s) {
  if (!s.enabled) return { tone: 'off', word: 'Switched off', line: 'The share sheet is not accepting links. Turn it on to start.' };
  if (!s.keys.length) return { tone: 'warn', word: 'Needs a key', line: 'It is on, but no iPhone has a key yet. Create one below.' };
  if (!s.heard) {
    return { tone: 'warn', word: 'Waiting for your iPhone', line: 'Finish the guide below, then share any page. This updates within seconds.' };
  }
  return { tone: 'ok', word: 'Working', line: 'Last heard from your iPhone ' + ago(s.heard) + '.' };
}

const saveState = (l) =>
  l.status === 'ready' ? ['ok', 'Saved and read'] : l.status === 'error' ? ['bad', 'Saved, reading failed'] : ['warn', 'Saved, reading'];

export default function Shortcut({ origin, onChanged, toast }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('iPhone');
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api('/api/admin/shortcut').then((j) => { setS(j); setError(null); }, (e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  // Live while this section is open, so a test share from the phone shows up
  // here without touching anything.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      onChanged();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = (enabled) =>
    run(async () => setS(await api('/api/admin/shortcut', { method: 'PATCH', body: { enabled } })), enabled ? 'Share sheet is on' : 'Share sheet is off');

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const j = await api('/api/admin/shortcut', { method: 'POST', body: { name } });
      setFresh({ key: j.key, name: j.record.name });
      setS(j.status);
    });
  };

  const revoke = (k) => {
    if (!confirm('Revoke "' + k.name + '"? The shortcut on that phone stops working straight away.')) return;
    run(async () => setS(await api('/api/admin/shortcut?id=' + k.id, { method: 'DELETE' })), k.name + ' revoked');
  };

  if (error) {
    return (
      <section className='k-con-sec'>
        <h1 className='k-h2'>iOS shortcut</h1>
        <div className='k-alert'>
          <b>The shortcut status did not load.</b> {error}
          <div><button type='button' className='k-btn k-btn-sm' onClick={load}>Try again</button></div>
        </div>
      </section>
    );
  }
  if (!s) {
    return (
      <section className='k-con-sec'>
        <h1 className='k-h2'>iOS shortcut</h1>
        <p className='k-muted'>Checking the share sheet</p>
      </section>
    );
  }

  const v = verdict(s);
  const base = phoneOrigin(origin);
  const key = fresh?.key || PLACEHOLDER;
  const last = s.recent[0];

  const checks = [
    ['Share sheet', s.enabled ? ['ok', 'On'] : ['off', 'Off'], s.enabled ? 'Accepting links from curator keys' : 'Not accepting links'],
    ['Shortcut key', s.keys.length ? ['ok', s.keys.length + ' active'] : ['warn', 'None'], s.keys.length ? s.keys.map((k) => k.name).join(', ') : 'Create one below'],
    ['iPhone', s.heard ? ['ok', 'Connected'] : ['warn', 'Not heard from yet'], s.heard ? 'Last request ' + ago(s.heard) : 'Appears after the first share or connection check'],
    ['AI summaries', s.ai ? ['ok', 'On'] : ['warn', 'Off'], s.ai ? 'Shared links are read and filed automatically' : 'Links save, but stay unread until DEEPSEEK_API_KEY is set'],
    last
      ? ['Last shared link', saveState(last), (last.title || last.domain) + ', ' + ago(last.created_at)]
      : ['Last shared link', ['off', 'None yet'], 'Nothing has come in from the share sheet'],
  ];

  return (
    <section className='k-con-sec' aria-labelledby='sc-h'>
      <div className='k-con-head'>
        <h1 id='sc-h' className='k-h2'>iOS shortcut</h1>
        <p className='k-lede'>
          Save any page to the catalogue from your iPhone&apos;s share sheet. Curators only: members never see this,
          and anyone without a curator&apos;s key gets &quot;not found&quot;.
        </p>
      </div>

      <div className={'k-signal k-signal-' + v.tone} aria-live='polite'>
        <div className='k-signal-top'>
          <div style={{ display: 'grid', gap: 4 }}>
            <State tone={v.tone}><span className='k-signal-word'>{v.word}</span></State>
            <span className='k-muted'>{v.line}</span>
          </div>
          <div className='k-setting-ctl'>
            <span className='k-small k-muted'>Accept links</span>
            <Toggle on={s.enabled} label='Accept links from the share sheet' disabled={busy} onChange={setEnabled} />
          </div>
        </div>
        <ul className='k-health'>
          {checks.map(([label, st, detail]) => (
            <li key={label}>
              <div>
                <b>{label}</b>
                <span className='k-small k-dim k-clip'>{detail}</span>
              </div>
              <State tone={st[0]}>{st[1]}</State>
              <span />
            </li>
          ))}
        </ul>
        <span className='k-small k-dim'>Updates every few seconds while this page is open.</span>
      </div>

      <div className='k-block'>
        <div className='k-block-head'>
          <h2 className='k-h3'>Shortcut keys</h2>
          <p className='k-muted' style={{ margin: 0 }}>
            One key per phone, so a lost phone can be cut off on its own. Keys only save links. They cannot open the
            MCP server or anything else.
          </p>
        </div>
        <form className='k-field' onSubmit={create}>
          <label className='k-sr' htmlFor='sc-name'>Key name</label>
          <input id='sc-name' value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder='Which phone, for example My iPhone' />
          <button className='k-btn k-btn-brass' type='submit' disabled={busy || s.keys.length >= s.max}>Create key</button>
        </form>
        {fresh ? (
          <div className='k-newkey' role='status'>
            <b>Key for {fresh.name}</b>
            <CodeBox text={'Bearer ' + fresh.key} label='Copy' />
            <span className='k-small k-muted'>
              Copy it now: this is the only time it is shown. It is already filled into step 5 below.
            </span>
          </div>
        ) : null}
        {s.keys.length ? (
          <ul className='k-keys'>
            {s.keys.map((k) => (
              <li key={k.id}>
                <div>
                  <b>{k.name}</b> <code>{k.prefix}…</code>
                  <div className='k-small k-dim'>Last used {ago(k.last_used_at)}</div>
                </div>
                <button type='button' className='k-btn k-btn-sm' onClick={() => revoke(k)} disabled={busy}>Revoke</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className='k-muted k-small' style={{ margin: 0 }}>No keys yet.</p>
        )}
      </div>

      <div className='k-block'>
        <div className='k-block-head'>
          <h2 className='k-h3'>Set it up on your iPhone</h2>
          <p className='k-muted' style={{ margin: 0 }}>About two minutes in the Shortcuts app. You only do this once per phone.</p>
          {base !== origin ? (
            <p className='k-small k-dim' style={{ margin: 0 }}>
              You are on {origin}, which your phone cannot reach, so the addresses below use {PRODUCTION}. Both use
              the same catalogue and keys.
            </p>
          ) : null}
        </div>

        <ol className='k-guide'>
          <li>
            <b>Create a key</b>
            <span>Use the form above and copy the key. It fills in below.</span>
          </li>
          <li>
            <b>Start a new shortcut</b>
            <span>Open <b>Shortcuts</b>, tap <b>+</b>, and name it <b>Save to Stash</b>.</span>
          </li>
          <li>
            <b>Put it in the share sheet</b>
            <span>
              Tap the <b>i</b> button and turn on <b>Show in Share Sheet</b>. Set it to receive <b>URLs</b> and{' '}
              <b>Safari web pages</b>.
            </span>
          </li>
          <li>
            <b>Add Get Contents of URL</b>
            <span>
              Search for the action <b>Get Contents of URL</b> and set its address to the text below. Then tap at the very
              end of it and insert the <b>Shortcut Input</b> variable. <b>url=</b> has to stay last, or long links are cut
              short.
            </span>
            <CodeBox text={base + '/api/save?text=1&url='} />
          </li>
          <li>
            <b>Add your key as a header</b>
            <span>
              Tap the arrow on that action to show more. Keep <b>Method</b> on <b>GET</b>, add a header named{' '}
              <b>Authorization</b>, and paste this as its value:
            </span>
            <CodeBox text={'Bearer ' + key} />
            {!fresh ? <span className='k-small k-dim'>Create a key above and it replaces {PLACEHOLDER} here.</span> : null}
          </li>
          <li>
            <b>Show what happened</b>
            <span>Add <b>Show Notification</b> and set its text to <b>Contents of URL</b>.</span>
          </li>
          <li>
            <b>Test it</b>
            <span>
              In Safari, tap <b>Share</b> on any page and choose <b>Save to Stash</b>. The notification shows the page
              name and its category, and the status at the top of this page turns to <b>Working</b>.
            </span>
          </li>
        </ol>

        <details className='k-details'>
          <summary>Check the connection without saving anything</summary>
          <p className='k-muted k-small'>
            Point the shortcut at this address for one run. The notification should read &quot;Stash is connected&quot;,
            and this page marks your iPhone as connected. Then switch the address back to the one in step 4.
          </p>
          <CodeBox text={base + '/api/save?check=1&text=1'} />
        </details>
      </div>

      <div className='k-block'>
        <div className='k-block-head'>
          <h2 className='k-h3'>If it does not work</h2>
        </div>
        <dl className='k-trouble'>
          <div>
            <dt>The notification says &quot;Not found&quot;</dt>
            <dd>
              Accept links is off, the key was revoked, or the header value is missing the word <b>Bearer</b> and a space
              before the key.
            </dd>
          </div>
          <div>
            <dt>It saved, but there is no summary or category</dt>
            <dd>AI summaries are off. Add DEEPSEEK_API_KEY in Vercel, then use Read again with AI on the entry.</dd>
          </div>
          <div>
            <dt>The saved link is cut short</dt>
            <dd>Something comes after the Shortcut Input in the address. Move it so url= and the input are last.</dd>
          </div>
          <div>
            <dt>The shortcut does not appear when you tap Share</dt>
            <dd>Show in Share Sheet is off, or the app you are sharing from does not share a URL. Try Safari first.</dd>
          </div>
        </dl>
        {s.tokenFallback ? (
          <p className='k-small k-dim' style={{ margin: 0 }}>
            STASH_TOKEN also works here, for scripts, even while Accept links is off. Never put it in a phone shortcut.
          </p>
        ) : null}
      </div>

      {s.recent.length ? (
        <div className='k-block'>
          <div className='k-block-head'>
            <h2 className='k-h3'>Recently shared</h2>
          </div>
          <ul className='k-health'>
            {s.recent.map((l) => {
              const st = saveState(l);
              return (
                <li key={l.id}>
                  <div>
                    <b>{l.title || l.domain}</b>
                    <span className='k-small k-dim'>{(l.category || l.domain) + ', ' + ago(l.created_at)}</span>
                  </div>
                  <State tone={st[0]}>{st[1]}</State>
                  <span />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
