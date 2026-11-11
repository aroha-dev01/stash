import { premiumMember, body, failed, json } from '@/lib/projectApi';
import { addFolder, renameFolder, reorderFolders, deleteFolder } from '@/lib/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Add a folder: { name?, kind? }. A known kind (backend, design...) brings its own suggestions. */
export async function POST(req, { params }) {
  const { id } = await params;
  const { viewer, error } = await premiumMember(req, { write: true });
  if (error) return error;
  try {
    return json({ folder: await addFolder(viewer.id, id, await body(req)) }, 201);
  } catch (e) {
    return failed(e);
  }
}

/** Rename one folder, { folder_id, name }, or put them all in order, { order: [folder ids] }. */
export async function PATCH(req, { params }) {
  const { id } = await params;
  const { viewer, error } = await premiumMember(req, { write: true });
  if (error) return error;
  try {
    const b = await body(req);
    if (Array.isArray(b.order)) {
      await reorderFolders(viewer.id, id, b.order);
      return json({ ok: true });
    }
    return json({ folder: await renameFolder(viewer.id, id, b.folder_id, b.name) });
  } catch (e) {
    return failed(e);
  }
}

/** Delete a folder and what is filed in it: ?folder_id= */
export async function DELETE(req, { params }) {
  const { id } = await params;
  const { viewer, error } = await premiumMember(req, { write: true });
  if (error) return error;
  try {
    await deleteFolder(viewer.id, id, req.nextUrl.searchParams.get('folder_id'));
    return json({ ok: true });
  } catch (e) {
    return failed(e);
  }
}
