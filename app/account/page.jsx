import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { connectionOf } from '@/lib/mcpkeys';
import { db } from '@/lib/supabase';
import { PRO, FREE } from '@/lib/plans';
import { listProjects } from '@/lib/projects';
import SiteHeader from '../_ui/SiteHeader';
import ProjectMap from '../projects/ProjectMap';
import SiteFooter from '../_ui/SiteFooter';
import { clientLabel } from '../_ui/agents';
import { ArrowIcon } from '../_ui/icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account', robots: { index: false } };

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null);

export default async function Account() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/account');

  const [conn, { count: saved }, projects] = await Promise.all([
    connectionOf(viewer.id),
    db.from('saves').select('link_id', { count: 'exact', head: true }).eq('user_id', viewer.id),
    viewer.isPro ? listProjects(viewer.id).catch(() => []) : Promise.resolve([]),
  ]);

  // Plan and role are separate: a curator may be on either plan.
  const plan = viewer.plan === 'pro' ? PRO.name : FREE.name;

  return (
    <div className='k'>
      <SiteHeader current='account' />
      <main id='main' className='k-wrap k-page'>
        <div className='k-page-head'>
          <div className='k-me'>
            {viewer.avatar ? (
              <img className='k-avatar' src={viewer.avatar} alt='' referrerPolicy='no-referrer' />
            ) : (
              <span className='k-avatar'>{(viewer.name || '?').slice(0, 1).toUpperCase()}</span>
            )}
            <div style={{ minWidth: 0 }}>
              <h1 className='k-h3' style={{ fontSize: 26 }}>{viewer.name}</h1>
              <span className='k-muted k-small'>{viewer.email}</span>
            </div>
          </div>
          <div className='k-d-actions'>
            <span className={'k-badge' + (viewer.plan === 'pro' ? ' k-badge-pro' : '')}>{plan} plan</span>
            {viewer.isAdmin ? <span className='k-badge'>Curator</span> : null}
          </div>
        </div>

        <section className={'k-status' + (conn.connected ? ' k-status-ok' : conn.keys ? ' k-status-wait' : '')} id='connect' aria-labelledby='conn-h'>
          <div>
            <h2 id='conn-h' className='k-status-word'>
              <span className={'k-dot' + (conn.connected ? ' k-dot-ok' : '')} aria-hidden='true' />
              {conn.connected ? 'Agent connected' : conn.keys ? 'Key created, no calls yet' : 'No agent connected'}
            </h2>
            <p>
              {conn.connected
                ? 'Last call ' + when(conn.lastUsedAt) + (conn.lastClient ? ' from ' + clientLabel(conn.lastClient) : '') + ', with the key “' + conn.keyName + '”.'
                : conn.keys
                  ? 'Stash has not received a call with your ' + (conn.keys === 1 ? 'key' : conn.keys + ' keys') + ' yet. The setup guide walks through the last steps.'
                  : 'Connect Claude Code, Cursor, GitHub Copilot or any MCP client in a few minutes.'}
            </p>
          </div>
          <Link className={'k-btn ' + (conn.connected ? '' : 'k-btn-accent')} href='/connect'>{conn.connected ? 'Manage keys' : 'Connect your agent'}</Link>
        </section>

        <section className='k-block k-pj-acct' aria-labelledby='proj-h'>
          <div className='k-block-row'>
            <div className='k-block-head'>
              <h2 id='proj-h' className='k-h3'>
                Projects {viewer.isPro ? null : <span className='k-pro'>{PRO.name}</span>}
              </h2>
              <p className='k-muted' style={{ margin: 0 }}>
                {!viewer.isPro
                  ? 'Make a project for each thing you build, file the skills it needs into folders like Frontend and Backend, and your agent works from them in every session.'
                  : projects.length
                    ? projects.length + (projects.length === 1 ? ' project, ' : ' projects, ') + projects.reduce((n, p) => n + p.skills, 0) + ' skills filed. Tell your agent which project you are on and it works from them.'
                    : 'Make a project for each thing you build, and file the skills each part of it needs.'}
              </p>
            </div>
            <Link className={'k-btn' + (viewer.isPro && projects.length ? '' : ' k-btn-accent')} href={viewer.isPro ? (projects.length ? '/projects' : '/projects?new=1') : '/projects'}>
              {viewer.isPro ? (projects.length ? 'Open projects' : 'Make a project') : 'See projects'}
            </Link>
          </div>
          {viewer.isPro && projects.length ? (
            <ul className='k-pj-acct-list'>
              {projects.slice(0, 3).map((p) => (
                <li key={p.id}>
                  <Link href={'/projects/' + p.slug}>
                    <ProjectMap name={p.name} folders={p.folders} mini height={96} />
                    <b>{p.name}</b>
                    <span className='k-small k-dim'>{p.folders.length} folders · {p.skills} skills</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <div className='k-plans'>
          <section className='k-block' aria-labelledby='saved-h'>
            <div className='k-block-head'>
              <h2 id='saved-h' className='k-h3'>Saved tools</h2>
              <p className='k-muted' style={{ margin: 0 }}>
                {saved ? saved + (saved === 1 ? ' entry' : ' entries') + ' saved, from the web and from your agent.' : 'Nothing saved yet. Bookmark entries on Explore, or let your agent save what it adopts.'}
              </p>
            </div>
            <Link className='k-arrow' href='/explore?saved=1'>Open saved tools <ArrowIcon /></Link>
          </section>

          <section className='k-block' aria-labelledby='plan-h'>
            <div className='k-block-head'>
              <h2 id='plan-h' className='k-h3'>Plan</h2>
              <p className='k-muted' style={{ margin: 0 }}>
                {viewer.plan === 'pro'
                  ? 'You are on ' + PRO.name + ': every entry and toolkit, AI recommendations in your agent and the Stash assistant.'
                  : viewer.isAdmin
                    ? 'You are on ' + FREE.name + '. As a curator you also have every entry and feature.'
                    : 'You are on ' + FREE.name + ': the Free collection, saved tools and MCP discovery. ' + PRO.name + ' opens the full library and AI recommendations for ' + PRO.price + ' ' + PRO.period + '.'}
              </p>
            </div>
            <Link className='k-arrow' href='/pricing'>{viewer.isPro ? 'See what is included' : 'See ' + PRO.name} <ArrowIcon /></Link>
          </section>
        </div>

        <section className='k-block' id='settings' aria-labelledby='set-h'>
          <div className='k-block-head'>
            <h2 id='set-h' className='k-h3'>Settings</h2>
          </div>
          <div className='k-setting'>
            <div>
              <b>Name, email and picture</b>
              <span className='k-small k-dim'>From your Google account. Change them there and they update here at your next sign-in.</span>
            </div>
          </div>
          <div className='k-setting'>
            <div>
              <b>Agent keys</b>
              <span className='k-small k-dim'>Create, rotate and revoke the keys your agents connect with.</span>
            </div>
            <Link className='k-btn k-btn-sm' href='/connect#keys'>Manage keys</Link>
          </div>
          <div className='k-setting'>
            <div>
              <b>Sign out</b>
              <span className='k-small k-dim'>Ends your session in this browser. Your agents stay connected until you revoke their keys.</span>
            </div>
            <form method='post' action='/auth/signout'>
              <button className='k-btn k-btn-sm' type='submit'>Sign out</button>
            </form>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
