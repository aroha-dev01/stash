import { visionEnabled, visionJSON, fetchImage } from '../vision.js';

// The visual half of an audit. Two jobs, both done by an open vision model:
//
//   seeSite      look at the client's page and describe what it looks like:
//                imagery, hierarchy, density, consistency, per-section problems.
//                That description joins the evidence Jev and the design model see.
//
//   pickVisuals  look at the screenshots of the library tools matched to a
//                section and say which one fits THIS site's look and what to
//                borrow from it. Code, not the model, owns the ordering.
//
// Vision models describe well and score badly, so they answer in words and a
// few fixed categories; the numbers come from mapping those categories.

export const VISUAL_ISSUES = {
  'generic-stock-imagery': 'Photos look like generic stock rather than this business',
  'low-quality-images': 'Images look blurry, pixelated or badly cropped',
  'no-imagery': 'Large areas with no image or illustration where one would help',
  'weak-hierarchy': 'Nothing clearly leads the eye; headings, buttons and body compete',
  'crowded': 'Too much packed in, with little breathing room',
  'inconsistent-style': 'Sections look like they came from different designs',
  'low-contrast': 'Text or buttons are hard to read against their background',
  'flat-sameness': 'Every section has the same layout, so the page feels monotone',
  'dated-look': 'Styling feels a few years old',
};

const pick = (v, allowed, max) => (Array.isArray(v) ? v : []).map((x) => String(x).toLowerCase().trim()).filter((x) => allowed.includes(x)).slice(0, max);
const word = (v, allowed, dflt) => (allowed.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : dflt);

const SEE_SYSTEM = [
  'You are a senior visual designer looking at a screenshot of a client\'s website, top to bottom.',
  'Describe only what you can actually see. Do not guess about things off-screen, and do not judge the copy.',
  'Return strict JSON:',
  '{',
  '  "look": "one sentence: the overall visual style, e.g. clean, dark, editorial, playful",',
  '  "palette": ["up to 5 dominant colours as plain names or hex"],',
  '  "imagery": "custom-photography | stock-photos | illustration | icons-only | none | mixed",',
  '  "hierarchy": "strong | ok | weak",',
  '  "density": "sparse | balanced | crowded",',
  '  "consistency": "consistent | mixed | inconsistent",',
  '  "issues": [any of: ' + Object.keys(VISUAL_ISSUES).map((k) => '"' + k + '"').join(', ') + '],',
  '  "sections": [ { "position": <number from the list given>, "visual_issues": [same vocabulary], "imagery": "custom | stock | illustration | none | n/a", "image_need": "one short phrase on what visual would help, or null" } ]',
  '}',
  'Only list a section if you can match it to what you see. Empty arrays are fine.',
].join('\n');

/** Looks at the client's page. Returns site.visual, or null if it could not. */
export async function seeSite(site, sections, deadline) {
  if (!visionEnabled()) return null;
  const shot =
    (await fetchImage(site.screenshot, { maxBytes: 4_500_000, timeoutMs: 14000 })) ||
    (await fetchImage(site.screenshot_fallback, { maxBytes: 4_500_000, timeoutMs: 12000 }));
  if (!shot) return { skipped: 'Could not get a screenshot of the page' };

  const list = sections.map((s) => '#' + (s.position + 1) + ' ' + (s.name_hint || s.tag || 'section') + (s.headings?.[0] ? ' — "' + String(s.headings[0]).slice(0, 70) + '"' : ''));
  const text = 'Page: ' + (site.title || site.url) + '\nSections, in page order (numbers are positions):\n' + list.join('\n');

  try {
    const { result: r, model } = await visionJSON(SEE_SYSTEM, text, [shot], { deadline, maxTokens: 1600 });
    const valid = new Set(sections.map((s) => s.position + 1));
    return {
      model,
      look: r.look ? String(r.look).slice(0, 160) : null,
      palette: (Array.isArray(r.palette) ? r.palette : []).map((c) => String(c).slice(0, 24)).slice(0, 5),
      imagery: word(r.imagery, ['custom-photography', 'stock-photos', 'illustration', 'icons-only', 'none', 'mixed'], 'mixed'),
      hierarchy: word(r.hierarchy, ['strong', 'ok', 'weak'], 'ok'),
      density: word(r.density, ['sparse', 'balanced', 'crowded'], 'balanced'),
      consistency: word(r.consistency, ['consistent', 'mixed', 'inconsistent'], 'mixed'),
      issues: pick(r.issues, Object.keys(VISUAL_ISSUES), 6),
      sections: (Array.isArray(r.sections) ? r.sections : [])
        .map((s) => ({
          position: Number(s.position),
          visual_issues: pick(s.visual_issues, Object.keys(VISUAL_ISSUES), 3),
          imagery: word(s.imagery, ['custom', 'stock', 'illustration', 'none', 'n/a'], 'n/a'),
          image_need: s.image_need ? String(s.image_need).slice(0, 120) : null,
        }))
        .filter((s) => valid.has(s.position))
        .slice(0, 20),
    };
  } catch (e) {
    if (e.retry) throw e;
    return { skipped: 'Vision model could not read the page: ' + String(e.message).slice(0, 100) };
  }
}

/** What the section-level models should know about how a section looks. */
export function visualFor(site, position) {
  const v = site?.visual;
  if (!v || v.skipped) return undefined;
  const s = (v.sections || []).find((x) => x.position === position + 1);
  return {
    page_look: v.look, imagery_overall: v.imagery, hierarchy: v.hierarchy, density: v.density, consistency: v.consistency,
    this_section: s ? { problems: (s.visual_issues || []).map((k) => VISUAL_ISSUES[k]), imagery: s.imagery, would_help: s.image_need } : undefined,
  };
}

const PICK_SYSTEM = [
  'You are a senior visual designer choosing reference visuals for a client\'s website.',
  'You get the client\'s visual identity, the section being redesigned, and several reference screenshots in order (Image 1, Image 2, ...).',
  'For each image judge how well its look would suit THIS client and THIS section, and what is worth borrowing.',
  'Return strict JSON:',
  '{ "picks": [ { "image": <1-based number>, "fit": "strong | decent | weak", "why": "one plain sentence about the visual match or clash",',
  '               "borrow": "the specific thing to take from it (layout, imagery style, motion, colour use), or null" } ] }',
  'Be willing to say weak. A good-looking reference that clashes with the client\'s style is weak.',
].join('\n');

const FIT = { strong: 0.85, decent: 0.55, weak: 0.2 };

/**
 * Ranks library tools by how well their screenshots suit this client and this
 * section. Returns [{ tool_id, fit, label, why, borrow }] best first, or []
 * when vision is off or nothing could be read.
 */
export async function pickVisuals(section, site, candidates, deadline) {
  if (!visionEnabled()) return [];
  const withImage = candidates.filter((c) => c.image).slice(0, 5);
  if (withImage.length < 2) return [];

  const fetched = await Promise.all(withImage.map((c) => fetchImage(c.image, { maxBytes: 2_500_000, timeoutMs: 8000 })));
  const usable = withImage.map((c, i) => ({ c, img: fetched[i] })).filter((x) => x.img);
  if (usable.length < 2) return [];

  const sv = visualFor(site, section.position);
  const text = JSON.stringify({
    client: {
      business_type: site.judgement?.business_type,
      look_today: sv?.page_look, imagery_today: sv?.imagery_overall,
      colours: site.colours?.slice(0, 5), fonts: site.fonts?.slice(0, 2),
    },
    section: {
      type: section.type, headings: section.headings, problems: section.issues,
      visual: sv?.this_section,
    },
    references: usable.map((x, i) => ({ image: i + 1, name: x.c.title, kind: x.c.type })),
  });

  const { result } = await visionJSON(PICK_SYSTEM, text, usable.map((x) => x.img), { deadline, maxTokens: 1000 });
  const picks = (Array.isArray(result.picks) ? result.picks : [])
    .map((p) => {
      const x = usable[Number(p.image) - 1];
      const label = ['strong', 'decent', 'weak'].includes(String(p.fit).toLowerCase()) ? String(p.fit).toLowerCase() : 'decent';
      return x ? { tool_id: x.c.id, fit: FIT[label], label, why: String(p.why || '').slice(0, 220), borrow: p.borrow ? String(p.borrow).slice(0, 200) : null } : null;
    })
    .filter(Boolean);
  const seen = new Set();
  return picks.filter((p) => (seen.has(p.tool_id) ? false : seen.add(p.tool_id))).sort((a, b) => b.fit - a.fit);
}
