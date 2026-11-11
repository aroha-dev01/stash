import { premiumMember, body, failed, json } from '@/lib/projectApi';
import { listProjects, createProject } from '@/lib/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The member's projects, with folders and counts. */
export async function GET(req) {
  const { viewer, error } = await premiumMember(req);
  if (error) return error;
  try {
    return json({ projects: await listProjects(viewer.id) });
  } catch (e) {
    return failed(e);
  }
}

/** Make a project: { name, description?, template? }. Its template's folders come with it. */
export async function POST(req) {
  const { viewer, error } = await premiumMember(req, { write: true });
  if (error) return error;
  try {
    const project = await createProject(viewer.id, await body(req));
    return json({ project }, 201);
  } catch (e) {
    return failed(e);
  }
}
