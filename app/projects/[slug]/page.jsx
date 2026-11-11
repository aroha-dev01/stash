import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { policyFor } from '@/lib/access';
import { findProject, loadProject } from '@/lib/projects';
import { connectionOf } from '@/lib/mcpkeys';
import SiteHeader from '../../_ui/SiteHeader';
import SiteFooter from '../../_ui/SiteFooter';
import { clientLabel } from '../../_ui/agents';
import PremiumGate from '../PremiumGate';
import Workspace from './workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Project', robots: { index: false } };

export default async function ProjectPage({ params }) {
  const { slug } = await params;
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=' + encodeURIComponent('/projects/' + slug));

  if (!viewer.isPro) {
    return (
      <div className='k'>
        <SiteHeader current='projects' />
        <main id='main' className='k-wrap k-page'>
          <PremiumGate viewer={viewer} back={'/projects/' + slug} />
        </main>
        <SiteFooter />
      </div>
    );
  }

  const project = await findProject(viewer.id, slug);
  if (!project) notFound();
  if (project.slug !== slug) redirect('/projects/' + project.slug);

  const [data, conn] = await Promise.all([
    loadProject(viewer.id, project, await policyFor(viewer)),
    connectionOf(viewer.id),
  ]);

  return (
    <div className='k'>
      <SiteHeader current='projects' />
      <main id='main' className='k-wrap k-page k-pj-page'>
        <Workspace
          key={project.id}
          initial={{ project: data.project, folders: data.folders }}
          agent={{ connected: conn.connected, lastClient: conn.lastClient ? clientLabel(conn.lastClient) : null }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
