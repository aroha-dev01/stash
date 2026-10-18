import { lean } from '../util.js';
import { chatJSON } from '../llm.js';
import { jevDecide, jevEnabled } from '../models.js';
import { SECTIONS } from '../taxonomy.js';
import { visualFor } from './see.js';

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
  // Rewritten after audit #9 on lare-ai.in: "several competing CTAs" made a
  // hero with "Enquire on WhatsApp" + "Call us" read as unclear, and a
  // 6-item <details> FAQ read as a wall of text. The criteria now point at
  // the concrete evidence in `signals` and the page's own contact goal.
  unclear_action: {
    label: 'No clear next step',
    q: 'Should `section` move the visitor toward `page.contact_goal`, yet offer no clear way to do it? Look at `signals.calls_to_action`.',
    true: 'A section whose job is to convert (hero, pricing, closing call to action, signup) with no visible button or contact link, or only a vague text link buried in a paragraph.',
    false: 'Has at least one clear button or contact link (two complementary options such as WhatsApp and phone are clear, not competing), or is a section that does not need one (FAQ, gallery, footer, logo strip).',
  },
  text_heavy: {
    label: 'Wall of text',
    q: 'Is `section` mostly dense, unbroken paragraphs a visitor would skim past?',
    true: 'Long continuous paragraphs shown all at once, with little structure and few visuals for the amount of text.',
    false: 'Text is short, broken into scannable parts (lists, cards, columns, headings), or already collapsed into expandable items (`signals.expandable_items` > 0).',
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
    q: 'Does `section` make important claims that are backed up neither in the section itself nor anywhere nearby on the page (see `page.proof`)?',
    true: 'Asserts results, quality or trust ("the best", "trusted by", "25 years") with no numbers, testimonials, logos, credentials or examples here, and `page.proof` shows little or none elsewhere.',
    false: 'The claims are backed in this section, the page shows proof elsewhere that covers them (`page.proof.sections_with_proof`), or the section makes no claims that need backing.',
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

// Page-level judgement, asked ONCE before the sections (TypeSafe: a second
// request is warranted when an earlier answer builds the next state). Every
// section question then knows what business this is and how it wants to be
// contacted, so "no clear next step" means "no clear way to WhatsApp us" for
// a real-estate consultancy, not a generic rule.
export const BUSINESS_TYPES = {
  'real-estate': 'property sales, rentals, land or real-estate consulting',
  'hospitality-travel': 'hotels, homestays, resorts, tours, travel',
  'food-restaurant': 'restaurants, cafes, food brands, catering',
  healthcare: 'clinics, doctors, wellness, pharmacy',
  'professional-services': 'law, accounting, consulting, finance, insurance',
  'agency-studio': 'design, marketing, development or creative agency',
  'saas-software': 'software product, app or online tool',
  'ecommerce-retail': 'online shop or retail products',
  education: 'school, courses, coaching, training',
  'manufacturing-b2b': 'industrial, agriculture, manufacturing or B2B supply',
  'nonprofit-community': 'charity, NGO, community or religious organisation',
  'portfolio-personal': 'personal site, portfolio or creator',
  other: 'none of the above',
};
export const CONTACT_GOALS = {
  'whatsapp-chat': 'message on WhatsApp or chat',
  'phone-call': 'phone call',
  'enquiry-form': 'fill in an enquiry or contact form',
  'booking': 'book an appointment, table, room or demo',
  'purchase': 'buy online',
  'signup': 'sign up or start a free trial',
  'visit': 'visit a physical location',
  'unclear': 'the page does not make any next step clear',
};
const OFFER_LEVELS = [
  'After five seconds on the opening screen a visitor could not say what is offered or to whom.',
  'The general field is clear, but what exactly is offered, or for whom, is vague.',
  'What is offered is clear; who it is for or where it applies takes some reading.',
  'Within five seconds it is obvious what is offered, for whom and why to choose them.',
];

function pageState(sections, site) {
  return {
    page: {
      title: site.title,
      description: site.description || site.meta_description,
      headings: sections.flatMap((s) => (s.headings || []).slice(0, 2)).slice(0, 24),
      opening_screen: (sections.find((s) => (s.headings || []).length) || sections[0] || {}).text_excerpt?.slice(0, 500),
      evidence: site.evidence || {},
    },
  };
}

async function judgePageJev(sections, site) {
  const a = await jevDecide(pageState(sections, site), {
    business_type: { type: 'choice', instructions: 'What kind of business or organisation is this website for?', criteria: BUSINESS_TYPES },
    contact_goal: { type: 'choice', instructions: 'What is the main thing this website wants an interested visitor to do next? Use `page.evidence.primary_ctas` and `page.evidence.contact_methods`.', criteria: CONTACT_GOALS },
    proof_on_page: {
      type: 'noul',
      instructions: 'Does the page as a whole show credible proof that the business delivers — testimonials, client logos, real figures, case studies, credentials or named examples? See `page.evidence`.',
      criteria: { true: 'At least one kind of concrete proof appears somewhere on the page.', false: 'Only the business\'s own claims, with nothing a visitor could check.' },
    },
    offer_clarity: { type: 'score', instructions: 'How clearly does `page.opening_screen` communicate the offer?', criteria: OFFER_LEVELS },
  }, 15000);
  return {
    business_type: a.business_type?.choice || 'other',
    business_confidence: a.business_type?.confidence ?? null,
    contact_goal: a.contact_goal?.choice || 'unclear',
    proof_on_page: a.proof_on_page?.noul ?? null,
    offer_clarity: a.offer_clarity?.score != null ? Number((a.offer_clarity.score / 3).toFixed(3)) : null,
    offer_confidence: a.offer_clarity?.confidence ?? null,
  };
}

function stateFor(section, site, page) {
  const ev = site.evidence || {};
  return {
    page: {
      title: site.title,
      business_type: page?.business_type,
      contact_goal: page?.contact_goal ? CONTACT_GOALS[page.contact_goal] : undefined,
      proof: {
        shown_somewhere_on_page: page?.proof_on_page != null ? page.proof_on_page >= 0.6 : (ev.testimonials || 0) + (ev.logos || 0) > 0,
        testimonials: ev.testimonials || 0,
        logos: ev.logos || 0,
        figures: ev.stat_figures || [],
        sections_with_proof: (ev.sections_with_proof || []).filter((n) => n !== section.position + 1),
      },
      sections_on_page: site.section_count,
    },
    section: {
      position: section.position + 1,
      html_tag: section.tag,
      name_used_by_site: section.name_hint,
      headings: section.headings,
      text: section.text_excerpt,
    },
    signals: lean(section.signals),
    // What a vision model saw on the rendered page (omitted when it did not run).
    visual: visualFor(site, section.position),
  };
}

const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

// Which problems even apply to which section types. Measured on real audits:
// asked of every section, "weak headline" fired on navbars and footers (which
// have no headline by design) and "missing proof" fired on nearly everything,
// so chrome outranked the hero. The raw judgments are still stored; this only
// decides which ones count. Policy in code, per the TypeSafe guidance.
const CHROME = new Set(['navbar', 'footer', 'background', 'loaders', 'page-transitions', 'cursor-interactions', 'logos']);
const NEEDS_ACTION = new Set(['hero', 'cta', 'pricing', 'forms-signup', 'contact', 'product-showcase']);
const MAKES_CLAIMS = new Set(['hero', 'features', 'product-showcase', 'pricing', 'about-team', 'stats', 'testimonials', 'how-it-works']);

function applies(issue, type) {
  if (CHROME.has(type)) return issue === 'low_visual_interest' || issue === 'static_feel';
  if (issue === 'unclear_action') return NEEDS_ACTION.has(type);
  if (issue === 'missing_proof') return MAKES_CLAIMS.has(type);
  if (issue === 'weak_headline') return type !== 'faq';
  return true;
}

export const DEFAULT_THRESHOLD = 0.6;

/**
 * Policy, kept in code: the redesign-upside Score carries most of the weight
 * (it was the better-calibrated signal on real pages), the worst *applicable*
 * problem the rest. Per-issue thresholds come from your 👍/👎 feedback
 * (see learnedThresholds in run.js); an issue you keep rejecting needs more
 * certainty before it is shown. Change the weights here, not in prompts.
 */
function combine(rawType, scores, upside, { thresholds = {}, upsideConfidence = null } = {}) {
  const type = SECTIONS.includes(rawType) ? rawType : 'whole-page';
  const relevant = Object.entries(scores).filter(([k]) => applies(k, type));
  const shown = relevant.filter(([k, p]) => p >= (thresholds[k] ?? DEFAULT_THRESHOLD));
  const issues = shown.sort((a, b) => b[1] - a[1]).map(([k]) => ISSUES[k]?.label || k);
  const worst = Math.max(0, ...shown.map(([, p]) => p), ...relevant.map(([, p]) => p * 0.6));
  const needs_work = upside == null ? clamp(worst * 0.8) : clamp(0.75 * upside + 0.25 * worst);
  return {
    type,
    scores: {
      ...scores,
      ...(upside == null ? {} : { redesign_upside: Number(upside.toFixed(3)) }),
      ...(upsideConfidence == null ? {} : { upside_confidence: Number(upsideConfidence.toFixed(3)) }),
    },
    issues,
    needs_work,
    // Jev was split between levels: flag it for a human look rather than
    // pretend to certainty (TypeSafe: route uncertain cases to a person).
    uncertain: upsideConfidence != null && upsideConfidence < 0.35,
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
      instructions: 'For a `page.business_type` business, how much would a thoughtful redesign improve `section` at doing its job for a visitor?',
      criteria: UPSIDE_LEVELS,
    },
  };
  for (const [k, v] of Object.entries(ISSUES)) {
    q[k] = { type: 'noul', instructions: v.q + ' Judge `section` using `signals` as evidence.', criteria: { true: v.true, false: v.false } };
  }
  return q;
}

async function classifyOneJev(section, site, page, opts) {
  const a = await jevDecide(stateFor(section, site, page), jevQuestions());
  const scores = {};
  for (const k of Object.keys(ISSUES)) scores[k] = clamp(a[k]?.noul);
  // Normalise the Score to 0..1 by its top level, per the composite-scoring pattern.
  const upside = a.upside?.score != null ? clamp(a.upside.score / (UPSIDE_LEVELS.length - 1)) : null;
  return combine(a.type?.choice, scores, upside, { ...opts, upsideConfidence: a.upside?.confidence ?? null });
}

async function classifyJev(sections, site, page, opts) {
  const out = new Array(sections.length);
  const queue = sections.map((s, i) => [s, i]);
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (queue.length) {
        const [s, i] = queue.shift();
        out[i] = await classifyOneJev(s, site, page, opts);
      }
    })
  );
  return out;
}

/* -------------------------------------------------------------- deepseek */

async function classifyDeepSeek(sections, site, opts) {
  const system = [
    'You are a senior web designer triaging a client website.',
    'First judge the whole page, then each section. Judge from headings, text and signals (including calls_to_action, expandable_items and the page proof). Be fair: strong sections score low.',
    '',
    'page.business_type: one of ' + Object.keys(BUSINESS_TYPES).join(', '),
    'page.contact_goal: one of ' + Object.keys(CONTACT_GOALS).join(', '),
    'page.proof_on_page: probability 0-1 that the page shows concrete proof anywhere',
    'page.offer_clarity: integer 0-3 — ' + OFFER_LEVELS.map((l, i) => i + ' = ' + l).join(' | '),
    '',
    'For each section — type: one of ' + SECTIONS.join(', '),
    'upside: an integer 0-3 —',
    ...UPSIDE_LEVELS.map((l, i) => '  ' + i + ' = ' + l),
    'problems: probability 0-1 that each condition holds —',
    ...Object.entries(ISSUES).map(([k, v]) => '- ' + k + ': ' + v.q + ' YES = ' + v.true + ' NO = ' + v.false),
    '',
    'Return strict JSON: { "page": { "business_type": "...", "contact_goal": "...", "proof_on_page": 0.0, "offer_clarity": 0 },',
    '  "sections": [ { "position": number, "type": "...", "upside": 0, "scores": { ' +
      Object.keys(ISSUES).map((k) => '"' + k + '": 0.0').join(', ') + ' } } ] }',
    'Include every section given, in order.',
  ].join('\n');

  const user = JSON.stringify({
    page: { ...pageState(sections, site).page, url: site.url },
    sections: sections.map((s) => ({ position: s.position, ...stateFor(s, site, null).section, signals: lean(s.signals), text: s.text_excerpt.slice(0, 450) })),
  });

  const ai = await chatJSON(system, user, 40000);
  const pg = ai?.page || {};
  const page = {
    business_type: BUSINESS_TYPES[pg.business_type] ? pg.business_type : 'other',
    contact_goal: CONTACT_GOALS[pg.contact_goal] ? pg.contact_goal : 'unclear',
    proof_on_page: pg.proof_on_page != null ? clamp(pg.proof_on_page) : null,
    offer_clarity: Number.isFinite(Number(pg.offer_clarity)) ? clamp(Number(pg.offer_clarity) / 3) : null,
  };
  const byPos = new Map((ai?.sections || []).map((s) => [Number(s.position), s]));

  const results = sections.map((s) => {
    const r = byPos.get(s.position) ?? byPos.get(s.position + 1) ?? {};
    const scores = {};
    for (const k of Object.keys(ISSUES)) scores[k] = clamp(r.scores?.[k]);
    const upside = r.upside != null && Number.isFinite(Number(r.upside)) ? clamp(Number(r.upside) / 3) : null;
    return combine(String(r.type || '').toLowerCase(), scores, upside, opts);
  });
  return { results, page };
}

/**
 * Judges the page, then every section in the light of it. Returns results
 * aligned with the input order, the page judgement, and the engine used.
 */
export async function classifySections(sections, site, opts = {}) {
  if (jevEnabled()) {
    try {
      const page = opts.page || (await judgePageJev(sections, site));
      return { results: await classifyJev(sections, site, page, opts), page, engine: 'jev' };
    } catch (e) {
      const r = await classifyDeepSeek(sections, site, opts);
      return { ...r, engine: 'deepseek (jev failed: ' + String(e.message).slice(0, 80) + ')' };
    }
  }
  const r = await classifyDeepSeek(sections, site, opts);
  return { ...r, engine: 'deepseek' };
}
