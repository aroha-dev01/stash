import Link from 'next/link';
import SiteHeader from '../_ui/SiteHeader';
import SiteFooter from '../_ui/SiteFooter';

export const metadata = {
  title: 'Privacy',
  description: 'What Stash stores about you, why, and how to remove it.',
  alternates: { canonical: '/privacy' },
};

// A plain account of what the code does with personal data. Keep it in step
// with lib/auth.js, lib/mcpkeys.js, the saves table and the analytics events.
export default function Privacy() {
  return (
    <div className='k'>
      <SiteHeader current='privacy' />
      <main id='main' className='k-wrap k-page'>
        <div className='k-section-head' style={{ marginBottom: 0 }}>
          <span className='k-eyebrow'>Privacy</span>
          <h1 className='k-h1' style={{ fontSize: 'var(--text-page)' }}>What Stash keeps, and why.</h1>
        </div>
        <div className='k-prose'>
          <h2 className='k-h3'>Your account</h2>
          <p>When you sign in with Google, Stash stores your name, email address and profile picture, which plan you are on, and whether you curate the catalogue. Nothing else is read from your Google account.</p>

          <h2 className='k-h3'>Agent keys</h2>
          <ul>
            <li>Stash stores a fingerprint (a SHA-256 hash) of each key, never the key itself. The full key is shown once, when you create it.</li>
            <li>For each key it records when it was created, when it was last used, and the name your agent reports when it connects (for example “claude-code”), so the setup guide can confirm the connection.</li>
            <li>Revoking a key stops it working on its next call.</li>
          </ul>

          <h2 className='k-h3'>What your agent asks</h2>
          <p>Stash answers your agent’s searches but does not keep a log of what it searched for.</p>

          <h2 className='k-h3'>Saved tools</h2>
          <p>The entries you save, on the web or through your agent, are stored against your account so you can find them again.</p>

          <h2 className='k-h3'>Analytics</h2>
          <p>Stash uses Vercel Web Analytics, which does not use cookies, to count page views and a few named steps such as opening Explore or copying a setup config. Those events never include search text, keys or anything you type.</p>

          <h2 className='k-h3'>Removing your data</h2>
          <p>To have your account and everything attached to it deleted, contact <a className='k-link' href='https://www.aruo.dev/#contact' rel='noopener'>Aruo</a>, which makes Stash.</p>

          <p className='k-small k-dim'><Link className='k-link' href='/'>Back to Stash</Link></p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
