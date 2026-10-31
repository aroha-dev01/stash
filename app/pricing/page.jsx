import Link from 'next/link';
import { getViewer } from '@/lib/auth';
import SiteHeader from '../_ui/SiteHeader';
import SiteFooter from '../_ui/SiteFooter';
import { CheckIcon } from '../_ui/icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pricing' };

const FREE = [
  ['The whole catalogue', 'every toolkit, members-only entries included'],
  ['Saved tools', 'bookmark what you want to come back to'],
  ['MCP connection', 'for Claude, Claude Code, Cursor, VS Code, Windsurf and any MCP client'],
  ['Discovery in your agent', 'search by task, full details, install steps and inspiration'],
];

const PRO = [
  ['Everything in Free', null],
  ['Stack building', 'your agent asks for a project and gets tools that fit together, with runners-up'],
  ['Comparisons', 'similar tools side by side, with the question that settles the choice'],
  ['Project reviews', 'improvements to a codebase drawn from the catalogue'],
  ['The Stash assistant', 'ask the catalogue anything on the web, with answers that link to entries'],
];

const FAQ = [
  ['Do I need a card for Free?', 'No. Sign in with Google and everything in Free is yours, including the MCP connection.'],
  ['What does my MCP key give access to?', 'Read access to the catalogue and your own saved list, at the level of your plan. Stash stores only a fingerprint of the key, and you can revoke it from your account at any time.'],
  ['Will Stash install anything on my machine?', 'No. Your agent receives recommendations and install steps, and nothing is installed until you or your agent run the command.'],
];

function Item({ title, detail }) {
  return (
    <li>
      <CheckIcon />
      <span><b>{title}</b>{detail ? ': ' + detail : null}</span>
    </li>
  );
}

export default async function Pricing() {
  const viewer = await getViewer().catch(() => null);

  return (
    <div className='k'>
      <SiteHeader current='pricing' />
      <main className='k-wrap k-page'>
        <div className='k-section-head' style={{ marginBottom: 0 }}>
          <h1 className='k-h1' style={{ fontSize: 'clamp(36px, 5vw, 60px)' }}>One catalogue. Two ways to use it.</h1>
          <p className='k-lede'>Discovery is free for every member. Pro pays for the model calls behind the AI recommendations.</p>
        </div>

        <div className='k-plans'>
          <section className='k-plan' aria-labelledby='plan-free'>
            <h2 id='plan-free' className='k-h3'>Free</h2>
            <div className='k-plan-price'>$0</div>
            <ul>{FREE.map(([t, d]) => <Item key={t} title={t} detail={d} />)}</ul>
            {viewer ? (
              <span className='k-btn' aria-disabled='true' style={{ cursor: 'default' }}>
                {viewer.isPro ? 'Included in your plan' : 'Your current plan'}
              </span>
            ) : (
              <Link className='k-btn' href='/login?next=/account'>Sign in with Google</Link>
            )}
          </section>

          <section className='k-plan k-plan-pro' aria-labelledby='plan-pro'>
            <h2 id='plan-pro' className='k-h3'>Pro</h2>
            <div className='k-plan-price'>$1<small>per month</small></div>
            <ul>{PRO.map(([t, d]) => <Item key={t} title={t} detail={d} />)}</ul>
            {viewer?.isPro ? (
              <span className='k-btn k-btn-brass' aria-disabled='true' style={{ cursor: 'default' }}>You are on Pro</span>
            ) : viewer ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <button className='k-btn k-btn-brass' disabled>Upgrade to Pro</button>
                <span className='k-small k-muted'>Payments open soon. Everything in Free works today.</span>
              </div>
            ) : (
              <Link className='k-btn k-btn-brass' href='/login?next=/pricing'>Sign in to upgrade</Link>
            )}
          </section>
        </div>

        <section aria-labelledby='faq-h' style={{ maxWidth: 760 }}>
          <h2 id='faq-h' className='k-h2' style={{ marginBottom: 20 }}>Questions</h2>
          <div className='k-faq'>
            {FAQ.map(([q, a]) => (
              <div key={q}>
                <h3>{q}</h3>
                <p>{a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
