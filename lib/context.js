import { db } from './supabase.js';
import { embed } from './embed.js';

// Building the model's view of your stash.
//
// Two layers, deliberately:
//
//   1. A full index of everything you own - one terse line per link. Cheap
//      enough to send every time (roughly 15 tokens each), and it means the
//      assistant genuinely knows the whole collection rather than only what
//      a search happened to surface. It can answer "do I have anything for
//      X" truthfully, including "no".
//
//   2. Full detail for the handful of links most relevant to the question,
//      pulled through the same hybrid search the UI uses.
//
// Breadth without depth invents features it cannot see. Depth without
// breadth confidently claims you own nothing, because the retriever missed
// it. You need both.

const INDEX_CAP = 400;
// The top N candidates get full detail AND are the only ones the model is
// allowed to cite with a clickable [#id] — kept small on purpose so the
// citation payload sent to the client stays short instead of carrying the
// whole library on every answer. The full index above still gives the model
// honest breadth ("do you have anything for X") — it just cannot hand out a
// dead link for something it only knows tersely.
const DETAIL_COUNT = 5;

const oneLine = (l) => {
  const bits = ['#' + l.id, l.title || l.domain];
  if (l.category) bits.push(l.category);
  const tags = (l.tags || []).slice(0, 3);
  if (tags.length) bits.push(tags.join('/'));
  if (l.collections?.length) bits.push('projects: ' + l.collections.join(', '));
  if (l.dead) bits.push('BROKEN LINK');
  return bits.join(' | ');
};

function detailBlock(l) {
  const lines = ['#' + l.id + ' ' + (l.title || l.domain)];
  if (l.summary) lines.push('  what: ' + l.summary);
  const cases = l.use_cases || [];
  if (cases[0]) lines.push('  helps: ' + cases[0]);
  if (cases.length > 1) lines.push('  use when: ' + cases.slice(1).join('; '));
  if (l.category) lines.push('  category: ' + l.category);
  if (l.tags?.length) lines.push('  tags: ' + l.tags.join(', '));

  const facts = [];
  if (l.pricing && l.pricing !== 'unknown') facts.push(l.pricing);
  if (l.is_open_source) facts.push('open source');
  if (l.repo_stars != null) facts.push(l.repo_stars + ' stars');
  if (l.repo_language) facts.push(l.repo_language);
  if (facts.length) lines.push('  facts: ' + facts.join(', '));

  if (l.note) lines.push('  your note: ' + l.note);
  lines.push('  url: ' + l.url);
  return lines.join('\n');
}

export async function buildContext(question) {
  // Layer 1: everything, terse. Ids here are for the model's own knowledge
  // of the full library, not for citing — see DETAIL_COUNT below for why
  // citations are restricted to the smaller detailed set instead.
  const { data: all } = await db
    .from('links')
    .select('id,title,domain,category,tags,collections,dead')
    .order('created_at', { ascending: false })
    .limit(INDEX_CAP);

  const index = all || [];

  // Layer 2: the relevant few, in full. Falls back to the newest links when
  // there is no question yet, or when search comes back empty.
  let detailed = [];
  const q = (question || '').trim();

  if (q) {
    const q_embedding = await embed(q);
    const { data } = await db.rpc('search_links', {
      q,
      q_embedding,
      f_category: null, f_pricing: null, f_source: null, f_kind: null,
      f_status: null, f_tags: null, f_oss: false, f_starred: false,
      sort_by: 'newest',
      max_rows: DETAIL_COUNT,
      skip_rows: 0,
    });
    detailed = data || [];
  }

  if (!detailed.length) {
    const { data } = await db
      .from('links')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(DETAIL_COUNT);
    detailed = data || [];
  }

  const parts = [];
  parts.push('THE COMPLETE LIST OF LINKS IN THIS STASH (' + index.length + ' saved):');
  parts.push(index.length ? index.map(oneLine).join('\n') : '(nothing saved yet)');

  if (detailed.length) {
    parts.push('');
    parts.push('FULL DETAIL ON THE MOST RELEVANT ONES:');
    parts.push(detailed.map(detailBlock).join('\n\n'));
  }

  // Sources are exactly the detailed set — the top few matches, not the
  // whole library. This is deliberately the ONLY thing the model may cite
  // with a clickable id (see SYSTEM below), which keeps the payload short
  // and guarantees every citation the client renders is one it can resolve.
  const sources = detailed.map((l) => ({
    id: l.id,
    title: l.title || l.domain,
    url: l.url,
    category: l.category || null,
  }));

  return { text: parts.join('\n'), sources, total: index.length };
}

export const SYSTEM = [
  "You are Stash, the assistant for one person's private collection of saved tools, repos and links.",
  'You are given the complete index of what they have saved, plus full detail on the most relevant entries.',
  '',
  'How to answer:',
  '- Recommend from their stash first. Refer to a link ONLY as [#id] in square brackets, for example [#42].',
  '  The interface turns exactly that pattern into a tappable, clickable link — anything else renders as dead text.',
  '  Correct: [#42]. Wrong: **#42**, #42 on its own, **#42 ToolName**, or the tool name with no id at all.',
  '  Never wrap a citation in markdown bold. Never paste raw URLs.',
  '  Write the id immediately after naming the tool, e.g. "tea-leaf-scroll-world [#68] handles this with...".',
  '- CITE ONLY IDS FROM "FULL DETAIL ON THE MOST RELEVANT ONES" BELOW. That list is short on purpose — the app only',
  '  knows the URL for those few, so an [#id] for anything else (even one you can see in the plain index list above',
  '  it) has nothing to link to and breaks. If the right answer is not in the detailed set, say what you have from',
  '  the index by name with NO [#id] attached, rather than inventing a citation for it.',
  '- Do not use markdown bold (**text**) anywhere in the answer. Plain sentences only — it is not rendered and shows as literal asterisks.',
  '- Lead with the recommendation, then one line on why it fits. No preamble, no restating the question.',
  '- The detailed set is small (five entries) precisely so you recommend a handful of real options, not a wall of them.',
  '  Compare honestly when a few fit: say what separates them, including price and whether it is open source.',
  '',
  'Being truthful about what is there:',
  '- The index is complete. If nothing in it fits, say so plainly rather than stretching an unrelated link to fit.',
  '- Only then you may name well-known tools that are NOT saved, clearly marked, for example "not in your stash yet: Figma". Never give these an [#id], because they do not have one.',
  '- Never invent a link, a fact, a star count or a price. Everything you assert about a saved link must come from the detail given.',
  '- If a link only has a title and no summary, say it has not been enriched yet rather than guessing what it does.',
  '',
  'Projects:',
  '- Some links are filed under a project. If they name one, prefer links filed there, and say when you are reaching outside it.',
  '- A link marked BROKEN LINK failed a health check. Do not recommend it without saying so.',
  '',
  'They think in problems, not product names. "Something for onboarding" should surface the onboarding tool even if the word never appears in its description.',
  'Be brief and concrete. Plain sentences.',
].join('\n');
