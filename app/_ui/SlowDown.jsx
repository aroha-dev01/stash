import Link from 'next/link';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';

/** Shown instead of catalogue pages once a caller passes lib/guard.js's pace. */
export default function SlowDown({ wait, current }) {
  const when = wait < 90 ? wait + ' seconds' : Math.ceil(wait / 60) + ' minutes';
  return (
    <div className='k'>
      <SiteHeader current={current} />
      <main id='main' className='k-auth'>
        <div className='k-auth-card'>
          <h1 className='k-h2'>Taking a short break</h1>
          <p className='k-lede'>
            That was a lot of pages in a short time, so the catalogue is paused for you. Try again in {when}.
          </p>
          <p className='k-small k-muted' style={{ margin: 0 }}>
            Using an agent? Connect it over MCP instead, which is built for it.
          </p>
          <div><Link className='k-btn' href='/connect'>Connect your agent</Link></div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
