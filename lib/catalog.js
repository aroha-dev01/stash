import { TOOLKITS, toolkitFor } from './taxonomy.js';
import { tierOf, canOpen, needs } from './access.js';

// What each viewer may see of a link (lib/access.js decides who may open it):
//
//   can open it        the public card and detail
//   cannot open it     a locked teaser: kind, toolkit and what it takes to
//                      open. Never the name, summary, address or install
//                      steps, so the teaser cannot stand in for the entry.
//
// Lists never include entries the viewer cannot open; only a direct lookup by
// id returns a teaser, so a shared link still explains itself.
//
// Fields are whitelisted rather than blacklisted. A link row also carries the
// owner's private working notes (note, why, used_in, collections, which name
// real clients), and a new column must never leak just because nobody
// remembered to hide it.

const PUBLIC_FIELDS = [
  'id', 'title', 'url', 'domain', 'summary', 'description', 'image', 'favicon', 'site_name',
  'category', 'type', 'role', 'pricing', 'is_open_source', 'use_cases', 'tags',
  'works_with', 'requires', 'install', 'quickstart', 'limits', 'avoid_when', 'maturity',
  'integration_effort', 'commercial_ok', 'usage_format',
  'repo_owner', 'repo_name', 'repo_stars', 'repo_language', 'repo_license', 'repo_pushed_at',
  'dead', 'featured', 'created_at',
];

export function publicLink(row, policy) {
  const out = {};
  for (const k of PUBLIC_FIELDS) if (row[k] !== undefined) out[k] = row[k];
  out.toolkit = toolkitFor(row.category);
  out.access = tierOf(row, policy);
  return out;
}

export function lockedLink(row, policy) {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    toolkit: toolkitFor(row.category),
    access: tierOf(row, policy),
    locked: true,
    needs: needs(row, policy),
  };
}

/** The view of one row for this viewer's policy. */
export function viewOf(row, policy) {
  return canOpen(row, policy) ? publicLink(row, policy) : lockedLink(row, policy);
}

export { TYPE_LABELS, slugOf } from './labels.js';
export { TOOLKITS };
