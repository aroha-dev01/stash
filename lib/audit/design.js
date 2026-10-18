import { db } from '../supabase.js';
import { embed } from '../embed.js';
import { designJSON, jevDecide, jevEnabled } from '../models.js';
import { SECTIONS } from '../taxonomy.js';
import { visualFor } from './see.js';

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
  rows = rows.slice(0, 12);

  // Re-rank with Jev when available (TypeSafe "find and judge evidence"
  // pattern): one Noul per candidate, all in one request, sorted by the
  // probability itself. Embedding search finds plausible tools; this judges
  // whether each one would actually help THIS section.
  if (jevEnabled() && rows.length > 1) {
    try {
      const questions = {};
      for (const r of rows) {
        questions['tool_' + r.id] = {
          type: 'noul',
          instructions: {
            candidate_tool: { name: r.title, kind: r.type, how_used: r.usage_format, what: r.summary, good_for_sections: r.sections, effects: r.effect_kind },
            question: 'Would `candidate_tool` directly help build a clearly better version of `section`, given its `problems`?',
          },
        };
      }
      const answers = await jevDecide(
        { section: { type: section.type, headings: section.headings, text: (section.text_excerpt || '').slice(0, 500), problems: section.issues } },
        questions,
        12000
      );
      rows = rows
        .map((r) => ({ r, p: answers['tool_' + r.id]?.noul ?? 0 }))
        .filter((x) => x.p >= 0.2)
        .sort((a, b) => b.p - a.p)
        .map((x) => x.r);
    } catch {
      // Fall back to search order; ranking is a refinement, not a requirement.
    }
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
  '- If `what_it_looks_like` is given, a vision model saw the rendered page: let it shape the visual side of each direction',
  '  (imagery, hierarchy, density) and do not contradict it.',
  '- Plain words. No marketing fluff.',
].join('\n');

/** Writes directions for one section. Returns { suggestion, engine }. */
export async function designSection(section, site, candidates, deadline) {
  const user = JSON.stringify({
    site: {
      title: site.title, url: site.url, framework: site.framework,
      fonts: site.fonts, colours: site.colours,
      business_type: site.judgement?.business_type,
      main_contact_goal: site.judgement?.contact_goal,
      proof_elsewhere_on_page: site.evidence?.sections_with_proof,
    },
    section: {
      position: section.position, type: section.type,
      headings: section.headings, text: section.text_excerpt,
      signals: section.signals,
      what_it_looks_like: visualFor(site, section.position),
      problems_found: section.issues,
      problem_scores: section.scores,
    },
    library_tools: candidates.map(CANDIDATE_FIELDS),
  });

  // Leave ~13s of the slice for Jev's verification pass below.
  const reserve = jevEnabled() ? 13000 : 0;
  const { result, engine } = await designJSON(SYSTEM, user, { maxTokens: 2500, deadline: (deadline || Date.now() + 40000) - reserve });

  const allowed = new Set(candidates.map((c) => c.id));
  let directions = (Array.isArray(result?.directions) ? result.directions : []).slice(0, 3).map((d) => ({
    title: String(d.title || 'Direction').slice(0, 80),
    idea: String(d.idea || '').slice(0, 700),
    tool_ids: (Array.isArray(d.tool_ids) ? d.tool_ids : []).map(Number).filter((id) => allowed.has(id)),
    effort: ['quick', 'half-day', 'bigger'].includes(d.effort) ? d.effort : 'half-day',
    prompt: String(d.prompt || '').slice(0, 2500),
  }));
  let copy = {
    headline: result?.copy?.headline ? String(result.copy.headline).slice(0, 160) : null,
    cta: result?.copy?.cta ? String(result.copy.cta).slice(0, 60) : null,
  };

  const verified = await verifyDirections(section, directions, copy);
  directions = verified.directions;
  copy = verified.copy;

  return {
    engine,
    suggestion: {
      diagnosis: String(result?.diagnosis || '').slice(0, 500),
      keep: result?.keep ? String(result.keep).slice(0, 300) : null,
      directions,
      copy,
      verified_by: verified.by,
      dropped: verified.dropped,
      engine,
    },
  };
}

/**
 * Jev checks what DeepSeek wrote before anyone sees it (TypeSafe "verify and
 * escalate"): for each direction, does it state facts the site does not
 * support, and does it actually fix the problems found? Directions that
 * invent facts are dropped (unless that would leave none, in which case the
 * best is kept and flagged); weak ones are flagged. A suggested headline
 * that invents facts is removed. Typed answers, thresholds in code.
 */
async function verifyDirections(section, directions, copy) {
  if (!jevEnabled() || !directions.length) return { directions, copy, by: null, dropped: 0 };
  const questions = {};
  directions.forEach((d, i) => {
    questions['invents_' + i] = {
      type: 'noul',
      instructions: {
        direction: { title: d.title, idea: d.idea },
        question: 'Does `direction` state specific facts about this business — numbers, names, results, awards, years, prices — that do not appear in `section.text` and are not clearly marked as placeholders to fill in?',
      },
      criteria: {
        true: 'It presents an invented figure, name or result as if it were true.',
        false: 'Every specific fact comes from the section, or it is explicitly a placeholder ("add a real figure here").',
      },
    };
    questions['fixes_' + i] = {
      type: 'noul',
      instructions: {
        direction: { title: d.title, idea: d.idea },
        question: 'Would carrying out `direction` fix the main problems listed in `section.problems`?',
      },
    };
  });
  if (copy?.headline) {
    questions.headline_invents = {
      type: 'noul',
      instructions: {
        suggested_headline: copy.headline,
        question: 'Does `suggested_headline` claim a specific fact (a number, ranking, award, "first", "only") that `section.text` does not support?',
      },
    };
  }

  let a;
  try {
    a = await jevDecide(
      { section: { type: section.type, headings: section.headings, text: (section.text_excerpt || '').slice(0, 900), problems: section.issues } },
      questions,
      12000
    );
  } catch {
    return { directions, copy, by: null, dropped: 0 };
  }

  const checked = directions.map((d, i) => ({
    ...d,
    checks: {
      invents_facts: Number((a['invents_' + i]?.noul ?? 0).toFixed(2)),
      fixes_problems: Number((a['fixes_' + i]?.noul ?? 0.5).toFixed(2)),
    },
  }));
  let kept = checked.filter((d) => d.checks.invents_facts < 0.6);
  if (!kept.length) {
    kept = [checked.sort((x, y) => x.checks.invents_facts - y.checks.invents_facts)[0]];
    kept[0].flag = 'May contain made-up details — check the facts before using.';
  }
  for (const d of kept) {
    if (!d.flag && d.checks.fixes_problems < 0.35) d.flag = 'Jev doubts this fixes the main problems.';
  }
  // Best fixers first.
  kept.sort((x, y) => y.checks.fixes_problems - x.checks.fixes_problems);

  const headlineBad = (a.headline_invents?.noul ?? 0) >= 0.6;
  return {
    directions: kept,
    copy: headlineBad ? { ...copy, headline: null } : copy,
    by: 'jev',
    dropped: checked.length - kept.length + (headlineBad ? 1 : 0),
  };
}
