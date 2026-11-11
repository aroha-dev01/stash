import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { listProjects } from '@/lib/projects';
import { PRO } from '@/lib/plans';
import SiteHeader from '../_ui/SiteHeader';
import SiteFooter from '../_ui/SiteFooter';
import PremiumGate from './PremiumGate';
import HowItWorks from './HowItWorks';
import ProjectsHome from './projects';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projects', robots: { index: false } };

export default async function Projects({ searchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/projects');

  return (
    <div className='k'>
      <SiteHeader current='projects' />
      <main id='main' className='k-wrap k-page'>
        {viewer.isPro ? (
          <>
            <div className='k-section-head' style={{ marginBottom: 0 }}>
              <span className='k-eyebrow'>{PRO.name} · Projects</span>
              <h1 className='k-h1' style={{ fontSize: 'var(--text-page)' }}>Your projects</h1>
              <p className='k-lede'>
                One project for each thing you build. File the skills each part of it needs, then tell your agent which
                project you are on, and it works from your picks in every session.
              </p>
            </div>
            <ProjectsHome initial={await listProjects(viewer.id)} startOpen={(await searchParams)?.new === '1'} />
            <HowItWorks />
          </>
        ) : (
          <PremiumGate viewer={viewer} />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
