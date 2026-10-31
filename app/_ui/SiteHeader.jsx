import Link from 'next/link';
import { getViewer } from '@/lib/auth';
import { DrawerMark } from './icons';
import MenuToggle from './MenuToggle';
import AccountMenu from './AccountMenu';

/** The one header for every public page. Reads the session on the server. */
export default async function SiteHeader({ current }) {
  const viewer = await getViewer().catch(() => null);
  const here = (k) => (current === k ? 'page' : undefined);
  const back = current && !['home', 'login'].includes(current) ? '?next=/' + current : '';

  return (
    <header className='k-head' data-k-head>
      <div className='k-wrap k-head-in'>
        <Link className='k-brand' href='/' aria-label='Stash, home'>
          <DrawerMark />
          stash
        </Link>
        <nav className='k-nav' id='k-nav' aria-label='Main'>
          <Link href='/explore' aria-current={here('explore')}>Explore</Link>
          <Link href='/#categories'>Categories</Link>
          <Link href='/#how-it-works'>How it works</Link>
          <Link href='/pricing' aria-current={here('pricing')}>Pricing</Link>
          {viewer?.isAdmin ? <Link href='/admin' aria-current={here('admin')}>Curate</Link> : null}
          <Link className='k-nav-cta' href='/connect' aria-current={here('connect')}>Connect your agent</Link>
          {viewer ? null : <Link className='k-nav-signin' href={'/login' + back}>Sign in</Link>}
        </nav>
        <span className='k-head-sp' />
        <Link className='k-btn k-btn-accent k-btn-sm k-head-cta' href='/connect'>Connect your agent</Link>
        {viewer ? (
          <AccountMenu
            viewer={{ name: viewer.name, email: viewer.email, avatar: viewer.avatar, isAdmin: viewer.isAdmin, isPro: viewer.isPro }}
          />
        ) : (
          <Link className='k-btn k-btn-sm k-head-signin' href={'/login' + back}>Sign in</Link>
        )}
        <MenuToggle />
      </div>
    </header>
  );
}
