import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { MAX_ACTIVE_KEYS } from '@/lib/mcpkeys';
import { PRO } from '@/lib/plans';
import { consentToken, liveKeyCount, readAuthorizeRequest, redirectHost, redirectWith } from '@/lib/oauth';
import SiteHeader from '../../_ui/SiteHeader';
import GoogleButton from '../../_ui/GoogleButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect an app', robots: { index: false, follow: false } };

// Where an MCP client (Claude's custom connectors, for one) sends a member to
// sign in. They sign in if they need to, see which app is asking and where it
// will send them back, and press Allow. The app then gets a Stash key of its
// own, listed with the rest on /connect, where it can be revoked.

const FIELDS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];

export default async function Authorize({ searchParams }) {
  const raw = await searchParams;
  const params = {};
  for (const k of FIELDS) {
    const v = Array.isArray(raw?.[k]) ? raw[k][0] : raw?.[k];
    if (typeof v === 'string' && v) params[k] = v;
  }
  const notice = typeof raw?.notice === 'string' ? raw.notice : null;

  const request = readAuthorizeRequest(params);
  if (request.fatal) {
    return (
      <Shell>
        <span className='k-eyebrow'>Connect an app</span>
        <h1 className='k-h2'>This link cannot be used</h1>
        <p className='k-lede'>{request.fatal}</p>
        <p className='k-small k-dim' style={{ margin: 0 }}>Setup steps for every agent are on <Link href='/connect'>the setup guide</Link>.</p>
      </Shell>
    );
  }
  if (request.error) {
    redirect(redirectWith(request.redirectUri, { error: request.error, error_description: request.description, state: request.state }));
  }

  const app = request.client.name || 'An app';
  const host = redirectHost(request.redirectUri);
  const viewer = await getViewer().catch(() => null);

  if (!viewer) {
    const here = '/oauth/authorize?' + new URLSearchParams(params).toString();
    return (
      <Shell>
        <span className='k-eyebrow'>Connect {app}</span>
        <h1 className='k-h2'>Sign in to connect {app} to Stash</h1>
        <p className='k-lede'>
          {app} wants to search Stash for you. Sign in with your Stash account, and you will be asked to allow it on the next step.
        </p>
        <GoogleButton next={here} from='oauth' width={320} />
        <p className='k-small k-dim' style={{ margin: 0 }}>Free to join. Stash only reads your name, email and picture from Google.</p>
      </Shell>
    );
  }

  const keys = await liveKeyCount(viewer.id);
  const full = keys >= MAX_ACTIVE_KEYS;

  return (
    <Shell>
      <span className='k-eyebrow'>Connect {app}</span>
      <h1 className='k-h2'>Allow {app} to use Stash?</h1>
      <p className='k-lede'>
        {app} will search the catalogue, read entries and install steps, and save tools to your list, as{' '}
        <b>{viewer.email || viewer.name}</b>.{' '}
        {viewer.isPro
          ? 'Your ' + PRO.name + ' plan opens every entry and the AI tools.'
          : 'On Free it sees the Free collection; ' + PRO.name + ' opens the rest.'}
      </p>

      <dl className='k-facts'>
        <div><dt>App</dt><dd style={{ textTransform: 'none' }}>{app}</dd></div>
        <div><dt>Sends you back to</dt><dd style={{ textTransform: 'none' }}><code>{host}</code></dd></div>
      </dl>

      {notice ? <p role='alert' className='k-error' style={{ margin: 0 }}>{notice}</p> : null}

      {full ? (
        <p role='alert' className='k-error' style={{ margin: 0 }}>
          Your account already has {MAX_ACTIVE_KEYS} keys, the most it can hold. Revoke one on <Link href='/connect#keys'>the setup guide</Link>, then come back to this page.
        </p>
      ) : null}

      <form method='post' action='/api/oauth/authorize' style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {Object.entries(params).map(([k, v]) => <input key={k} type='hidden' name={k} value={v} />)}
        <input type='hidden' name='consent' value={consentToken(viewer.id, request)} />
        <button className='k-btn k-btn-accent' type='submit' name='decision' value='allow' disabled={full}>Allow</button>
        <button className='k-btn k-btn-quiet' type='submit' name='decision' value='deny'>Cancel</button>
      </form>

      <p className='k-small k-dim' style={{ margin: 0 }}>
        Only allow apps you started connecting yourself. {app} gets its own key, listed on <Link href='/connect#keys'>the setup guide</Link>, where you
        can revoke it at any time.
      </p>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className='k'>
      <SiteHeader />
      <main className='k-auth'>
        <div className='k-auth-card'>{children}</div>
      </main>
    </div>
  );
}
