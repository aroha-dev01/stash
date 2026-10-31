// Display helpers safe to import from client components (no database here).

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

/** For URLs: /explore/187-motion. Only the leading id is ever read back. */
export const slugOf = (row) =>
  row.id + '-' + String(row.title || row.domain || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
