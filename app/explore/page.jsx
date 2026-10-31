import { getViewer } from '@/lib/auth';
import { policyFor, TIERS } from '@/lib/access';
import { browse, overview } from '@/lib/browse';
import { db } from '@/lib/supabase';
import { TOOLKITS } from '@/lib/taxonomy';
import SiteHeader from '../_ui/SiteHeader';
import SiteFooter from '../_ui/SiteFooter';
import Explore from './explore';

export const dynamic = 'force-dynamic';

const SORTS = ['newest', 'oldest', 'stars', 'title'];
const str = (v) => (typeof v === 'string' ? v : '');

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  const kit = TOOLKITS.find((t) => t.key === sp?.toolkit);
  return {
    title: kit ? kit.label + ' tools, skills and MCP servers' : 'Explore the library',
    description: kit
      ? kit.blurb + ' Curated for developers and their coding agents.'
      : 'Find skills, plugins, MCP servers and developer tools for the work you are doing, curated for you and your coding agent.',
    alternates: { canonical: kit ? '/explore?toolkit=' + kit.key : '/explore' },
  };
}

export default async function ExplorePage({ searchParams }) {
  const sp = await searchParams;
  const viewer = await getViewer().catch(() => null);
  const policy = await policyFor(viewer);

  const initial = {
    q: str(sp?.q).slice(0, 200),
    toolkit: TOOLKITS.some((t) => t.key === sp?.toolkit) ? sp.toolkit : null,
    type: str(sp?.type) || null,
    access: viewer && TIERS.includes(sp?.access) ? sp.access : null,
    sort: SORTS.includes(sp?.sort) ? sp.sort : 'newest',
    saved: sp?.saved === '1' && !!viewer,
    open: Number(sp?.open) || null,
  };

  let ids = null;
  if (initial.saved) {
    const { data } = await db.from('saves').select('link_id').eq('user_id', viewer.id);
    ids = (data || []).map((r) => r.link_id);
    if (!ids.length) ids = [-1];
  }

  // The first page renders on the server, so it is there without JavaScript
  // and for crawlers. Each piece fails on its own; the client retries.
  const [counts, featured, first] = await Promise.all([
    overview(policy).catch(() => null),
    browse(policy, { featured: true, limit: 10 }).catch(() => ({ items: [] })),
    browse(policy, { ...initial, ids, limit: 24, countHidden: !initial.saved }).catch(() => null),
  ]);

  let page = first;
  if (page && viewer && page.items.length) {
    const { data } = await db.from('saves').select('link_id').eq('user_id', viewer.id).in('link_id', page.items.map((i) => i.id));
    const saved = new Set((data || []).map((r) => r.link_id));
    page = { ...page, items: page.items.map((i) => ({ ...i, saved: saved.has(i.id) })) };
  }

  return (
    <div className='k'>
      <SiteHeader current={initial.saved ? 'saved' : 'explore'} />
      <main id='main' className='k-wrap' style={{ paddingBottom: 'var(--section)' }}>
        <Explore
          signedIn={!!viewer}
          level={policy.level}
          initial={initial}
          initialPage={page}
          overview={counts}
          featured={featured.items}
          welcome={sp?.welcome === '1' && !!viewer}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
