import { chatJSON } from '../llm.js';
import { jevDecide, jevEnabled } from '../models.js';
import { SECTIONS } from '../taxonomy.js';

// Fast triage: what kind of section is this, what is wrong with it, and how
// much would a redesign actually help?
//
// Designed with the TypeSafe guidance (docs.typesafe.ai/primitives):
//   - section type     -> one Choice, with an explicit "other" outcome
//   - each problem     -> its own Noul ("does this condition hold?"), with
//                         true/false criteria so the boundary is unambiguous
//   - redesign upside  -> a Score, because it is a degree, and a Noul near 0.5
//                         means "unsure", not "medium"
// All questions go in ONE request over the same state, so they run in parallel.
// Code — not the model — combines the raw judgments into needs_work, so the
// weights stay visible and can change without re-running inference.
//
// Without a Jev key, DeepSeek answers the same questions in one call and the
// output has the identical shape.

export const ISSUES = {
  weak_headline: {
    label: 'Weak or missing headline',
    q: 'Is the section\'s headline missing, vague, or generic?',
    true: 'No headline, or one a visitor could not use to tell what this section offers (e.g. "Welcome", "Our services", a slogan with no subject).',
    false: 'A clear headline that names the specific subject or benefit of this section.',
  },
  unclear_action: {
    label: 'No clear next step',
    q: 'Does this section need to move the visitor to act, yet lack one clear, prominent call to action?',
    true: 'A section whose job is conversion (hero, pricing, closing CTA, signup) with no button, or several competing ones of equal weight.',
    false: 'Has one obvious next step, or is a section that does not need one (FAQ, footer, logo strip).',
  },
  text_heavy: {
    label: 'Wall of text',
    q: 'Is this section mostly dense paragraphs that a visitor would skim past?',
    true: 'Long unbroken paragraphs, little structure, few or no visuals relative to the amount of text.',
    false: 'Text is short, or broken into scannable parts (lists, cards, columns, headings).',
  },
  low_visual_interest: {
    label: 'Visually flat',
    q: 'Does this section lack imagery, illustration, or visual craft that its content clearly calls for?',
    true: 'Content that begs to be shown (a product, a place, a process, people) presented as plain text only.',
    false: 'Has relevant images, illustration, video or deliberate visual treatment — or the content genuinely needs none.',
  },
  generic_copy: {
    label: 'Generic copy',
    q: 'Does the copy read like template filler that could belong to any company?',
    true: 'Stock phrases ("innovative solutions", "we are passionate about") with no concrete specifics.',
    false: 'Specific to this business: real names, places, numbers, products or claims.',
  },
  missing_proof: {
    label: 'Missing proof',
    q: 'Is this section making claims that it does not back up with any evidence?',
    true: 'Asserts quality, results or trust without numbers, logos, testimonials, credentials or examples.',
    false: 'Claims are supported with evidence, or the section makes no claims that need backing.',
  },
  static_feel: {
    label: 'Static feel',
    q: 'Would subtle motion or interaction clearly improve this section, and there are no signs of any?',
    true: 'A showcase, hero or process that would read better with reveal, hover or scroll motion, and `signals.animation_hints` is 0.',
    false: 'Already uses motion, or is a section where motion would add nothing.',
  },
};

// Redesign upside, as concrete situations (Score levels must stand on their own).
const UPSIDE_LEVELS = [
  'Already strong and specific; a redesign would only change taste, not results.',
  'Works, but one or two targeted changes (headline, layout, a visual) would clearly lift it.',
  'Noticeably weak: a visitor would likely skim past or misunderstand it; a rework would clearly help.',
  'Broken or near-empty: it fails at its job and needs to be rebuilt.',
];

const SECTION_HELP = {
  navbar: 'top navigation bar', hero: 'first big intro block', features: 'list of features or benefits',
  'how-it-works': 'steps or process', 'product-showcase': 'product screenshots, demo or offering detail',
  logos: 'client or partner logo strip', testimonials: 'quotes or reviews', stats: 'numbers and metrics',
  pricing: 'plans and prices', faq: 'questions and answers', cta: 'closing call to action band',
  contact: 'contact details, map or contact form', footer: 'bottom of page links',
  'about-team': 'about the company or team', 'gallery-portfolio': 'gallery, portfolio or case studies',
  'blog-content': 'articles or long-form content', 'forms-signup': 'signup, lead or booking form',
  'dashboard-ui': 'app-like interface', background: 'decorative band with little content',
  'page-transitions': 'transition element', 'cursor-interactions': 'interactive toy element',
  loaders: 'loading screen', 'whole-page': 'none of the above',
};

function stateFor(section, site) {
  return {
    page: { title: site.title, framework: site.framework, sections_on_page: site.section_count },
    section: {
      position: section.position + 1,
      html_tag: section.tag,
      name_used_by_site: section.name_hint,
      headings: section.headings,
      text: section.text_excerpt,
    },
    signals: section.signals,
  };
}

const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/**
 * Policy, kept in code: the redesign-upside Score carries most of the weight,
 * the single worst problem the rest. Change the weights here, not in prompts.
 */
function combine(type, scores, upside) {
  const issues = Object.entries(scores)
    .filter(([, p]) => p >= 0.6)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => ISSUES[k]?.label || k);
  const worst = Math.max(0, ...Object.values(scores));
  const needs_work = upside == null ? clamp(worst * 0.8) : clamp(0.65 * upside + 0.35 * worst);
  return {
    type: SECTIONS.includes(type) ? type : 'whole-page',
    scores: { ...scores, ...(upside == null ? {} : { redesign_upside: Number(upside.toFixed(3)) }) },
    issues,
    needs_work,
  };
}

/* ------------------------------------------------------------------- jev */

function jevQuestions() {
  const q = {
    type: {
      type: 'choice',
      instructions: 'Which kind of website section is `section`, judging by its headings, text and `signals`?',
      criteria: Object.fromEntries(SECTIONS.map((s) => [s, SECTION_HELP[s] || s])),
    },
    upside: {
      type: 'score',
      instructions: 'How much would a thoughtful redesign improve `section` at doing its job for a visitor?',
      criteria: UPSIDE_LEVELS,
    },
  };
  for (const [k, v] of Object.entries(ISSUES)) {
    q[k] = { type: 'noul', instructions: v.q + ' Judge `section` using `signals` as evidence.', criteria: { true: v.true, false: v.false } };
  }
  return q;
}

async function classifyOneJev(section, site) {
  const a = await jevDecide(stateFor(section, site), jevQuestions());
  const scores = {};
  for (const k of Object.keys(ISSUES)) scores[k] = clamp(a[k]?.noul);
  // Normalise the Score to 0..1 by its top level, per the composite-scoring pattern.
  const upside = a.upside?.score != null ? clamp(a.upside.score / (UPSIDE_LEVELS.length - 1)) : null;
  return combine(a.type?.choice, scores, upside);
}

async function classifyJev(sections, site) {
  const out = new Array(sections.length);
  const queue = sections.map((s, i) => [s, i]);
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
    'For each section answer the same questions. Judge from headings, text and signals. Be fair: strong sections score low.',
    '',
    'type: one of ' + SECTIONS.join(', '),
    'upside: an integer 0-3 —',
    ...UPSIDE_LEVELS.map((l, i) => '  ' + i + ' = ' + l),
    'problems: probability 0-1 that each condition holds —',
    ...Object.entries(ISSUES).map(([k, v]) => '- ' + k + ': ' + v.q + ' YES = ' + v.true + ' NO = ' + v.false),
    '',
    'Return strict JSON: { "sections": [ { "position": number, "type": "...", "upside": 0, "scores": { ' +
      Object.keys(ISSUES).map((k) => '"' + k + '": 0.0').join(', ') + ' } } ] }',
    'Include every section given, in order.',
  ].join('\n');

  const user = JSON.stringify({
    page: { title: site.title, framework: site.framework, url: site.url },
    sections: sections.map((s) => ({ position: s.position, ...stateFor(s, site).section, signals: s.signals, text: s.text_excerpt.slice(0, 450) })),
  });

  const ai = await chatJSON(system, user, 40000);
  const byPos = new Map((ai?.sections || []).map((s) => [Number(s.position), s]));

  return sections.map((s) => {
    const r = byPos.get(s.position) ?? byPos.get(s.position + 1) ?? {};
    const scores = {};
    for (const k of Object.keys(ISSUES)) scores[k] = clamp(r.scores?.[k]);
    const upside = r.upside != null && Number.isFinite(Number(r.upside)) ? clamp(Number(r.upside) / 3) : null;
    return combine(String(r.type || '').toLowerCase(), scores, upside);
  });
}

/** Classifies every section. Returns results aligned with the input order, plus the engine used. */
export async function classifySections(sections, site) {
  if (jevEnabled()) {
    try {
      return { results: await classifyJev(sections, site), engine: 'jev' };
    } catch (e) {
      const results = await classifyDeepSeek(sections, site);
      return { results, engine: 'deepseek (jev failed: ' + String(e.message).slice(0, 80) + ')' };
    }
  }
  return { results: await classifyDeepSeek(sections, site), engine: 'deepseek' };
}
