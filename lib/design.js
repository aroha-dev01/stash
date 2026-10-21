import { db } from './supabase.js';
import { embed } from './embed.js';
import { jevDecide, jevEnabled } from './models.js';
import { STYLES } from './taxonomy.js';
import { INDUSTRIES, tasteOrNeutral } from './taste.js';

// design_brief: "design me a hero / a site" in, a coherent set of premium
// picks from the user's own library out.
//
// Division of labour (the TypeSafe pattern):
//   Jev    reads the brief once (industry, style, how premium, how much motion,
//          which sections), and checks that the finished set looks like one site.
//   Code   retrieves candidates, combines the stored taste scores with the brief
//          using explicit weights, and enforces the rules (motion budget, stack,
//          maintained). Change a weight here and nothing needs rescoring.

const PAGE_SECTIONS = [
  'navbar', 'hero', 'features', 'product-showcase', 'logos', 'testimonials', 'stats', 'pricing',
  'faq', 'cta', 'gallery-portfolio', 'about-team', 'contact', 'footer', 'how-it-works', 'blog-content',
];
const WHOLE_SITE = ['navbar', 'hero', 'features', 'testimonials', 'cta', 'footer'];
const MAX_SECTIONS = 8;

// How the brief's wishes are weighed against what a pick offers. Sums to 1.
export const WEIGHTS = { relevance: 0.30, style: 0.20, fit: 0.12, premium: 0.18, distinct: 0.10, health: 0.10 };

/* --------------------------------------------------------- style guidance */

// Direction for the agent that will write the code: what each look needs in
// type, colour, space and motion, and the usual way it goes wrong.
export const STYLE_GUIDE = {
  minimal: { type: 'One neutral grotesque or humanist sans at a few sizes. Let size and weight carry hierarchy.', palette: 'Near-white and near-black with one restrained accent used sparingly.', space: 'Generous. Wide margins and long pauses between sections.', motion: 'Almost none: gentle fades on interaction only.', avoid: 'Adding decoration to fill the space; grey-on-grey text that fails contrast.' },
  editorial: { type: 'A serif or text face for headlines with a plain sans for UI. Real typographic scale, narrow measure for reading.', palette: 'Paper-like neutrals with ink-dark text and one assertive accent.', space: 'Column-led layouts, deliberate asymmetry, captions and rules that mean something.', motion: 'Sparse. One reveal on load at most.', avoid: 'Serif plus terracotta by reflex; stacks of identical rounded cards.' },
  brutalist: { type: 'Heavy grotesque or monospace, oversized, tightly tracked, system fonts are fine.', palette: 'Stark black and white with one loud colour, or raw default-looking colours chosen on purpose.', space: 'Hard grid, visible borders, no softness.', motion: 'Abrupt and mechanical, or none.', avoid: 'Polish that undoes the point; low contrast; unreadable body text.' },
  playful: { type: 'Rounded or quirky display face with a friendly sans for text.', palette: 'Warm, saturated colours with plenty of contrast and room to breathe.', space: 'Loose and bouncy, shapes that overlap a little.', motion: 'Springy micro-interactions that respond to the visitor.', avoid: 'Cartoon clutter; motion on every element; children-only tone for a serious service.' },
  luxury: { type: 'A refined serif or wide-set sans in light weights, generous tracking in small caps-free labels.', palette: 'Deep, low-saturation tones with metallic or warm accents used in small amounts.', space: 'Very generous, few elements per screen, large photography.', motion: 'Slow and smooth: long eases, subtle parallax at most.', avoid: 'Gold gradients, heavy drop shadows, crowding the page, stock photography.' },
  corporate: { type: 'A clear sans family with a tidy scale; one weight step between levels.', palette: 'Trustworthy blues, greens or deep neutrals with strong accessible contrast.', space: 'Even and structured, predictable grid.', motion: 'Minimal and functional.', avoid: 'Stock-photo handshakes; generic gradient hero; every section the same shape.' },
  'futuristic-tech': { type: 'Geometric or technical sans, optionally a mono for data.', palette: 'Dark base with a precise accent, used for focus and data, not glow everywhere.', space: 'Dense but ordered, clear hierarchy of panels.', motion: 'Purposeful: data and state changes, not constant movement.', avoid: 'Neon on black by default; blur everywhere; animation that slows the page.' },
  glassmorphism: { type: 'Clean sans, medium weights, high contrast against the blurred layers.', palette: 'Soft gradient backdrop with translucent panels and a single accent.', space: 'Layered, with clear depth order.', motion: 'Slow parallax between layers, hover lift.', avoid: 'Text on busy blur (fails contrast); using it on every surface.' },
  retro: { type: 'Period-appropriate display face with a sturdy text face.', palette: 'Limited, slightly faded palette that belongs to one era.', space: 'Boxed, poster-like composition.', motion: 'Simple, stepped or looping details.', avoid: 'Mixing eras; pastiche that hurts usability.' },
  organic: { type: 'Soft serif or humanist sans, natural rhythm.', palette: 'Earthy, muted colours drawn from the subject.', space: 'Flowing, rounded shapes, uneven rhythm.', motion: 'Gentle, slow, nature-like easing.', avoid: 'Beige by reflex; leaf icons as decoration.' },
  'bold-colorful': { type: 'Big confident display type with a sturdy text face.', palette: 'A few strong colours used in large flat areas with clear contrast.', space: 'Big blocks, confident cropping.', motion: 'Energetic but short.', avoid: 'Rainbow with no hierarchy; colour that fights the text.' },
  'dark-mode': { type: 'Slightly larger text and weight than on light backgrounds.', palette: 'Layered greys rather than pure black, one accent, softened whites.', space: 'Clear surface elevation, borders over shadows.', motion: 'Restrained.', avoid: 'Pure white text on pure black; glow as decoration.' },
};

export const ANTI_GENERIC = [
  'Write real copy for this business. No lorem ipsum, no "Welcome to our website".',
  'Do not default to a purple or indigo gradient hero, or a centred headline over a blurred blob.',
  'Do not turn every section into the same grid of identical rounded cards. Vary rhythm and density on purpose.',
  'Pick one memorable moment per page and keep everything around it quiet.',
  'Use one or two typefaces with a clear scale. Check contrast (4.5:1 for body text) and a visible keyboard focus.',
  'Build mobile first, respect prefers-reduced-motion, and keep animation purposeful.',
];

/* ---------------------------------------------------------- reading a brief */

const KEYWORDS = {
  industry: {
    'real-estate': /real.?estate|propert|plots?|villa|apartment|realtor|land\b/i,
    saas: /saas|software|app\b|platform|dashboard|startup|api\b/i,
    portfolio: /portfolio|agency|studio|designer|developer|freelanc/i,
    hospitality: /restaurant|cafe|caf[eé]|hotel|resort|travel|tour|bar\b/i,
    ecommerce: /shop|store|e-?commerce|brand|product catalog|fashion/i,
    health: /clinic|dental|doctor|wellness|fitness|gym|spa|salon|beauty|yoga/i,
    education: /school|course|academy|tutor|education|university/i,
    professional: /law|legal|account|finance|consult|advis|insurance/i,
    local: /plumb|electric|repair|cleaning|contractor|salon|local/i,
    creator: /blog|creator|personal|newsletter|influencer/i,
    nonprofit: /non-?profit|charity|ngo|community|event|church|temple/i,
  },
  style: {
    luxury: /luxur|premium|high-?end|exclusive|elegant/i,
    minimal: /minimal|clean|simple|calm/i,
    editorial: /editorial|magazine|story|journal/i,
    brutalist: /brutal|raw|stark/i,
    playful: /playful|fun|friendly|quirky/i,
    'futuristic-tech': /futur|tech|ai\b|cyber/i,
    'dark-mode': /dark/i,
    'bold-colorful': /bold|colou?rful|vibrant/i,
    glassmorphism: /glass|frosted/i,
    organic: /organic|natural|earthy/i,
    retro: /retro|vintage/i,
    corporate: /corporate|enterprise|b2b/i,
  },
  section: {
    navbar: /nav(bar|igation)?|menu|header/i, hero: /hero|landing|above the fold|banner/i, features: /feature|benefit|service/i,
    'product-showcase': /showcase|product/i, logos: /logo|client|partner/i, testimonials: /testimonial|review/i,
    stats: /stat|number|metric/i, pricing: /pricing|plan|package/i, faq: /faq|question/i, cta: /cta|call to action|signup|enquir/i,
    'gallery-portfolio': /gallery|portfolio|work|project/i, 'about-team': /about|team/i, contact: /contact|enquiry|form/i, footer: /footer/i,
    'how-it-works': /how it works|steps|process/i, 'blog-content': /blog|article|news/i,
  },
};

const topKey = (map, text, fallback) => {
  let best = fallback, n = 0;
  for (const [k, re] of Object.entries(map)) { const m = text.match(new RegExp(re.source, 'gi')); if (m && m.length > n) { best = k; n = m.length; } }
  return best;
};

function keywordProfile(brief) {
  const wantsSite = /\b(website|web site|landing page|whole site|site)\b/i.test(brief);
  const found = Object.entries(KEYWORDS.section).filter(([, re]) => re.test(brief)).map(([k]) => k);
  const sections = found.length && !(wantsSite && found.length < 2) ? found : (wantsSite ? WHOLE_SITE : ['hero']);
  const style = topKey(KEYWORDS.style, brief, null);
  return {
    source: 'keywords',
    industry: topKey(KEYWORDS.industry, brief, 'other'),
    industry_p: null,
    style,
    style_p: style ? { [style]: 0.7 } : null,
    premium_target: /luxur|premium|high-?end/i.test(brief) ? 0.8 : 0.65,
    motion_cap: /minimal|calm|simple/i.test(brief) ? 0.35 : /immersive|3d|webgl|animated|motion/i.test(brief) ? 0.9 : 0.55,
    sections: sections.slice(0, MAX_SECTIONS),
    uncertain: ['Read with keywords only (no Jev key), so industry and style are best guesses.'],
  };
}

const BRIEF_PREMIUM = ['Clean and functional', 'Polished and professional', 'Premium and refined', 'High-end, luxury feel'];
const BRIEF_MOTION = ['No animation', 'Subtle transitions only', 'Expressive, animation is part of the feel', 'Immersive: 3D, scroll storytelling or heavy motion'];

/** Reads the brief with Jev: one request, every question answered in parallel. */
export async function readBrief(brief, opts = {}) {
  const base = keywordProfile(brief);
  let out = { ...base };

  if (jevEnabled()) {
    try {
      const questions = {
        industry: {
          type: 'choice',
          instructions: 'What kind of business or product is this website for?',
          criteria: { ...INDUSTRIES, other: 'None of these fit.' },
        },
        style: {
          type: 'choice',
          instructions: 'Which visual style does this brief ask for or imply? If it asks for premium or high-end with no other cue, choose luxury.',
          criteria: Object.fromEntries(STYLES.map((s) => [s, 'The ' + s + ' look.'])),
        },
        premium: { type: 'score', instructions: 'How premium should the finished design feel?', criteria: BRIEF_PREMIUM },
        motion: { type: 'score', instructions: 'How much animation should the design use?', criteria: BRIEF_MOTION },
      };
      for (const s of PAGE_SECTIONS) {
        questions['want_' + s] = { type: 'noul', instructions: 'The brief asks for, or a complete version of it clearly needs, a ' + s.replace(/-/g, ' ') + ' section.' };
      }
      const a = await jevDecide({ brief }, questions, 20000);

      const wanted = PAGE_SECTIONS.map((s) => [s, a['want_' + s]?.noul ?? 0]).filter(([, p]) => p >= 0.5).sort((x, y) => y[1] - x[1]).map(([s]) => s);
      const uncertain = [];
      if ((a.industry?.confidence ?? 1) < 0.45) uncertain.push('Industry is unclear from the brief.');
      if ((a.style?.confidence ?? 1) < 0.4) uncertain.push('Visual style is unclear from the brief; a direction was chosen for you.');
      out = {
        source: 'jev',
        industry: a.industry?.choice && a.industry.choice !== 'other' ? a.industry.choice : base.industry,
        industry_p: a.industry?.probabilities || null,
        style: a.style?.choice || base.style,
        style_p: a.style?.probabilities || base.style_p,
        premium_target: Math.max(0.55, Math.min(1, (a.premium?.score ?? 1.5) / 3)),
        motion_cap: Math.min(1, (a.motion?.score ?? 1.2) / 3 + 0.15),
        sections: (wanted.length ? wanted : base.sections).slice(0, MAX_SECTIONS),
        uncertain,
      };
    } catch (e) {
      out.uncertain = ['Jev could not read the brief (' + String(e.message).slice(0, 80) + '), so keywords were used.'];
    }
  }

  // Explicit arguments always win over inference.
  if (opts.sections?.length) out.sections = opts.sections.map(String).slice(0, MAX_SECTIONS);
  if (opts.style && STYLES.includes(opts.style)) { out.style = opts.style; out.style_p = { [opts.style]: 0.9 }; }
  if (opts.industry && INDUSTRIES[opts.industry]) out.industry = opts.industry;
  if (typeof opts.premium === 'number') out.premium_target = Math.max(0, Math.min(1, opts.premium));
  if (!out.style) out.style = 'minimal';
  if (!out.sections.length) out.sections = ['hero'];
  return out;
}

/* ------------------------------------------------------------- retrieval */

const INSTALLABLE = new Set(['library', 'template', 'app', 'saas', 'cli', 'mcp-server']);
const GALLERY = new Set(['reference', 'article']);
const SELECT = 'id,title,url,domain,image,summary,use_cases,type,category,install,quickstart,avoid_when,works_with,requires,maturity,integration_effort,commercial_ok,pricing,is_open_source,sections,style_tags,effect_kind,dead';

async function candidates(section, brief, profile, limit = 28) {
  const q = brief + ' ' + section.replace(/-/g, ' ') + ' ' + profile.style;
  const q_embedding = await embed(q);
  const call = (f_section) => db.rpc('search_links', {
    q, q_embedding, f_category: null, f_pricing: null, f_source: null, f_kind: null, f_status: null, f_tags: null,
    f_oss: false, f_starred: false, f_collection: null, f_works_with: null, f_type: null, f_language: null, f_min_stars: null,
    f_maintained: false, f_dead: false, f_section, f_style: null, f_effect: null, sort_by: 'newest', max_rows: limit, skip_rows: 0,
  });
  const first = await call(section);
  let rows = first.data || [];
  // A section with few tagged items gets a wider net rather than an empty answer.
  if (rows.length < 6) {
    const wide = await call(null);
    const seen = new Set(rows.map((r) => r.id));
    rows = rows.concat((wide.data || []).filter((r) => !seen.has(r.id)));
  }
  return rows.slice(0, limit);
}

async function tastesFor(ids) {
  if (!ids.length) return {};
  const { data, error } = await db.from('links').select('id,taste').in('id', ids);
  if (error) return {}; // columns not created yet: everything is ranked unscored
  return Object.fromEntries((data || []).map((r) => [r.id, r.taste]));
}

/* --------------------------------------------------------------- ranking */

const dot = (a, b) => (a && b ? Object.keys(a).reduce((s, k) => s + (a[k] || 0) * (b[k] || 0), 0) : null);
const clamp = (n) => Math.max(0, Math.min(1, n));
const r2 = (n) => Math.round(n * 100) / 100;

/** One candidate scored against the brief. Exported so it can be tested. */
export function rank(row, taste, idx, total, profile, ctx = {}) {
  const t = tasteOrNeutral(taste);
  const reasons = [];
  const stack = (ctx.stack || []).map((s) => String(s).toLowerCase());

  const relevance = 1 - idx / Math.max(total, 1);
  let style = null;
  if (t.style_p && profile.style_p) style = dot(t.style_p, profile.style_p);
  else if (t.style) style = t.style === profile.style ? 0.9 : 0.25;
  else if (row.style_tags?.length) style = row.style_tags.includes(profile.style) ? 0.8 : 0.3;
  if (style == null) style = 0.45;
  if (style >= 0.6) reasons.push('fits the ' + profile.style + ' direction');

  const fit = profile.industry !== 'other' && t.fit?.[profile.industry] != null ? t.fit[profile.industry] : 0.5;
  if (fit >= 0.65) reasons.push('suits ' + profile.industry.replace('-', ' ') + ' sites');

  const premium = t.premium ?? 0.5;
  const premiumScore = clamp(premium / Math.max(profile.premium_target, 0.01));
  if (premium >= 0.7) reasons.push('premium craft (' + r2(premium) + ')');

  const distinct = t.distinct ?? 0.5;
  if (distinct >= 0.7) reasons.push('distinctive, not template-like');

  let health = 0.6;
  if (row.maturity === 'active') health = 1;
  else if (row.maturity === 'stale') health = 0.35;
  else if (row.maturity === 'archived') health = 0;
  if (row.integration_effort === 'drop-in') health = Math.min(1, health + 0.1);
  if (row.maturity === 'active') reasons.push('actively maintained');

  let score = WEIGHTS.relevance * relevance + WEIGHTS.style * style + WEIGHTS.fit * fit + WEIGHTS.premium * premiumScore + WEIGHTS.distinct * distinct + WEIGHTS.health * health;

  // Rules, not weights: these subtract.
  const motion = t.motion ?? 0.4;
  if (motion > profile.motion_cap) { score -= (motion - profile.motion_cap) * 0.35; reasons.push('more motion than the brief wants'); }
  else if (motion <= profile.motion_cap && motion >= 0.5) reasons.push('motion within budget');
  if (t.risk >= 0.5) { score -= t.risk * 0.2; reasons.push('watch accessibility or performance'); }
  if (row.maturity === 'archived') score -= 0.4;
  if (taste && taste.relevant != null && taste.relevant < 0.35) score -= 0.5;
  if (!t.scored) score -= 0.03;

  const wants = (row.works_with || []).map((w) => String(w).toLowerCase());
  if (stack.length && INSTALLABLE.has(row.type) && wants.length) {
    if (stack.some((s) => wants.some((w) => w.includes(s) || s.includes(w)))) { score += 0.06; reasons.push('works with ' + stack.join(', ')); }
    else { score -= 0.1; reasons.push('may not support ' + stack.join(', ')); }
  }

  return { score: r2(score), reasons: reasons.slice(0, 5), scored: t.scored, parts: { relevance: r2(relevance), style: r2(style), fit: r2(fit), premium: r2(premium), distinct: r2(distinct), motion: r2(motion), risk: r2(t.risk ?? 0) }, style_of: t.style || row.style_tags?.[0] || null, motion };
}

const pick = (row, ranked) => ({
  id: row.id,
  name: row.title,
  url: row.url,
  kind: INSTALLABLE.has(row.type) ? 'component' : GALLERY.has(row.type) ? 'inspiration' : 'other',
  type: row.type || 'other',
  preview_image: row.image || null,
  what_it_is: row.summary || null,
  why_it_fits: ranked.reasons,
  score: ranked.score,
  scores: ranked.parts,
  scored_by_jev: ranked.scored,
  install: row.install || null,
  quickstart: row.quickstart || null,
  works_with: row.works_with || [],
  avoid_when: row.avoid_when || null,
  maturity: row.maturity || 'unknown',
  pricing: row.pricing || null,
  open_source: !!row.is_open_source,
  _style: ranked.style_of,
  _motion: ranked.motion,
});

async function sectionPlan(section, brief, profile, ctx) {
  const rows = (await candidates(section, brief, profile)).filter((r) => !r.dead);
  const tastes = await tastesFor(rows.map((r) => r.id));
  const ranked = rows.map((r, i) => pick(r, rank(r, tastes[r.id], i, rows.length, profile, ctx))).sort((a, b) => b.score - a.score);
  const components = ranked.filter((p) => p.kind === 'component');
  const inspiration = ranked.filter((p) => p.kind === 'inspiration');
  const prefer = ctx.kind === 'inspiration' ? inspiration : components.length ? components : ranked;
  return { section, pool: rows.length, picks: prefer.slice(0, 3), inspiration: inspiration.slice(0, 2), other_components: components.slice(0, 3) };
}

/* ------------------------------------------------------------- coherence */

/**
 * The picks together have to look like one site. Code first (a motion budget,
 * one item per section), then Jev judges each pair; a pick that clashes with
 * the others is swapped for its runner-up once.
 */
async function makeCoherent(plan, profile, notes) {
  const chosen = () => plan.filter((s) => s.picks[0]);

  // One item, one section: the weaker claim moves to its runner-up.
  const claimed = new Map();
  for (const s of [...plan].sort((x, y) => (y.picks[0]?.score || 0) - (x.picks[0]?.score || 0))) {
    while (s.picks[0] && claimed.has(s.picks[0].id) && s.picks.length > 1) s.picks.push(s.picks.shift());
    if (s.picks[0]) {
      if (claimed.has(s.picks[0].id)) { s.picks.shift(); continue; }
      claimed.set(s.picks[0].id, s.section);
    }
  }

  // Motion budget: at most two heavy-motion picks per page.
  let heavy = chosen().filter((s) => s.picks[0]._motion >= 0.7).sort((a, b) => a.picks[0].score - b.picks[0].score);
  while (heavy.length > 2) {
    const s = heavy.shift();
    if (s.picks.length > 1) { const dropped = s.picks.shift(); s.picks.push(dropped); notes.push('Swapped ' + dropped.name + ' in ' + s.section + ' for a calmer pick: too many heavy-motion elements on one page.'); }
  }

  const cs = chosen();
  if (!jevEnabled() || cs.length < 2) return;
  try {
    const state = { direction: profile.style + ' look for ' + profile.industry.replace('-', ' '), picks: Object.fromEntries(cs.map((s) => [s.section, s.picks[0].name + ': ' + (s.picks[0].what_it_is || '')])) };
    const questions = {};
    const pairs = [];
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const key = 'p_' + i + '_' + j;
      pairs.push([key, cs[i], cs[j]]);
      questions[key] = { type: 'noul', instructions: 'The `picks.' + cs[i].section + '` and `picks.' + cs[j].section + '` would look consistent together on one website with the `direction`.' };
    }
    if (pairs.length > 28) return;
    const a = await jevDecide(state, questions, 15000);
    const clashes = {};
    for (const [key, x, y] of pairs) {
      const p = a[key]?.noul;
      if (typeof p === 'number' && p < 0.4) { const low = x.picks[0].score <= y.picks[0].score ? x : y; clashes[low.section] = (clashes[low.section] || 0) + 1; }
    }
    const worst = Object.entries(clashes).sort((m, n) => n[1] - m[1])[0];
    if (worst) {
      const s = plan.find((p) => p.section === worst[0]);
      if (s && s.picks.length > 1) {
        const out = s.picks.shift();
        s.picks.push(out);
        notes.push(out.name + ' in ' + s.section + ' clashed with other picks, so ' + s.picks[0].name + ' was chosen instead.');
      }
    }
  } catch { /* the code-side rules already ran; skip the pair check */ }
}

/* ----------------------------------------------------------------- output */

const strip = (p) => { const { _style, _motion, ...rest } = p; return rest; };

function briefMarkdown(brief, profile, plan, refs, notes) {
  const g = STYLE_GUIDE[profile.style] || STYLE_GUIDE.minimal;
  const L = [];
  L.push('# Design brief', '', brief, '');
  L.push('## Direction', '- Style: ' + profile.style, '- For: ' + profile.industry.replace('-', ' '), '- Typography: ' + g.type, '- Colour: ' + g.palette, '- Space: ' + g.space, '- Motion: ' + g.motion, '- Avoid: ' + g.avoid, '');
  L.push('## Sections and what to build them with', '');
  for (const s of plan) {
    const p = s.picks[0];
    L.push('### ' + s.section.replace(/-/g, ' '));
    if (!p) { L.push('Nothing saved fits this section. Build it from scratch and keep it quiet.', ''); continue; }
    L.push('Use **' + p.name + '** (' + p.url + ').', 'Why: ' + (p.why_it_fits.join('; ') || p.what_it_is || 'best match in the library') + '.');
    if (p.install) L.push('Install: `' + p.install + '`');
    if (p.quickstart) L.push('Quickstart: ' + p.quickstart);
    if (p.avoid_when) L.push('Skip it if: ' + p.avoid_when);
    if (s.inspiration[0]) L.push('Look at for inspiration: ' + s.inspiration.map((i) => i.name + ' (' + i.url + ')').join(', '));
    L.push('');
  }
  if (refs.length) L.push('## Reference design systems', ...refs.map((r) => '- ' + r.name + ' ' + r.url), '');
  L.push('## Rules for the result', ...ANTI_GENERIC.map((r) => '- ' + r), '');
  if (notes.length) L.push('## Notes', ...notes.map((n) => '- ' + n), '');
  return L.join('\n');
}

async function referenceSystems(profile) {
  try {
    const q = 'design system tokens DESIGN.md typography colour spacing';
    const { data } = await db.rpc('search_links', {
      q, q_embedding: await embed(q), f_category: null, f_pricing: null, f_source: null, f_kind: null, f_status: null, f_tags: null,
      f_oss: false, f_starred: false, f_collection: null, f_works_with: null, f_type: null, f_language: null, f_min_stars: null,
      f_maintained: false, f_dead: false, f_section: null, f_style: profile.style, f_effect: null, sort_by: 'newest', max_rows: 3, skip_rows: 0,
    });
    return (data || []).map((r) => ({ name: r.title, url: r.url }));
  } catch { return []; }
}

/**
 * @param args { brief, sections?, style?, industry?, stack?, premium?, kind? }
 */
export async function designBrief(args) {
  const brief = String(args.brief || '').trim().slice(0, 1500);
  if (!brief) throw new Error('brief is required: say what is being built and for whom');

  const profile = await readBrief(brief, args);
  const stack = (Array.isArray(args.stack) ? args.stack : String(args.stack || '').split(/[,\s]+/)).map((s) => s.trim()).filter(Boolean);
  const ctx = { stack, kind: args.kind };

  const plan = await Promise.all(profile.sections.map((s) => sectionPlan(s, brief, profile, ctx)));
  const notes = [...(profile.uncertain || [])];
  await makeCoherent(plan, profile, notes);

  const unscored = plan.flatMap((s) => s.picks.slice(0, 1)).filter((p) => p && !p.scored_by_jev).length;
  if (unscored) notes.push(unscored + ' pick(s) have no taste score yet, so they were ranked on relevance and style tags. Run /api/backfill/taste.');
  const refs = await referenceSystems(profile);

  const sections = plan.map((s) => ({
    section: s.section,
    pick: s.picks[0] ? strip(s.picks[0]) : null,
    alternates: s.picks.slice(1).map(strip),
    inspiration: s.inspiration.map(strip),
  }));

  return {
    brief,
    direction: {
      style: profile.style,
      industry: profile.industry,
      premium_target: r2(profile.premium_target),
      motion_budget: r2(profile.motion_cap),
      read_by: profile.source,
      ...STYLE_GUIDE[profile.style],
    },
    sections,
    reference_systems: refs,
    rules: ANTI_GENERIC,
    notes,
    build_brief: briefMarkdown(brief, profile, plan.map((s) => ({ ...s, picks: s.picks.map(strip), inspiration: s.inspiration.map(strip) })), refs, notes),
    how_to_use: 'Build with the picks above. Call how_to_use for any pick before writing integration code, and mark_used when one goes into the project.',
  };
}
