import { db } from '../supabase.js';
import { embed } from '../embed.js';
import { designJSON } from '../models.js';
import { SECTIONS } from '../taxonomy.js';

// For one section that needs work: find the saved tools that fit it, then ask
// the design model for concrete redesign directions built on those tools.

const CANDIDATE_FIELDS = (l) => ({
  id: l.id,
  name: l.title,
  url: l.url,
  type: l.type,
  format: l.usage_format,
  what: l.summary,
  sections: l.sections,
  effects: l.effect_kind,
  styles: l.style_tags,
  works_with: l.works_with,
});

async function search(q, q_embedding, section) {
  const { data } = await db.rpc('search_links', {
    q, q_embedding,
    f_category: null, f_pricing: null, f_source: null, f_kind: null,
    f_status: null, f_tags: null, f_oss: false, f_starred: false,
    f_collection: null, f_dead: false, f_works_with: null,
    f_type: null, f_language: null, f_min_stars: null,
    f_maintained: false, f_used_only: false,
    f_section: section, f_style: null, f_effect: null,
    sort_by: 'newest', max_rows: 10, skip_rows: 0,
  });
  return (data || []).filter((l) => l.usage_format !== 'not-web-design');
}

/** Library tools that fit this section, best first. Returns full link rows. */
export async function matchTools(section, site) {
  const q = [section.type, 'section', ...(section.issues || []), site.framework].filter(Boolean).join(' ');
  const q_embedding = await embed(q);

  const tagged = SECTIONS.includes(section.type) ? await search(q, q_embedding, section.type) : [];
  let rows = tagged;
  if (rows.length < 4) {
    const extra = await search(q, q_embedding, null);
    const seen = new Set(rows.map((r) => r.id));
    rows = rows.concat(extra.filter((r) => !seen.has(r.id)));
  }
  return rows.slice(0, 8);
}

const SYSTEM = [
  'You are a senior web designer improving a client website one section at a time.',
  'You are given one section of the live site (its headings, text and structural signals),',
  'the problems a triage pass found, the site\'s style, and tools from the designer\'s own library.',
  '',
  'Return strict JSON:',
  '{',
  '  "diagnosis": "1-2 plain sentences: what is actually wrong, specific to THIS section\'s content",',
  '  "keep": "one sentence on what already works and should survive the redesign, or null",',
  '  "directions": [',
  '    {',
  '      "title": "short name for the direction, e.g. Proof-first hero",',
  '      "idea": "2-3 sentences: what the redesigned section looks and reads like",',
  '      "tool_ids": [ids of the library tools this direction uses — ONLY ids from the list given],',
  '      "effort": "quick | half-day | bigger",',
  '      "prompt": "a ready-to-paste instruction for an AI coding agent (Claude Code, Cursor) to build this',
  '                 direction in the site, naming the tools and their URLs, and keeping the site\'s fonts and colours"',
  '    }',
  '  ],',
  '  "copy": { "headline": "a sharper headline using the section\'s real subject, or null", "cta": "button text or null" }',
  '}',
  '',
  'Rules:',
  '- 2 or 3 directions that are genuinely different (e.g. a layout change vs a motion upgrade vs a content rework).',
  '- Ground every direction in the section\'s real content. Never invent facts, prices, numbers or client names;',
  '  where proof is missing, say what kind of proof to add, not made-up figures.',
  '- Use library tools wherever they fit, but do not force one in. A direction may use none.',
  '- Reference tools are galleries to study; libraries and components are things to install. Say which.',
  '- Plain words. No marketing fluff.',
].join('\n');

/** Writes directions for one section. Returns { suggestion, engine }. */
export async function designSection(section, site, candidates, deadline) {
  const user = JSON.stringify({
    site: {
      title: site.title, url: site.url, framework: site.framework,
      fonts: site.fonts, colours: site.colours,
    },
    section: {
      position: section.position, type: section.type,
      headings: section.headings, text: section.text_excerpt,
      signals: section.signals,
      problems_found: section.issues,
      problem_scores: section.scores,
    },
    library_tools: candidates.map(CANDIDATE_FIELDS),
  });

  const { result, engine } = await designJSON(SYSTEM, user, { maxTokens: 2500, deadline });

  const allowed = new Set(candidates.map((c) => c.id));
  const directions = (Array.isArray(result?.directions) ? result.directions : []).slice(0, 3).map((d) => ({
    title: String(d.title || 'Direction').slice(0, 80),
    idea: String(d.idea || '').slice(0, 700),
    tool_ids: (Array.isArray(d.tool_ids) ? d.tool_ids : []).map(Number).filter((id) => allowed.has(id)),
    effort: ['quick', 'half-day', 'bigger'].includes(d.effort) ? d.effort : 'half-day',
    prompt: String(d.prompt || '').slice(0, 2500),
  }));

  return {
    engine,
    suggestion: {
      diagnosis: String(result?.diagnosis || '').slice(0, 500),
      keep: result?.keep ? String(result.keep).slice(0, 300) : null,
      directions,
      copy: {
        headline: result?.copy?.headline ? String(result.copy.headline).slice(0, 160) : null,
        cta: result?.copy?.cta ? String(result.copy.cta).slice(0, 60) : null,
      },
      engine,
    },
  };
}
