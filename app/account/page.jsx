import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import SiteHeader from '../_ui/SiteHeader';
import SiteFooter from '../_ui/SiteFooter';
import Connect from './connect';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account' };

export default async function Account() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/account');

  // The MCP address follows whichever domain the account page is served on,
  // so it is right locally, on previews and in production alike.
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https');
  const mcpUrl = proto + '://' + host + '/api/mcp';

  const planLabel = viewer.isAdmin ? 'Curator' : viewer.isPro ? 'Pro' : 'Free plan';

  return (
    <div className='k'>
      <SiteHeader current='account' />
      <main className='k-wrap k-page'>
        <div className='k-page-head'>
          <div className='k-me'>
            {viewer.avatar ? (
              <img className='k-avatar' src={viewer.avatar} alt='' referrerPolicy='no-referrer' />
            ) : (
              <span className='k-avatar'>{(viewer.name || '?').slice(0, 1).toUpperCase()}</span>
            )}
            <div>
              <h1 className='k-h3' style={{ fontSize: 24 }}>{viewer.name}</h1>
              <span className='k-muted k-small'>{viewer.email}</span>
            </div>
          </div>
          <span className={'k-badge' + (viewer.isPro ? ' k-badge-pro' : '')}>{planLabel}</span>
        </div>

        <Connect mcpUrl={mcpUrl} isPro={viewer.isPro} />

        <section className='k-block' aria-labelledby='plan-h'>
          <div className='k-block-head'>
            <h2 id='plan-h' className='k-h3'>Plan</h2>
            <p className='k-muted' style={{ margin: 0 }}>
              {viewer.isPro
                ? 'You have every feature, including AI recommendations in your agent and the Stash assistant.'
                : 'You are on Free: the whole catalogue, saved tools and discovery in your agent. Pro adds AI recommendations for $1 a month.'}
            </p>
          </div>
          <div className='k-d-actions'>
            <Link className={'k-btn' + (viewer.isPro ? '' : ' k-btn-brass')} href='/pricing'>{viewer.isPro ? 'See what is included' : 'See Pro'}</Link>
            <form method='post' action='/auth/signout'>
              <button className='k-btn' type='submit'>Sign out</button>
            </form>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
