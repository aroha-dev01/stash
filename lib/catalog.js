import { TOOLKITS, toolkitFor } from './taxonomy.js';

// What each kind of visitor may see of a link.
//
//   signed out, free item     the public card and detail
//   signed out, premium item  a locked teaser: name, kind and toolkit only
//   signed in                 the public card and detail for everything
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
  'dead', 'is_premium', 'created_at',
];

export function publicLink(row) {
  const out = {};
  for (const k of PUBLIC_FIELDS) if (row[k] !== undefined) out[k] = row[k];
  out.toolkit = toolkitFor(row.category);
  return out;
}

export function lockedLink(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    type: row.type,
    toolkit: toolkitFor(row.category),
    is_premium: true,
    locked: true,
  };
}

/** The view of one row for this viewer (null when signed out). */
export function viewOf(row, viewer) {
  if (!viewer && row.is_premium) return lockedLink(row);
  return publicLink(row);
}

export const TYPE_LABELS = {
  'mcp-server': 'MCP server',
  library: 'Library',
  saas: 'SaaS',
  app: 'App',
  template: 'Template',
  cli: 'CLI',
  reference: 'Reference',
  article: 'Article',
  dataset: 'Dataset',
  other: 'Other',
};

export { TOOLKITS };
