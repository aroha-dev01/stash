import { premiumMember, policyOf, body, failed, json } from '@/lib/projectApi';
import { loadProject, updateProject, deleteProject, isUuid, ProjectError } from '@/lib/projects';
import { db } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One project, its folders and the entries filed in them. */
export async function GET(req, { params }) {
  const { id } = await params;
  const { viewer, error } = await premiumMember(req);
  if (error) return error;
  try {
    if (!isUuid(id)) throw new ProjectError('Not found.', 404);
    const { data: project } = await db
      .from('projects').select('id,name,slug,description,template,created_at,updated_at')
      .eq('id', id).eq('user_id', viewer.id).maybeSingle();
    if (!project) throw new ProjectError('Not found.', 404);
    return json(await loadProject(viewer.id, project, await policyOf(viewer)));
  } catch (e) {
    return failed(e);
  }
}

/** Rename or describe: { name?, description? }. */
export async function PATCH(req, { params }) {
  const { id } = await params;
  const { viewer, error } = await premiumMember(req, { write: true });
  if (error) return error;
  try {
    return json({ project: await updateProject(viewer.id, id, await body(req)) });
  } catch (e) {
    return failed(e);
  }
}

/** Delete the project with its folders. The catalogue entries themselves are untouched. */
export async function DELETE(req, { params }) {
  const { id } = await params;
  const { viewer, error } = await premiumMember(req, { write: true });
  if (error) return error;
  try {
    await deleteProject(viewer.id, id);
    return json({ ok: true });
  } catch (e) {
    return failed(e);
  }
}
