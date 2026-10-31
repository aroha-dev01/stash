import Link from 'next/link';
import { getViewer } from '@/lib/auth';
import { DrawerMark } from './icons';
import MenuToggle from './MenuToggle';

/** The one header for every public page. Reads the session on the server. */
export default async function SiteHeader({ current }) {
  const viewer = await getViewer().catch(() => null);
  const here = (k) => (current === k ? 'page' : undefined);

  return (
    <header className='k-head'>
      <div className='k-wrap k-head-in'>
        <Link className='k-brand' href='/'>
          <DrawerMark />
          stash
        </Link>
        <nav className='k-nav' id='k-nav' aria-label='Main'>
          <Link href='/explore' aria-current={here('explore')}>Explore</Link>
          {viewer ? <Link href='/explore?saved=1' aria-current={here('saved')}>Saved</Link> : null}
          {viewer ? (
            <Link href='/assistant' aria-current={here('assistant')}>
              Assistant{viewer.isPro ? null : <span className='k-pro'>Pro</span>}
            </Link>
          ) : null}
          <Link href='/pricing' aria-current={here('pricing')}>Pricing</Link>
          {viewer?.isAdmin ? <Link href='/admin' aria-current={here('admin')}>Curate</Link> : null}
        </nav>
        <span className='k-head-sp' />
        {viewer ? (
          <Link className='k-avatar' href='/account' aria-label='Account and MCP connection' title={viewer.email}>
            {viewer.avatar ? (
              <img className='k-avatar' src={viewer.avatar} alt='' referrerPolicy='no-referrer' />
            ) : (
              (viewer.name || '?').slice(0, 1).toUpperCase()
            )}
          </Link>
        ) : (
          <Link className='k-btn k-btn-sm' href={'/login' + (current ? '?next=/' + (current === 'home' ? '' : current) : '')}>
            Sign in
          </Link>
        )}
        <MenuToggle />
      </div>
    </header>
  );
}
