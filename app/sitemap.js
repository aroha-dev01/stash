import { db } from '@/lib/supabase';
import { policyFor, canOpen } from '@/lib/access';
import { slugOf } from '@/lib/labels';
import { TOOLKITS } from '@/lib/taxonomy';

export const dynamic = 'force-dynamic';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://stashkit.vercel.app';

/** Public pages, the toolkits, and every entry anyone may open. Nothing behind sign-in or Pro. */
export default async function sitemap() {
  const pages = ['', '/explore', '/pricing', '/connect', '/privacy'].map((p) => ({ url: SITE + p, changeFrequency: 'weekly' }));
  const kits = TOOLKITS.map((t) => ({ url: SITE + '/explore?toolkit=' + t.key, changeFrequency: 'weekly' }));
  try {
    const policy = await policyFor(null);
    const { data } = await db.from('links').select('id,title,domain,category,access,updated_at').eq('dead', false);
    const entries = (data || [])
      .filter((r) => canOpen(r, policy))
      .map((r) => ({ url: SITE + '/explore/' + slugOf(r), lastModified: r.updated_at || undefined, changeFrequency: 'monthly' }));
    return [...pages, ...kits, ...entries];
  } catch {
    return [...pages, ...kits];
  }
}
