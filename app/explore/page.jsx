import { getViewer } from '@/lib/auth';
import SiteHeader from '../_ui/SiteHeader';
import SiteFooter from '../_ui/SiteFooter';
import Explore from './explore';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Explore the catalogue' };

export default async function ExplorePage({ searchParams }) {
  const sp = await searchParams;
  const viewer = await getViewer().catch(() => null);
  const saved = sp?.saved === '1' && !!viewer;

  return (
    <div className='k'>
      <SiteHeader current={saved ? 'saved' : 'explore'} />
      <main className='k-wrap'>
        <Explore
          signedIn={!!viewer}
          initial={{
            q: typeof sp?.q === 'string' ? sp.q : '',
            toolkit: typeof sp?.toolkit === 'string' ? sp.toolkit : null,
            type: typeof sp?.type === 'string' ? sp.type : null,
            saved,
            open: Number(sp?.open) || null,
          }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
