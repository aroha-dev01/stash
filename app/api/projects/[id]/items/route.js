import { premiumMember, policyOf, body, failed, json } from '@/lib/projectApi';
import { addItem, updateItem, removeItem } from '@/lib/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** File an entry in a folder: { folder_id, link_id, note? }. Filing it twice is harmless. */
export async function POST(req, { params }) {
  const { id } = await params;
  const { viewer, error } = await premiumMember(req, { write: true });
  if (error) return error;
  try {
    const result = await addItem(viewer.id, id, await body(req), await policyOf(viewer));
    return json(result, result.added ? 201 : 200);
  } catch (e) {
    return failed(e);
  }
}

/** Move to another folder and/or change why it is there: { folder_id, link_id, to_folder_id?, note? }. */
export async function PATCH(req, { params }) {
  const { id } = await params;
  const { viewer, error } = await premiumMember(req, { write: true });
  if (error) return error;
  try {
    return json({ item: await updateItem(viewer.id, id, await body(req)) });
  } catch (e) {
    return failed(e);
  }
}

/** Take an entry out of a folder: ?folder_id=&link_id= */
export async function DELETE(req, { params }) {
  const { id } = await params;
  const { viewer, error } = await premiumMember(req, { write: true });
  if (error) return error;
  try {
    const p = req.nextUrl.searchParams;
    await removeItem(viewer.id, id, p.get('folder_id'), p.get('link_id'));
    return json({ ok: true });
  } catch (e) {
    return failed(e);
  }
}
