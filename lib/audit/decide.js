import { chatJSON } from '../llm.js';
import { jevDecide } from '../models.js';
import { SECTIONS } from '../taxonomy.js';

// Fast triage: what kind of section is this, and what is wrong with it?
//
// Jev answers typed questions with probabilities in one cheap pass, which is
// exactly this job, so it is used whenever OPENROUTER_API_KEY is set. Without
// it, DeepSeek scores every section in a single call. Either way the output
// has the same shape, so nothing downstream knows or cares which ran.

export const ISSUES = {
  weak_headline: {
    label: 'Weak or missing headline',
    q: 'Is the headline missing, vague, or generic, so a visitor cannot tell in one glance what this section is saying?',
  },
  unclear_action: {
    label: 'No clear next step',
    q: 'Should this section move the visitor to act, but lacks one clear, prominent call to action?',
  },
  text_heavy: {
    label: 'Wall of text',
    q: 'Is this mostly dense text that would read better broken into structure, visuals or fewer words?',
  },
  low_visual_interest: {
    label: 'Visually flat',
    q: 'Does this section lack imagery, illustration, or visual craft that the content clearly calls for?',
  },
  generic_copy: {
    label: 'Generic copy',
    q: 'Does the copy sound like template filler that could belong to any company, rather than specific and concrete?',
  },
  missing_proof: {
    label: 'Missing proof',
    q: 'Would this section be more convincing with proof it does not have, such as numbers, logos, testimonials or examples?',
  },
  static_feel: {
    label: 'Static feel',
    q: 'Would subtle motion or interaction clearly improve this section, and there are no signs of any?',
  },
};

const SECTION_HELP = {
  navbar: 'top navigation bar', hero: 'first big intro block', features: 'list of features or benefits',
  'how-it-works': 'steps or process', 'product-showcase': 'product screenshots, demo or offering detail',
  logos: 'client or partner logo strip', testimonials: 'quotes or reviews', stats: 'numbers and metrics',
  pricing: 'plans and prices', faq: 'questions and answers', cta: 'closing call to action band',
  contact: 'contact details, map or contact form', footer: 'bottom of page links',
  'about-team': 'about the company or team', 'gallery-portfolio': 'gallery, portfolio or case studies',
  'blog-content': 'articles or long-form content', 'forms-signup': 'signup, lead or booking form',
  'dashboard-ui': 'app-like interface', background: 'decorative band', 'page-transitions': 'transition element',
  'cursor-interactions': 'interactive element', loaders: 'loading screen', 'whole-page': 'other',
};

function stateFor(section, site) {
  return {
    page: { title: site.title, framework: site.framework },
    section_position: section.position + ' of ' + site.section_count,
    html_tag: section.tag,
    name_used_by_site: section.name_hint,
    headings: section.headings,
    text: section.text_excerpt,
    signals: section.signals,
  };
}

const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

function finish(type, scores) {
  const issues = Object.entries(scores)
    .filter(([, p]) => p >= 0.6)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => ISSUES[k]?.label || k);
  const vals = Object.values(scores);
  // Worst problem dominates, softened by how many others there are.
  const worst = vals.length ? Math.max(...vals) : 0;
  const spread = vals.filter((v) => v >= 0.6).length;
  const needs_work = clamp(worst * 0.75 + Math.min(spread, 4) * 0.0625);
  return { type: SECTIONS.includes(type) ? type : 'whole-page', scores, issues, needs_work };
}

/* ------------------------------------------------------------------- jev */

async function classifyOneJev(section, site) {
  const questions = {
    type: {
      type: 'choice',
      instructions: 'What kind of website section is this?',
      criteria: Object.fromEntries(SECTIONS.map((s) => [s, SECTION_HELP[s] || s])),
    },
  };
  for (const [k, v] of Object.entries(ISSUES)) questions[k] = { type: 'noul', instructions: v.q };

  const a = await jevDecide(stateFor(section, site), questions);
  const scores = {};
  for (const k of Object.keys(ISSUES)) scores[k] = clamp(a[k]?.noul);
  return finish(a.type?.choice, scores);
}

async function classifyJev(sections, site) {
  const out = new Array(sections.length);
  const queue = sections.map((s, i) => [s, i]);
  // A few at a time: fast, without hammering the API.
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (queue.length) {
        const [s, i] = queue.shift();
        out[i] = await classifyOneJev(s, site);
      }
    })
  );
  return out;
}

/* -------------------------------------------------------------- deepseek */

async function classifyDeepSeek(sections, site) {
  const system = [
    'You are a senior web designer triaging a client website, one section at a time.',
    'For each section, decide its type and how likely each problem is (0 to 1).',
    'Judge from the headings, text and signals given. Be fair: a solid section should score low.',
    '',
    'Section types: ' + SECTIONS.join(', '),
    'Problems:',
    ...Object.entries(ISSUES).map(([k, v]) => '- ' + k + ': ' + v.q),
    '',
    'Return strict JSON: { "sections": [ { "position": number, "type": "one section type",',
    '  "scores": { ' + Object.keys(ISSUES).map((k) => '"' + k + '": 0.0').join(', ') + ' } } ] }',
    'Include every section given, in order.',
  ].join('\n');

  const user = JSON.stringify({
    page: { title: site.title, framework: site.framework, url: site.url },
    sections: sections.map((s) => ({ position: s.position, ...stateFor(s, site), text: s.text_excerpt.slice(0, 450) })),
  });

  const ai = await chatJSON(system, user, 40000);
  const byPos = new Map((ai?.sections || []).map((s) => [Number(s.position), s]));

  return sections.map((s) => {
    const r = byPos.get(s.position) || {};
    const scores = {};
    for (const k of Object.keys(ISSUES)) scores[k] = clamp(r.scores?.[k]);
    return finish(String(r.type || '').toLowerCase(), scores);
  });
}

/** Classifies every section. Returns results aligned with the input order, plus the engine used. */
export async function classifySections(sections, site) {
  if (process.env.OPENROUTER_API_KEY) {
    try {
      return { results: await classifyJev(sections, site), engine: 'jev' };
    } catch (e) {
      const results = await classifyDeepSeek(sections, site);
      return { results, engine: 'deepseek (jev failed: ' + String(e.message).slice(0, 80) + ')' };
    }
  }
  return { results: await classifyDeepSeek(sections, site), engine: 'deepseek' };
}
