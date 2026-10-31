import Link from 'next/link';
import { DrawerMark } from './icons';

export default function SiteFooter() {
  return (
    <footer className='k-foot'>
      <div className='k-wrap k-foot-in'>
        <Link className='k-brand' href='/' style={{ fontSize: 17 }}>
          <DrawerMark size={18} />
          stash
        </Link>
        <span>A hand-picked catalogue for developers and the agents they work with.</span>
        <nav aria-label='Footer'>
          <Link href='/explore'>Explore</Link>
          <Link href='/pricing'>Pricing</Link>
          <Link href='/account'>Account</Link>
        </nav>
      </div>
    </footer>
  );
}
