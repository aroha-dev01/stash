import { db } from './supabase.js';
import { canOpen } from './access.js';
import { publicLink, PUBLIC_FIELDS } from './catalog.js';
import { LIMITS, isKind, templateOf, presetOf, toneOf } from './projectTemplates.js';

// Projects: a Premium member's skill sets, one per thing they build, split
// into folders (Frontend, Backend, UI/UX...). The website edits them; an agent
// reads them over MCP so every session on a project uses the same tools.
//
// Every function takes the member's id from the caller's verified session or
// key, never from the request body, and scopes every query by it. The
// database backs that up: composite foreign keys mean a folder or item can
// only ever sit under a project of the same member. Plan checks (Premium) live
// with the callers, lib/projectApi.js and the MCP server, because both doors
// must ask them.

export { LIMITS };

export class ProjectError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => UUID.test(String(s || ''));

// Control characters, line and paragraph separators, zero-width and bidi
// overrides. Built from a string, so no raw separator character ever sits in a
// regex literal, where it would end the literal and break the bundle.
const UNSAFE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]', 'g');

/** One line of plain text: control characters out, whitespace collapsed, capped. */
export function clean(value, max) {
  return String(value ?? '')
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function slugify(name) {
  return (
    String(name || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'project'
  );
}

/** Turns a database refusal into something a member can act on. Unknown errors stay generic. */
function fail(error, what = 'That') {
  const m = error?.message || '';
  if (m.includes('stash_limit_projects')) return new ProjectError('You have ' + LIMITS.projects + ' projects, the most there can be. Delete one to make another.', 409);
  if (m.includes('stash_limit_folders')) return new ProjectError('A project holds up to ' + LIMITS.folders + ' folders.', 409);
  if (m.includes('stash_limit_folder_items')) return new ProjectError('A folder holds up to ' + LIMITS.perFolder + ' skills.', 409);
  if (m.includes('stash_limit_items')) return new ProjectError('A project holds up to ' + LIMITS.items + ' skills.', 409);
  if (error?.code === '23505') return new ProjectError(what + ' already exists.', 409);
  if (error?.code === '23503') return new ProjectError('Not found.', 404);
  if (error?.code === '23514' || error?.code === '22001') return new ProjectError('That is too long or not allowed.', 400);
  console.error('projects:', error?.code, m);
  return new ProjectError('Something went wrong. Try again.', 500);
}

const PROJECT_COLS = 'id,name,slug,description,template,created_at,updated_at';
const FOLDER_COLS = 'id,project_id,name,kind,position,created_at';
const ITEM_COLS = 'folder_id,project_id,link_id,note,position,created_at';

const shapeFolder = (f) => ({ id: f.id, name: f.name, kind: isKind(f.kind) ? f.kind : 'custom', position: f.position, tone: toneOf(f) });

async function touch(userId, projectId) {
  await db.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', userId);
}

/* ----------------------------------------------------------------- reading */

/** Every project this member has, newest work first, with folder counts for the cards and the map. */
export async function listProjects(userId) {
  const [{ data: projects, error }, { data: folders }, { data: items }] = await Promise.all([
    db.from('projects').select(PROJECT_COLS).eq('user_id', userId).order('updated_at', { ascending: false }),
    db.from('project_folders').select(FOLDER_COLS).eq('user_id', userId).order('position').order('created_at'),
    db.from('project_items').select('folder_id,project_id,link_id').eq('user_id', userId),
  ]);
  if (error) throw fail(error);

  const count = new Map();
  for (const i of items || []) count.set(i.folder_id, (count.get(i.folder_id) || 0) + 1);

  return (projects || []).map((p) => {
    const fs = (folders || []).filter((f) => f.project_id === p.id).map((f) => ({ ...shapeFolder(f), count: count.get(f.id) || 0 }));
    return { ...p, folders: fs, skills: fs.reduce((n, f) => n + f.count, 0) };
  });
}

/** How many projects a member keeps, for pages that show a count without opening them. */
export async function countProjects(userId) {
  const { count } = await db.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  return count || 0;
}

/**
 * Finds one of the member's projects by id, slug or name (any case), so an
 * agent told "I'm working on ABC" finds the project called ABC.
 */
export async function findProject(userId, ref) {
  const r = String(ref ?? '').trim();
  if (!r) throw new ProjectError('Which project? Pass its name.', 400);
  const { data, error } = await db.from('projects').select(PROJECT_COLS).eq('user_id', userId);
  if (error) throw fail(error);
  const all = data || [];
  const lower = r.toLowerCase();
  return (
    (isUuid(r) && all.find((p) => p.id === r.toLowerCase())) ||
    all.find((p) => p.slug === lower) ||
    all.find((p) => p.name.toLowerCase() === lower) ||
    all.find((p) => p.slug === slugify(r)) ||
    null
  );
}

async function ownedProject(userId, projectId) {
  if (!isUuid(projectId)) throw new ProjectError('Not found.', 404);
  const { data, error } = await db.from('projects').select(PROJECT_COLS).eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (error) throw fail(error);
  if (!data) throw new ProjectError('Not found.', 404);
  return data;
}

async function ownedFolder(userId, projectId, folderId) {
  if (!isUuid(folderId)) throw new ProjectError('Folder not found.', 404);
  const { data, error } = await db
    .from('project_folders').select(FOLDER_COLS)
    .eq('id', folderId).eq('project_id', projectId).eq('user_id', userId).maybeSingle();
  if (error) throw fail(error);
  if (!data) throw new ProjectError('Folder not found.', 404);
  return data;
}

/**
 * One project with its folders and the entries filed in them.
 *
 * `columns` picks the link columns to read (the MCP server asks for more than
 * the website shows). Entries are passed through the viewer's access policy:
 * one this member can no longer open comes back as `locked`, never as the
 * record, and one removed from the catalogue simply drops out.
 */
export async function loadProject(userId, project, policy, { columns } = {}) {
  const [{ data: folders, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    db.from('project_folders').select(FOLDER_COLS).eq('project_id', project.id).eq('user_id', userId).order('position').order('created_at'),
    db.from('project_items').select(ITEM_COLS).eq('project_id', project.id).eq('user_id', userId).order('position').order('created_at'),
  ]);
  if (e1 || e2) throw fail(e1 || e2);

  const ids = [...new Set((items || []).map((i) => i.link_id))];
  let rows = [];
  if (ids.length) {
    const cols = columns || [...new Set([...PUBLIC_FIELDS, 'access'])].join(',');
    const { data, error } = await db.from('links').select(cols).in('id', ids);
    if (error) throw fail(error);
    rows = data || [];
  }
  const byId = new Map(rows.map((r) => [r.id, r]));

  const out = (folders || []).map((f) => ({
    ...shapeFolder(f),
    items: (items || [])
      .filter((i) => i.folder_id === f.id && byId.has(i.link_id))
      .map((i) => {
        const row = byId.get(i.link_id);
        const open = canOpen(row, policy);
        return {
          link_id: i.link_id,
          note: i.note || '',
          position: i.position,
          added_at: i.created_at,
          locked: !open,
          // The raw row only for a caller that chose its own columns (the MCP server renders it itself).
          ...(columns ? { row: open ? row : null } : {}),
          link: open ? publicLink(row, policy) : { id: row.id, type: row.type, locked: true },
        };
      }),
  }));

  return { project, folders: out, skills: out.reduce((n, f) => n + f.items.length, 0) };
}

/* ----------------------------------------------------------------- writing */

export async function createProject(userId, input = {}) {
  const name = clean(input.name, 60);
  if (!name) throw new ProjectError('Give the project a name.');
  const description = clean(input.description, 400) || null;
  const template = templateOf(input.template);

  const { data: mine, error: e0 } = await db.from('projects').select('name,slug').eq('user_id', userId);
  if (e0) throw fail(e0);
  if ((mine || []).length >= LIMITS.projects) throw fail({ message: 'stash_limit_projects' });
  if ((mine || []).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new ProjectError('You already have a project called “' + name + '”.', 409);
  }

  const taken = new Set((mine || []).map((p) => p.slug));
  const base = slugify(name);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = base + '-' + n;

  const { data: project, error } = await db
    .from('projects')
    .insert({ user_id: userId, name, slug, description, template: template.key })
    .select(PROJECT_COLS)
    .single();
  if (error) throw fail(error, 'A project with that name');

  if (template.folders.length) {
    const rows = template.folders.map((kind, position) => ({
      project_id: project.id, user_id: userId, name: presetOf(kind).name, kind, position,
    }));
    const { error: e2 } = await db.from('project_folders').insert(rows);
    if (e2) {
      // No half-made project: without its folders, take it back out.
      await db.from('projects').delete().eq('id', project.id).eq('user_id', userId);
      throw fail(e2);
    }
  }
  return project;
}

export async function updateProject(userId, projectId, input = {}) {
  await ownedProject(userId, projectId);
  const patch = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    const name = clean(input.name, 60);
    if (!name) throw new ProjectError('A project needs a name.');
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = clean(input.description, 400) || null;
  // The slug stays as it was made, so an agent configured with it keeps finding the project after a rename.
  const { data, error } = await db.from('projects').update(patch).eq('id', projectId).eq('user_id', userId).select(PROJECT_COLS).single();
  if (error) throw fail(error, 'A project with that name');
  return data;
}

export async function deleteProject(userId, projectId) {
  await ownedProject(userId, projectId);
  const { error } = await db.from('projects').delete().eq('id', projectId).eq('user_id', userId);
  if (error) throw fail(error);
}

export async function addFolder(userId, projectId, input = {}) {
  await ownedProject(userId, projectId);
  const kind = isKind(input.kind) ? input.kind : 'custom';
  const name = clean(input.name, 40) || (kind !== 'custom' ? presetOf(kind).name : '');
  if (!name) throw new ProjectError('Give the folder a name.');

  const { data: existing, error: e0 } = await db.from('project_folders').select('name,position').eq('project_id', projectId).eq('user_id', userId);
  if (e0) throw fail(e0);
  if ((existing || []).length >= LIMITS.folders) throw fail({ message: 'stash_limit_folders' });
  if ((existing || []).some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    throw new ProjectError('This project already has a folder called “' + name + '”.', 409);
  }
  const position = Math.max(-1, ...(existing || []).map((f) => f.position)) + 1;

  const { data, error } = await db
    .from('project_folders')
    .insert({ project_id: projectId, user_id: userId, name, kind, position })
    .select(FOLDER_COLS)
    .single();
  if (error) throw fail(error, 'A folder with that name');
  await touch(userId, projectId);
  return { ...shapeFolder(data), items: [] };
}

export async function renameFolder(userId, projectId, folderId, name) {
  await ownedFolder(userId, projectId, folderId);
  const n = clean(name, 40);
  if (!n) throw new ProjectError('A folder needs a name.');
  const { data, error } = await db
    .from('project_folders').update({ name: n })
    .eq('id', folderId).eq('project_id', projectId).eq('user_id', userId)
    .select(FOLDER_COLS).single();
  if (error) throw fail(error, 'A folder with that name');
  await touch(userId, projectId);
  return shapeFolder(data);
}

/** Puts the folders in the order given. Every id must be one of this project's folders, each once. */
export async function reorderFolders(userId, projectId, order) {
  await ownedProject(userId, projectId);
  if (!Array.isArray(order) || order.length > LIMITS.folders || !order.every(isUuid)) throw new ProjectError('order must list the folder ids.');
  const { data, error } = await db.from('project_folders').select('id').eq('project_id', projectId).eq('user_id', userId);
  if (error) throw fail(error);
  const ids = new Set((data || []).map((f) => f.id));
  const given = new Set(order);
  if (given.size !== order.length || given.size !== ids.size || ![...given].every((id) => ids.has(id))) {
    throw new ProjectError('order must list every folder of this project once.');
  }
  const results = await Promise.all(
    order.map((id, position) => db.from('project_folders').update({ position }).eq('id', id).eq('project_id', projectId).eq('user_id', userId))
  );
  const bad = results.find((r) => r.error);
  if (bad) throw fail(bad.error);
  await touch(userId, projectId);
}

export async function deleteFolder(userId, projectId, folderId) {
  await ownedFolder(userId, projectId, folderId);
  const { error } = await db.from('project_folders').delete().eq('id', folderId).eq('project_id', projectId).eq('user_id', userId);
  if (error) throw fail(error);
  await touch(userId, projectId);
}

async function nextItemPosition(userId, folderId) {
  const { data } = await db
    .from('project_items').select('position').eq('folder_id', folderId).eq('user_id', userId)
    .order('position', { ascending: false }).limit(1);
  return data?.length ? data[0].position + 1 : 0;
}

/**
 * Files a catalogue entry in a folder. Only entries this member can open:
 * filing would otherwise confirm a locked entry exists and hand its details
 * back through the project. Filing the same entry twice is harmless.
 */
export async function addItem(userId, projectId, input, policy) {
  await ownedProject(userId, projectId);
  const folder = await ownedFolder(userId, projectId, input?.folder_id);
  const linkId = Number(input?.link_id);
  if (!Number.isSafeInteger(linkId) || linkId <= 0) throw new ProjectError('link_id must be an entry id.');

  const { data: row, error: e1 } = await db.from('links').select('id,category,access,dead').eq('id', linkId).maybeSingle();
  if (e1) throw fail(e1);
  if (!row) throw new ProjectError('No entry with id ' + linkId + '.', 404);
  if (!canOpen(row, policy)) throw new ProjectError('That entry is not open to your plan.', 403);

  const { data: had } = await db
    .from('project_items').select('link_id').eq('folder_id', folder.id).eq('link_id', linkId).eq('user_id', userId).maybeSingle();
  if (had) return { already: true, folder_id: folder.id, link_id: linkId };

  const note = clean(input?.note, 280) || null;
  const position = await nextItemPosition(userId, folder.id);
  const { error } = await db.from('project_items').insert({
    folder_id: folder.id, project_id: projectId, user_id: userId, link_id: linkId, note, position,
  });
  if (error) {
    if (error.code === '23505') return { already: true, folder_id: folder.id, link_id: linkId };
    throw fail(error);
  }
  await touch(userId, projectId);
  return { added: true, folder_id: folder.id, link_id: linkId, note: note || '' };
}

/** Moves an item to another folder of the same project, and/or rewrites its note. */
export async function updateItem(userId, projectId, input) {
  await ownedProject(userId, projectId);
  const from = await ownedFolder(userId, projectId, input?.folder_id);
  const linkId = Number(input?.link_id);
  if (!Number.isSafeInteger(linkId)) throw new ProjectError('link_id must be an entry id.');

  const { data: item } = await db
    .from('project_items').select(ITEM_COLS).eq('folder_id', from.id).eq('link_id', linkId).eq('user_id', userId).maybeSingle();
  if (!item) throw new ProjectError('That skill is not in this folder.', 404);

  const patch = {};
  if (input.note !== undefined) patch.note = clean(input.note, 280) || null;
  let to = from;
  if (input.to_folder_id && input.to_folder_id !== from.id) {
    to = await ownedFolder(userId, projectId, input.to_folder_id);
    const { data: clash } = await db
      .from('project_items').select('link_id').eq('folder_id', to.id).eq('link_id', linkId).eq('user_id', userId).maybeSingle();
    if (clash) throw new ProjectError('“' + to.name + '” already has this skill.', 409);
    patch.folder_id = to.id;
    patch.position = await nextItemPosition(userId, to.id);
  }
  if (!Object.keys(patch).length) return { folder_id: from.id, link_id: linkId, note: item.note || '' };

  const { data, error } = await db
    .from('project_items').update(patch)
    .eq('folder_id', from.id).eq('link_id', linkId).eq('project_id', projectId).eq('user_id', userId)
    .select(ITEM_COLS).single();
  if (error) throw fail(error);
  await touch(userId, projectId);
  return { folder_id: data.folder_id, link_id: data.link_id, note: data.note || '', position: data.position };
}

export async function removeItem(userId, projectId, folderId, linkId) {
  await ownedFolder(userId, projectId, folderId);
  const id = Number(linkId);
  if (!Number.isSafeInteger(id)) throw new ProjectError('link_id must be an entry id.');
  const { error } = await db
    .from('project_items').delete()
    .eq('folder_id', folderId).eq('link_id', id).eq('project_id', projectId).eq('user_id', userId);
  if (error) throw fail(error);
  await touch(userId, projectId);
}
