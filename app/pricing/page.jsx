import Link from 'next/link';
import { getViewer } from '@/lib/auth';
import { policyFor } from '@/lib/access';
import { overview } from '@/lib/browse';
import { MAX_ACTIVE_KEYS } from '@/lib/mcpkeys';
import { TOOLKITS } from '@/lib/taxonomy';
import { FREE, PRO } from '@/lib/plans';
import SiteHeader from '../_ui/SiteHeader';
import SiteFooter from '../_ui/SiteFooter';
import { CheckIcon } from '../_ui/icons';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Pricing',
  description: 'Stash is free with a Google sign-in, MCP connection included. ' + PRO.name + ' adds premium entries and AI recommendations for ' + PRO.price + ' ' + PRO.period + '.',
  alternates: { canonical: '/pricing' },
};

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
  const policy = await policyFor(viewer);
  const levels = (await overview(policy).catch(() => null))?.levels;
  const lockedNames = TOOLKITS.filter((t) => policy.premiumToolkits.includes(t.key)).map((t) => t.label);
  const n = (k, fallback) => (levels ? String(levels[k]) : fallback);

  // Every line here is what lib/access.js and the MCP server actually enforce.
  const free = [
    ['The Free collection', n('free', 'a') + ' hand-picked skills and tools, on the web and in your agent'],
    ['MCP connection', 'Claude Code, Cursor, GitHub Copilot in VS Code, Claude, Windsurf and any remote MCP client, up to ' + MAX_ACTIVE_KEYS + ' keys'],
    ['Search by task', 'describe what you are building; Stash matches by meaning as well as keywords'],
    ['Details and install steps', 'in your agent: search_tools, get_tool, how_to_use, find_inspiration'],
    ['Saved tools', 'bookmark on the web, or let your agent save what it adopts'],
  ];
  const pro = [
    ['Everything in ' + FREE.name, null],
    ['The full library', n('premium', 'every') + ' entries' + (lockedNames.length ? ', including the ' + lockedNames.join(', ') + ' ' + (lockedNames.length === 1 ? 'toolkit' : 'toolkits') : '') + ', on the web and in your agent'],
    ['Stack building', 'your agent describes a project and gets tools that fit together, with runners-up'],
    ['Comparisons', 'similar tools side by side, with the question that settles the choice'],
    ['Project reviews', 'improvements to a codebase drawn from the catalogue'],
    ['The Stash assistant', 'ask the catalogue anything on the web, with answers that link to entries'],
  ];

  const MATRIX = [
    ['Entries you can open', n('visitor', 'A sample'), n('free', 'The Free collection'), n('premium', 'All')],
    [PRO.name + (lockedNames.length ? ' toolkits and entries' : ' entries'), 'Locked', 'Locked', 'Yes'],
    ['Connect an agent over MCP', 'No', 'Yes', 'Yes'],
    ['Saved tools', 'No', 'Yes', 'Yes'],
    ['AI recommendations in your agent', 'No', 'No', 'Yes'],
    ['The Stash assistant on the web', 'No', 'No', 'Yes'],
  ];

  const FAQ = [
    ['Do I need a card for ' + FREE.name + '?', 'No. Sign in with Google and everything in ' + FREE.name + ' is yours, including the MCP connection.'],
    ['What does my MCP key give access to?', 'Exactly what your plan opens on the web: the same entries, the same tools. Stash stores only a fingerprint of each key, and you can revoke one at any time.'],
    ['What is locked, and how will I know?', 'Toolkits reserved for ' + PRO.name + ' stay on the homepage and Explore with a ' + PRO.name + ' label, and Explore says how many more entries sit behind sign-in or ' + PRO.name + '. What is inside never reaches a plan that does not include it, on the web or through MCP.'],
    ['Will Stash install anything on my machine?', 'No. Your agent receives recommendations and install steps, and nothing is installed until you or your agent run the command.'],
  ];

  return (
    <div className='k'>
      <SiteHeader current='pricing' />
      <main id='main' className='k-wrap k-page'>
        <div className='k-section-head' style={{ marginBottom: 0 }}>
          <span className='k-eyebrow'>Pricing</span>
          <h1 className='k-h1' style={{ fontSize: 'var(--text-page)' }}>One library. Two ways to use it.</h1>
          <p className='k-lede'>Discovery and the MCP connection are free for every member. {PRO.name} opens the premium entries and pays for the model calls behind the AI recommendations.</p>
        </div>

        <div className='k-plans'>
          <section className='k-plan' aria-labelledby='plan-free'>
            <h2 id='plan-free' className='k-h3'>{FREE.name}</h2>
            <div className='k-plan-price'>{FREE.price}</div>
            <ul>{free.map(([t, d]) => <Item key={t} title={t} detail={d} />)}</ul>
            {viewer ? (
              <span className='k-btn' aria-disabled='true' style={{ cursor: 'default' }}>
                {viewer.plan === 'pro' ? 'Included in your plan' : 'Your current plan'}
              </span>
            ) : (
              <Link className='k-btn k-btn-primary' href='/login?next=/connect'>Sign in with Google</Link>
            )}
          </section>

          <section className='k-plan k-plan-pro' aria-labelledby='plan-pro'>
            <h2 id='plan-pro' className='k-h3'>{PRO.name}</h2>
            <div className='k-plan-price'>{PRO.price}<small>{PRO.period}</small></div>
            <ul>{pro.map(([t, d]) => <Item key={t} title={t} detail={d} />)}</ul>
            {viewer?.plan === 'pro' ? (
              <span className='k-btn k-btn-accent' aria-disabled='true' style={{ cursor: 'default' }}>You are on {PRO.name}</span>
            ) : viewer && PRO.checkoutOpen ? (
              <Link className='k-btn k-btn-accent' href='/account'>Upgrade to {PRO.name}</Link>
            ) : viewer ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <button className='k-btn k-btn-accent' disabled>Upgrade to {PRO.name}</button>
                <span className='k-small k-muted'>Payments open soon. Everything in {FREE.name} works today.</span>
              </div>
            ) : (
              <Link className='k-btn k-btn-accent' href='/login?next=/pricing'>Sign in to upgrade</Link>
            )}
          </section>
        </div>

        <section aria-labelledby='matrix-h' style={{ display: 'grid', gap: 20 }}>
          <h2 id='matrix-h' className='k-h2' style={{ fontSize: 'clamp(26px, 3vw, 36px)' }}>Who can do what</h2>
          <div className='k-matrix-wrap'>
            <table className='k-matrix'>
              <thead>
                <tr><th scope='col'>Capability</th><th scope='col'>Signed out</th><th scope='col'>{FREE.name}</th><th scope='col'>{PRO.name}</th></tr>
              </thead>
              <tbody>
                {MATRIX.map(([cap, ...cells]) => (
                  <tr key={cap}><th scope='row'>{cap}</th>{cells.map((c, i) => <td key={i}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby='faq-h' style={{ maxWidth: 760 }}>
          <h2 id='faq-h' className='k-h2' style={{ marginBottom: 20, fontSize: 'clamp(26px, 3vw, 36px)' }}>Questions</h2>
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
