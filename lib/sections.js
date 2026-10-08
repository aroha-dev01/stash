import { db } from './supabase.js';
import { chatJSON, llmStatus } from './llm.js';
import { SECTIONS, EFFECTS, STYLES, USAGE_FORMATS } from './taxonomy.js';

// Tags one saved link with the website sections it helps build, the kind of
// effect it gives, the visual styles it fits, and how you'd actually use it.
//
// Works from what is already stored (summary, use cases, tags, type) rather
// than re-scraping the page. That makes it fast enough to backfill the whole
// library in a few minutes, and it cannot overwrite a good summary with a
// worse one if a site happens to be down today.

export const SECTIONS_VERSION = 1;

const SYSTEM = [
  'You classify saved tools and references for a web designer who builds client websites.',
  'Given one saved link, decide how it helps build or improve specific parts of a website.',
  '',
  'Return strict JSON:',
  '{',
  '  "sections": ["website sections this genuinely helps with, from the SECTIONS list"],',
  '  "effect_kind": ["kinds of visual effect or design craft it provides, from EFFECTS"],',
  '  "style_tags": ["visual styles it suits, from STYLES"],',
  '  "usage_format": "one value from FORMATS"',
  '}',
  '',
  'SECTIONS: ' + SECTIONS.join(', '),
  'EFFECTS: ' + EFFECTS.join(', '),
  'STYLES: ' + STYLES.join(', '),
  'FORMATS: ' + USAGE_FORMATS.join(', '),
  '',
  'Rules:',
  '- Be specific. A hero-section gallery is ["hero"], not every section. Only use "whole-page"',
  '  for tools that genuinely shape an entire page (full templates, page-level scroll systems).',
  '- A general component library may list several sections, but only ones it clearly covers.',
  '- If the tool has nothing to do with building a website (an AI agent framework, a video',
  '  editor, a CLI utility), return empty arrays and usage_format "not-web-design".',
  '- style_tags may be empty when the tool is style-neutral (e.g. an analytics library).',
  '- Use ONLY values from the lists. Do not invent new ones.',
].join('\n');

function describe(l) {
  const cases = l.use_cases || [];
  return [
    'Name: ' + (l.title || l.domain),
    'URL: ' + l.url,
    l.type && 'Type: ' + l.type,
    l.category && 'Category: ' + l.category,
    l.role && 'Role: ' + l.role,
    l.summary && 'Summary: ' + l.summary,
    cases.length && 'Use cases: ' + cases.join(' | '),
    l.tags?.length && 'Tags: ' + l.tags.join(', '),
    l.works_with?.length && 'Works with: ' + l.works_with.join(', '),
    l.description && 'Description: ' + String(l.description).slice(0, 400),
  ].filter(Boolean).join('\n');
}

const only = (v, allowed, max) =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter((x) => allowed.includes(x)))].slice(0, max)
    : [];

/** Classifies a link row and writes the result. Returns the patch, or throws. */
export async function tagSections(link) {
  const status = llmStatus();
  if (!status.enabled) throw new Error(status.reason);

  const ai = await chatJSON(SYSTEM, describe(link), 20000);

  const fmt = String(ai?.usage_format || '').trim().toLowerCase();
  const patch = {
    sections: only(ai?.sections, SECTIONS, 8),
    effect_kind: only(ai?.effect_kind, EFFECTS, 6),
    style_tags: only(ai?.style_tags, STYLES, 4),
    usage_format: USAGE_FORMATS.includes(fmt) ? fmt : null,
    sections_v: SECTIONS_VERSION,
  };

  await db.from('links').update(patch).eq('id', link.id);
  return patch;
}
