import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { db } from '@/lib/supabase';
import { getViewer } from '@/lib/auth';
import { policyFor, canOpen, tierOf } from '@/lib/access';
import { viewOf } from '@/lib/catalog';
import { slugOf, TYPE_LABELS } from '@/lib/labels';
import { TOOLKITS, toolkitFor } from '@/lib/taxonomy';
import SiteHeader from '../../_ui/SiteHeader';
import SiteFooter from '../../_ui/SiteFooter';
import { ArrowIcon } from '../../_ui/icons';
import EntryDetail from '../EntryDetail';
import SlowDown from '../../_ui/SlowDown';
import { headers } from 'next/headers';
import { callerOf, waitFor } from '@/lib/guard';

export const dynamic = 'force-dynamic';

const idOf = (slug) => Number(String(slug).split('-')[0]) || null;

async function rowFor(slug) {
  const id = idOf(slug);
  if (!id) return null;
  const { data } = await db.from('links').select('*').eq('id', id).maybeSingle();
  return data || null;
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const row = await rowFor(slug);
  if (!row) return { title: 'Not found' };
  // Only entries anyone may open are described to search engines; the rest
  // carry no name or summary, and are not indexed.
  const policy = await policyFor(null);
  if (!canOpen(row, policy)) {
    return { title: 'Members-only ' + (TYPE_LABELS[row.type] || 'entry').toLowerCase(), robots: { index: false } };
  }
  const description = (row.summary || row.description || '').slice(0, 300);
  return {
    title: row.title + ' · ' + (TYPE_LABELS[row.type] || 'Tool'),
    description,
    alternates: { canonical: '/explore/' + slugOf(row) },
    openGraph: { title: row.title, description, url: '/explore/' + slugOf(row), images: row.image ? [{ url: row.image }] : undefined },
  };
}

export default async function EntryPage({ params }) {
  const { slug } = await params;
  const row = await rowFor(slug);
  if (!row || row.dead) notFound();

  const viewer = await getViewer().catch(() => null);
  const wait = await waitFor('entry', callerOf({ headers: await headers() }, viewer));
  if (wait) return <SlowDown wait={wait} current='explore' />;
  const policy = await policyFor(viewer);
  const open = canOpen(row, policy);

  // One address per entry: a renamed entry's old slug redirects to the new one.
  if (open && slug !== slugOf(row)) permanentRedirect('/explore/' + slugOf(row));

  let saved = false;
  if (viewer && open) {
    const { data } = await db.from('saves').select('link_id').eq('user_id', viewer.id).eq('link_id', row.id).maybeSingle();
    saved = !!data;
  }
  const link = { ...viewOf(row, policy), saved };
  const kit = TOOLKITS.find((t) => t.key === toolkitFor(row.category));

  return (
    <div className='k'>
      <SiteHeader current='explore' />
      <main id='main' className='k-wrap'>
        <div className='k-entry'>
          <article className='k-entry-main'>
            <nav className='k-crumbs' aria-label='Breadcrumb'>
              <Link href='/explore'>Explore</Link>
              <span aria-hidden='true'>/</span>
              {kit ? <Link href={'/explore?toolkit=' + kit.key}>{kit.label}</Link> : null}
              {open ? <><span aria-hidden='true'>/</span><span>{row.title}</span></> : null}
            </nav>
            <EntryDetail link={link} signedIn={!!viewer} pro={!!viewer?.isPro} headingLevel={1} />
          </article>
          <aside className='k-entry-side'>
            <div className='k-block'>
              <div className='k-block-head'>
                <h2 className='k-h3'>Let your agent find tools like this</h2>
                <p className='k-muted k-small' style={{ margin: 0 }}>
                  Connect Stash to Claude Code, Cursor or GitHub Copilot and it searches the library while you work.
                  {tierOf(row, policy) !== 'public' && !open ? ' Your agent sees this entry once your plan includes it.' : ''}
                </p>
              </div>
              <Link className='k-btn k-btn-accent' href='/connect'>Connect your agent</Link>
            </div>
            <Link className='k-arrow' href={kit ? '/explore?toolkit=' + kit.key : '/explore'}>
              More in {kit ? kit.label : 'the library'} <ArrowIcon />
            </Link>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
