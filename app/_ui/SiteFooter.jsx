import Link from 'next/link';
import { TOOLKITS } from '@/lib/taxonomy';
import { StashMark } from './icons';
import { AruoMark, AruoWordmark } from './brands';

export default function SiteFooter() {
  return (
    <footer className='k-foot'>
      <div className='k-wrap'>
        <div className='k-foot-grid'>
          <div className='k-foot-brand'>
            <Link className='k-brand' href='/' aria-label='Stash, home'>
              <StashMark />
              stash
            </Link>
            <p>A curated library of skills, plugins, MCP servers and developer tools, for you and the agents you build with.</p>
          </div>
          <nav aria-label='Product'>
            <h2>Product</h2>
            <Link href='/explore'>Explore</Link>
            <Link href='/#how-it-works'>How it works</Link>
            <Link href='/pricing'>Pricing</Link>
            <Link href='/connect'>Setup guide</Link>
          </nav>
          <nav aria-label='Categories'>
            <h2>Categories</h2>
            {TOOLKITS.map((t) => <Link key={t.key} href={'/explore?toolkit=' + t.key}>{t.label}</Link>)}
          </nav>
          <nav aria-label='Company'>
            <h2>Company</h2>
            <a href='https://www.aruo.dev/#contact' rel='noopener'>Contact</a>
            <Link href='/privacy'>Privacy</Link>
            <Link href='/account'>Account</Link>
          </nav>
        </div>
        {/* Aruo's wordmark, set large and cut in half by the rule below it. */}
        <div className='k-foot-giant' aria-hidden='true'>
          <AruoWordmark />
        </div>
        <div className='k-foot-base'>
          <a className='k-aruo' href='https://www.aruo.dev/' rel='noopener'>
            <AruoMark size={16} />
            <span>Built by <b>aruo.dev</b></span>
          </a>
          <p className='k-foot-tm'>
            Claude, Cursor, GitHub Copilot and Windsurf are trademarks of their owners. Stash works with them over MCP and is
            not affiliated with or endorsed by them.
          </p>
        </div>
      </div>
    </footer>
  );
}
