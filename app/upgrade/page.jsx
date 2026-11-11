import Link from 'next/link';
import { db } from '@/lib/supabase';
import { getViewer, safeNext } from '@/lib/auth';
import { policyFor, canOpen } from '@/lib/access';
import { overview } from '@/lib/browse';
import { TYPE_LABELS } from '@/lib/labels';
import { TOOLKITS, toolkitFor } from '@/lib/taxonomy';
import { FREE, PRO } from '@/lib/plans';
import SiteHeader from '../_ui/SiteHeader';
import SiteFooter from '../_ui/SiteFooter';
import CategoryArt from '../_landing/CategoryArt';
import { CheckIcon, LockIcon } from '../_ui/icons';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Unlock the full library',
  description: 'Stash ' + PRO.name + ' opens the whole library, its Premium toolkits and AI recommendations in your agent.',
  alternates: { canonical: '/upgrade' },
};

// The upgrade screen. Locked toolkits and entries send people here with
// ?toolkit= or ?entry=, so it can speak to what they were trying to open, and
// ?back= so "Continue with Free" returns them to the exact view they left.
//
// There is no payment provider yet. Premium is granted by curators, so the
// upgrade button says so plainly instead of pretending to charge anyone. When
// checkout exists it must be a server-created session, with the entitlement
// set only after the provider confirms payment (lib/plans.js checkoutOpen).

export default async function Upgrade({ searchParams }) {
  const sp = await searchParams;
  const viewer = await getViewer().catch(() => null);
  const policy = await policyFor(viewer);
  const counts = await overview(policy).catch(() => null);
  const back = safeNext(typeof sp?.back === 'string' ? sp.back : '/explore');

  // What they tried to open. For an entry: only its kind and toolkit, never its name.
  let kit = TOOLKITS.find((t) => t.key === sp?.toolkit) || null;
  let entryKind = null;
  const entryId = Number(sp?.entry) || null;
  if (entryId) {
    const { data: row } = await db.from('links').select('id,type,category,access').eq('id', entryId).maybeSingle();
    if (row && !canOpen(row, policy)) {
      entryKind = (TYPE_LABELS[row.type] || 'entry').toLowerCase();
      kit = TOOLKITS.find((t) => t.key === toolkitFor(row.category)) || kit;
    }
  }

  const premiumKits = TOOLKITS.filter((t) => policy.premiumToolkits.includes(t.key));
  const isPremium = policy.level === 'premium' || policy.level === 'admin';
  const levels = counts?.levels;

  // Only what the Premium plan actually includes today.
  const unlocks = [
    ['The full library', levels ? 'all ' + levels.premium + ' entries, against ' + levels.free + ' in the Free collection' : 'every entry, not just the Free collection'],
    ...premiumKits.map((t) => [t.label, t.pitch.replace(/\.$/, '')]),
    [PRO.name + ' results over MCP', 'your agent’s searches cover everything you can open on the web'],
    ['AI recommendations in your agent', 'build_stack, compare_tools, review_project and ask_stash'],
    ['Projects', 'file the skills for each thing you build into folders, and your agent works from them with get_project'],
    ['The Stash assistant', 'ask the library anything on the web, with answers that link to entries'],
  ];

  const compare = [
    ['Entries you can open', levels ? levels.free + ', hand-picked' : 'The Free collection', levels ? 'All ' + levels.premium : 'All'],
    ['Premium toolkits', 'Locked', 'Open'],
    ['MCP connection and search', 'Free collection only', 'Whole library'],
    ['Saved tools', 'Yes', 'Yes'],
    ['AI recommendations and the assistant', 'No', 'Yes'],
    ['Projects your agent works from', 'No', 'Yes'],
  ];

  return (
    <div className='k'>
      <SiteHeader current='pricing' />
      <main id='main' className='k-wrap k-page'>
        <div className='k-section-head' style={{ marginBottom: 0 }}>
          <span className='k-eyebrow'>Stash {PRO.name}</span>
          <h1 className='k-h1' style={{ fontSize: 'var(--text-page)' }}>Unlock the full Stash library.</h1>
          <p className='k-lede'>
            Get access to more skills, plugins and workflows so your coding agent can find the right tools for more of the
            work you do.
          </p>
        </div>

        {isPremium ? (
          <div className='k-status k-status-ok' role='status'>
            <div>
              <span className='k-status-word'><span className='k-dot k-dot-ok' aria-hidden='true' />{policy.level === 'admin' ? 'You can open everything' : 'You are on ' + PRO.name}</span>
              <p>Every entry and toolkit is open to you, on the web and in your agent.</p>
            </div>
            <Link className='k-btn k-btn-sm' href={back}>Back to where you were</Link>
          </div>
        ) : kit ? (
          <div className='k-up-context'>
            <span className='k-locked-icon'><LockIcon size={18} /></span>
            <div>
              <b>{entryKind ? 'This ' + entryKind + ' in ' + kit.label + ' is part of ' + PRO.name + '.' : kit.label + ' is a ' + PRO.name + ' toolkit.'}</b>
              <p>{kit.pitch}</p>
            </div>
          </div>
        ) : null}

        {premiumKits.length ? (
          <section aria-labelledby='up-kits-h' style={{ display: 'grid', gap: 18 }}>
            <h2 id='up-kits-h' className='k-h3'>{PRO.name} toolkits</h2>
            <div className='k-up-kits'>
              {premiumKits.map((t) => {
                const c = counts?.toolkits.find((x) => x.key === t.key);
                return (
                  <div key={t.key} className={'k-up-kit' + (kit?.key === t.key ? ' is-current' : '')}>
                    <span className='k-up-art'><CategoryArt toolkit={t.key} /></span>
                    <div>
                      <b>{t.label}</b>
                      <p>{t.pitch}</p>
                      {c ? <span className='k-small k-dim'>{c.count} entries</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <div className='k-plans'>
          <section className='k-plan k-plan-pro' aria-labelledby='up-what-h'>
            <h2 id='up-what-h' className='k-h3'>What {PRO.name} unlocks</h2>
            <ul>
              {unlocks.map(([t, d]) => (
                <li key={t}><CheckIcon /><span><b>{t}</b>{d ? ': ' + d : null}</span></li>
              ))}
            </ul>
          </section>

          <section className='k-plan' aria-labelledby='up-buy-h'>
            <h2 id='up-buy-h' className='k-h3'>{PRO.name}</h2>
            <div className='k-plan-price'>{PRO.price}<small>{PRO.period}</small></div>
            {isPremium ? (
              <span className='k-btn k-btn-accent' aria-disabled='true' style={{ cursor: 'default' }}>Included in your account</span>
            ) : PRO.checkoutOpen ? (
              // A server route creates the checkout session; the price never comes from the browser.
              <form method='post' action='/api/checkout'>
                <input type='hidden' name='back' value={back} />
                <button className='k-btn k-btn-accent' type='submit'>Upgrade to {PRO.name}</button>
              </form>
            ) : (
              <>
                <button className='k-btn k-btn-accent' type='button' disabled>Upgrade to {PRO.name}</button>
                <p className='k-small k-muted' style={{ margin: 0 }}>
                  Checkout is not open yet, so nothing can be charged. Everything in {FREE.name} stays yours in the meantime.
                </p>
              </>
            )}
            {!isPremium ? (
              <Link className='k-btn' href={back}>{viewer ? 'Continue with ' + FREE.name : 'Continue browsing'}</Link>
            ) : null}
            {!viewer ? (
              <p className='k-small k-dim' style={{ margin: 0 }}>
                {FREE.name} is a Google sign-in away. <Link className='k-link' href={'/login?next=' + encodeURIComponent(back)}>Sign in</Link>
              </p>
            ) : null}
          </section>
        </div>

        <section aria-labelledby='up-cmp-h' style={{ display: 'grid', gap: 18 }}>
          <h2 id='up-cmp-h' className='k-h3'>{FREE.name} and {PRO.name}</h2>
          <div className='k-matrix-wrap'>
            <table className='k-matrix'>
              <thead><tr><th scope='col'>What you get</th><th scope='col'>{FREE.name}</th><th scope='col'>{PRO.name}</th></tr></thead>
              <tbody>
                {compare.map(([what, a, b]) => <tr key={what}><th scope='row'>{what}</th><td>{a}</td><td>{b}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p className='k-small k-dim' style={{ margin: 0 }}>
            Billing is {PRO.price} {PRO.period}. Renewal and cancellation terms will be shown before you pay.{' '}
            <Link className='k-link' href='/privacy'>Privacy</Link> · <Link className='k-link' href='/pricing'>Full pricing</Link>
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
