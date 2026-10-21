import { db } from './supabase.js';
import { jevDecide, jevEnabled, jevImagesEnabled, jevAsset } from './models.js';
import { fetchImage } from './vision.js';
import { STYLES } from './taxonomy.js';

// Taste: one Jev pass per saved item, stored as reusable data.
//
// Each question is a narrow judgment a designer makes in a second (see the
// TypeSafe "composite scoring" pattern). Jev answers them all in a single
// parallel request. What the answers MEAN for a given brief is decided later
// in code (lib/design.js), so the weights can change without rescoring the
// library.
//
// Storage: links.taste (jsonb) and links.taste_v (int). See
// supabase/taste.sql. Everything here degrades gracefully when the columns
// are not there yet: scoring still returns a result, it just is not saved.

export const TASTE_VERSION = 1;

export const INDUSTRIES = {
  'real-estate': 'a real estate, property or land business',
  saas: 'a software or SaaS product',
  portfolio: 'a designer, developer, creative studio or agency portfolio',
  hospitality: 'a restaurant, cafe, hotel or travel business',
  ecommerce: 'an online shop or consumer brand',
  health: 'a clinic, wellness, fitness or beauty business',
  education: 'a school, course or education business',
  professional: 'a law, finance, consulting or other professional service',
  local: 'a local trade or small service business',
  creator: 'a personal brand, creator or blog',
  nonprofit: 'a non-profit, community or event site',
};

const PREMIUM = [
  'Generic or dated: default template look, stock layouts, nothing crafted.',
  'Competent but ordinary: clean, yet looks like many other sites.',
  'Polished: consistent, careful spacing and type, professional.',
  'Premium: clearly crafted, confident type and layout, refined detail.',
  'Exceptional: distinctive, award-level craft a client would pay a premium for.',
];
const DISTINCT = [
  'Template-like: the same patterns as thousands of other sites.',
  'Mostly familiar patterns with a few touches.',
  'Some distinctive choices in type, layout or motion.',
  'Strongly distinctive and memorable.',
];
const MOTION = [
  'Static: no animation.',
  'Subtle transitions only.',
  'Noticeable animation that is part of the experience.',
  'Heavy animation: WebGL, scroll-jacking or constant motion.',
];

const ref = (has) => (has ? ' Judge the image in `preview` first, then `item`.' : ' Judge from `item`.');

export function tasteQuestions(hasImage) {
  const q = {
    relevant: {
      type: 'noul',
      instructions: 'This item helps with the visual design or front-end building of websites (components, layouts, styles, inspiration, motion, type, templates).',
    },
    premium: {
      type: 'score',
      instructions: 'How premium and well-crafted is the design quality of what this item produces or showcases?' + ref(hasImage),
      criteria: PREMIUM,
    },
    distinct: {
      type: 'score',
      instructions: 'How distinctive is the look of what this item produces or showcases, compared with typical sites?' + ref(hasImage),
      criteria: DISTINCT,
    },
    motion: {
      type: 'score',
      instructions: 'How much animation or motion does what this item produces or showcases use?' + ref(hasImage),
      criteria: MOTION,
    },
    risk: {
      type: 'noul',
      instructions: 'Using this item is likely to hurt accessibility, performance or readability (heavy motion, low contrast, canvas-only content, large bundles).' + ref(hasImage),
    },
    style: {
      type: 'choice',
      instructions: 'Which visual style does what this item produces or showcases fit best?' + ref(hasImage),
      criteria: { ...Object.fromEntries(STYLES.map((s) => [s, 'The ' + s + ' look.'])), neutral: 'Style-neutral or not visual.' },
    },
  };
  for (const [k, d] of Object.entries(INDUSTRIES)) {
    q['fit_' + k] = { type: 'noul', instructions: 'What this item produces or showcases suits the website of ' + d + '.' + ref(hasImage) };
  }
  return q;
}

function describe(l) {
  const cases = l.use_cases || [];
  return [
    'Name: ' + (l.title || l.domain),
    l.type && 'Type: ' + l.type,
    l.category && 'Category: ' + l.category,
    l.summary && 'Summary: ' + l.summary,
    cases.length && 'Use cases: ' + cases.slice(0, 3).join(' | '),
    l.tags?.length && 'Tags: ' + l.tags.slice(0, 8).join(', '),
    l.style_tags?.length && 'Styles: ' + l.style_tags.join(', '),
    l.effect_kind?.length && 'Effects: ' + l.effect_kind.join(', '),
  ].filter(Boolean).join('\n');
}

const r2 = (n) => Math.round(n * 100) / 100;
const lvl = (a, max) => (a?.score == null ? null : r2(Math.min(Math.max(a.score / max, 0), 1)));

/** Turns Jev's answers into the stored taste record. Pure, so it is easy to test. */
export function readTaste(answers, { image = false } = {}) {
  const A = answers || {};
  const confs = ['premium', 'distinct', 'motion', 'style'].map((k) => A[k]?.confidence).filter((c) => typeof c === 'number');
  const fit = {};
  for (const k of Object.keys(INDUSTRIES)) {
    const v = A['fit_' + k]?.noul;
    if (typeof v === 'number') fit[k] = r2(v);
  }
  const style = A.style?.choice || null;
  return {
    v: TASTE_VERSION,
    relevant: r2(A.relevant?.noul ?? 0),
    premium: lvl(A.premium, PREMIUM.length - 1),
    distinct: lvl(A.distinct, DISTINCT.length - 1),
    motion: lvl(A.motion, MOTION.length - 1),
    risk: r2(A.risk?.noul ?? 0),
    style: style === 'neutral' ? null : style,
    style_p: A.style?.probabilities
      ? Object.fromEntries(Object.entries(A.style.probabilities).map(([k, p]) => [k, r2(p)]))
      : undefined,
    fit,
    conf: confs.length ? r2(Math.min(...confs)) : null,
    image: !!image,
    at: new Date().toISOString(),
  };
}

/** The premium value to use: a person's rating wins over the model's. */
export const premiumOf = (t) => (typeof t?.manual?.premium === 'number' ? t.manual.premium / 4 : t?.premium);

/** Scores one link row with Jev. Returns the taste record; saves it when it can. */
export async function scoreTaste(link, { save = true, withImage = true } = {}) {
  if (!jevEnabled()) throw new Error('Taste scoring needs TYPESAFE_API_KEY or OPENROUTER_API_KEY');

  let assets;
  let state = { item: describe(link) };
  if (withImage && link.image && jevImagesEnabled()) {
    const data = await fetchImage(link.image, { maxWidth: 1100, maxHeight: 1100 });
    const a = data && jevAsset(data);
    if (a) {
      assets = { [a.ref]: a.asset };
      state.preview = a.ref;
    }
  }

  let answers;
  try {
    answers = await jevDecide(state, tasteQuestions(!!assets), 25000, assets ? { assets } : {});
  } catch (e) {
    if (!assets) throw e;
    // A bad image should not cost the item its score: retry from text alone.
    state = { item: state.item };
    assets = undefined;
    answers = await jevDecide(state, tasteQuestions(false), 25000);
  }

  const old = link.taste && typeof link.taste === 'object' ? link.taste : null;
  const taste = readTaste(answers, { image: !!assets });
  if (old?.manual) taste.manual = old.manual; // never throw away a person's rating

  if (save) {
    const { error } = await db.from('links').update({ taste, taste_v: TASTE_VERSION }).eq('id', link.id);
    if (error) taste.not_saved = error.message;
  }
  return taste;
}

/** For ranking: every item gets a value for every dimension, flagged when unscored. */
export function tasteOrNeutral(t) {
  if (!t || typeof t !== 'object' || t.v == null) {
    return { scored: false, relevant: 0.5, premium: 0.5, distinct: 0.5, motion: 0.4, risk: 0.2, style: null, style_p: null, fit: {}, conf: null };
  }
  return { scored: true, ...t, premium: premiumOf(t) ?? 0.5 };
}
