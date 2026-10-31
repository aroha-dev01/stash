import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import SiteHeader from '../_ui/SiteHeader';
import Console from './console';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Curate' };

const TABS = ['overview', 'catalogue', 'members', 'shortcut', 'settings'];

/** The curator console: catalogue, members, the iOS share sheet and site settings. Admins only. */
export default async function AdminPage({ searchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/admin');
  if (!viewer.isAdmin) redirect('/explore');

  const sp = await searchParams;
  const tab = TABS.includes(sp?.tab) ? sp.tab : 'overview';

  // Addresses follow whichever domain this is served on, so the shortcut
  // guide is right locally, on previews and in production.
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https');

  return (
    <div className='k'>
      <SiteHeader current='admin' />
      <Console
        initialTab={tab}
        origin={proto + '://' + host}
        viewer={{ id: viewer.id, name: viewer.name, email: viewer.email }}
      />
    </div>
  );
}
