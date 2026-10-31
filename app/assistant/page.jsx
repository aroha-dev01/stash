import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { PRO } from '@/lib/plans';
import SiteHeader from '../_ui/SiteHeader';
import Assistant from './assistant';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/assistant');

  return (
    <div className='k'>
      <SiteHeader current='assistant' />
      {viewer.isPro ? (
        <Assistant />
      ) : (
        <main className='k-auth'>
          <div className='k-auth-card'>
            <h1 className='k-h2'>Ask the catalogue anything</h1>
            <p className='k-lede'>
              The Stash assistant reads the whole catalogue and answers with the entries that fit, each one linked.
              It is part of {PRO.name}, together with AI recommendations in your agent.
            </p>
            <div><Link className='k-btn k-btn-brass' href='/pricing'>See {PRO.name}</Link></div>
          </div>
        </main>
      )}
    </div>
  );
}
