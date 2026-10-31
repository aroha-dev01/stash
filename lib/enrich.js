import { db } from './supabase.js';
import { scrapeMeta, fetchRepo, resolveSocialLink } from './scrape.js';
import { chatJSON, llmStatus } from './llm.js';
import { embed, embeddingText } from './embed.js';
import { CATEGORIES, PRICING } from './taxonomy.js';
import { faviconFor, normalizeUrl, fetchTimeout } from './util.js';
import { tagSections } from './sections.js';

const CAT_LIST = () => CATEGORIES.map((c) => '  - ' + c).join('\n');

const SYSTEM_TEXT = [
  "You catalogue software tools for a developer's personal reference library.",
  '',
  'This library is read by AI coding agents mid-build, through an MCP connector. So the',
  'entry has to answer two questions, and the second one is the one that gets skipped:',
  'what IS this, and HOW would I actually put it to work right now?',
  '',
  'Return strict JSON:',
  '{',
  '  "name": "short product or repo name, no tagline, no company suffix",',
  '  "summary": "one sentence, max 20 words, plain English. No marketing adjectives.",',
  '  "helps_with": "one sentence on how this helps someone building something. Concrete.",',
  '  "category": "single best-fit category",',
  '  "tags": ["4-8 lowercase-hyphenated tags: name the job, not vague words"],',
  '  "use_cases": ["2-4 concrete situations you would reach for this"],',
  '  "pricing": "free | freemium | paid | open-source | unknown",',
  '  "is_open_source": true or false,',
  '',
  '  "install": "the exact command, e.g. npm i @clerk/nextjs, or brew install kap. null if not installable",',
  '  "quickstart": "the shortest real path from install to working. 1-4 short lines, code where it helps. null if unknown",',
  '  "works_with": ["frameworks, languages, platforms: nextjs, react, python, macos, tailwind"],',
  '  "requires": ["hard prerequisites: api key, account, node >=18, paid plan for X"],',
  '  "limits": "free tier caps or rate limits, only if actually stated. null otherwise",',
  '  "avoid_when": "one sentence: when this is the WRONG choice. null if you genuinely cannot tell",',
  '  "maturity": "active | experimental | archived | unknown",',
  '',
  '  "type": "library | saas | cli | app | reference | template | mcp-server | dataset | article | other",',
  '  "role": "the ONE job it does in a stack, 1-3 lowercase words: auth, transactional email, ui animation",',
  '  "integration_effort": "drop-in | moderate | heavy | none",',
  '  "commercial_ok": "yes | no | check-license | unknown"',
  '}',
  '',
  'Rules:',
  '- Prefer a category from this list; only invent one if nothing fits:',
  '%CATEGORIES%',
  '- pricing is open-source only when the project itself is freely licensed. An open core with a paid cloud is freemium.',
  '- Tags name the job (screenshot, onboarding-tour, auth), never tool, software, awesome.',
  '- If the page is an article or thread ABOUT a tool, catalogue the tool it points to and add the tag article.',
  '',
  'On install and quickstart:',
  '- Take these from the README or page text when they are there. READMEs almost always',
  '  show the install line in the first few hundred characters.',
  '- Do NOT construct a plausible-looking command from the repo name. If the text does not',
  '  show how to install it, return null. A wrong command wastes more time than a missing one.',
  '',
    'On type, which decides whether an agent may treat this as a dependency:',
  '- library: you install it and import it. saas: you sign up and call an API.',
  '- cli: a command line tool. app: something a human opens and uses.',
  '- reference: a gallery, showcase, docs site or curated list. You LOOK at it, you do not install it.',
  '- template: a starter you copy. mcp-server: connects to an AI agent. article: a post or thread.',
  '- Be strict. A beautiful gallery of animation examples is reference, never library, even when it shows code.',
  '- integration_effort is "none" for reference and article, since there is nothing to integrate.',
  '',
  'On avoid_when and limits, which are the easiest fields to get wrong:',
  '- A product page rarely states its own downsides, so you will be tempted to invent them.',
  '- Only state a limit that appears in the text. Never estimate a free tier.',
  '- avoid_when should come from real constraints you can see: platform (macOS only), framework',
  '  (React only), scale, or price model. If nothing in the text supports one, return null.',
  '- null is a correct and useful answer. A confident guess here misleads an agent into',
  '  ruling out a good tool, or recommending one that cannot work.',
].join('\n');

function applyAi(patch, ai) {
  if (ai?.name) patch.title = String(ai.name).slice(0, 120);
  if (ai?.summary) patch.summary = String(ai.summary).slice(0, 300);
  if (ai?.category) patch.category = String(ai.category).slice(0, 60);
  if (ai?.pricing !== undefined) patch.pricing = PRICING.includes(ai.pricing) ? ai.pricing : 'unknown';
  if (ai?.is_open_source !== undefined) patch.is_open_source = !!ai.is_open_source;

  // "How does it help" is stored at the front of use_cases so it survives
  // without a schema migration, and reads naturally in the detail panel.
  const cases = Array.isArray(ai?.use_cases) ? ai.use_cases.slice(0, 4).map(String) : [];
  patch.use_cases = ai?.helps_with ? [String(ai.helps_with), ...cases].slice(0, 5) : cases;

  // Usage fields. Empty strings are normalised to null so "unknown" is
  // unambiguous downstream: an agent must be able to tell "no install step"
  // from "we failed to find one".
  patch.install    = str(ai?.install, 200);
  patch.quickstart = str(ai?.quickstart, 800);
  patch.limits     = str(ai?.limits, 300);
  patch.avoid_when = str(ai?.avoid_when, 300);

  patch.works_with = list(ai?.works_with, 10);
  patch.requires   = list(ai?.requires, 6);

  patch.maturity = pick(ai?.maturity, MATURITY, 'unknown');
  patch.type = pick(ai?.type, TYPES, 'other');
  patch.integration_effort = pick(ai?.integration_effort, EFFORT, 'unknown');
  patch.commercial_ok = pick(ai?.commercial_ok, COMMERCIAL, 'unknown');
  patch.role = str(ai?.role, 60)?.toLowerCase() ?? null;

  // Nothing to integrate means nothing to install, whatever the model said.
  if (patch.type === 'reference' || patch.type === 'article') {
    patch.integration_effort = 'none';
    patch.install = null;
  }

  patch.enriched_v = 2;
}

const MATURITY   = ['active', 'experimental', 'archived', 'stale', 'unknown'];
const TYPES      = ['library', 'saas', 'cli', 'app', 'reference', 'template', 'mcp-server', 'dataset', 'article', 'other'];
const EFFORT     = ['drop-in', 'moderate', 'heavy', 'none', 'unknown'];
const COMMERCIAL = ['yes', 'no', 'check-license', 'unknown'];

/** Constrain a model's free text to a known label, rather than trusting it. */
function pick(v, allowed, fallback) {
  const s = String(v ?? '').trim().toLowerCase();
  return allowed.includes(s) ? s : fallback;
}

/** Trim, cap, and treat the model's various ways of saying nothing as null. */
function str(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || /^(null|none|n\/a|unknown|not specified)$/i.test(s)) return null;
  return s.slice(0, max);
}

function list(v, max) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, max);
}

/**
 * Checks that an npm install command names a package that actually exists.
 *
 * Told not to invent commands, the model still produced `npm install themicro`
 * for a repo called themicro that was never published. That is the worst kind
 * of wrong: it looks right, and the agent only finds out at install time.
 * The registry answers this in one cheap request, so guessing is unnecessary.
 *
 * Only npm is verified. Homebrew and pip would each need their own lookup, and
 * npm covers the overwhelming majority of what gets saved here.
 */
async function verifyInstall(command) {
  if (!command) return { ok: true, command };

  const m = String(command).match(/\b(?:npm\s+i(?:nstall)?|yarn\s+add|pnpm\s+(?:i|add)|bun\s+(?:i|install|add))\s+(?:-[\w-]+\s+)*(@?[\w./-]+)/i);
  if (!m) return { ok: true, command }; // brew, pip, go get: not checked

  const pkg = m[1].replace(/@[\d^~].*$/, ''); // drop a trailing version range
  try {
    const res = await fetchTimeout('https://registry.npmjs.org/' + pkg.replace('/', '%2F'), {}, 6000);
    if (res.status === 404) return { ok: false, command: null, reason: 'npm package "' + pkg + '" does not exist' };
    return { ok: true, command };
  } catch {
    // Registry unreachable: keep the command rather than delete a good one.
    return { ok: true, command };
  }
}

const cleanTags = (tags) =>
  [...new Set((tags || []).map((t) => String(t).trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 12);

export async function enrichLink(id) {
  const { data: link } = await db.from('links').select('*').eq('id', id).maybeSingle();
  if (!link) return { ok: false, reason: 'not found' };

  await db.from('links').update({ status: 'enriching', error: null }).eq('id', id);

  const patch = {};
  const warnings = [];
  const url = link.url;

  let meta = { title: null, description: null, image: null, favicon: null, site_name: null, text: '' };
  try {
    meta = await scrapeMeta(url);
  } catch (e) {
    warnings.push(e.message);
    meta.favicon = faviconFor(url);
  }

  // If this is a post about a tool, follow it to the tool and catalogue that
  // instead, keeping the post as provenance. Only when the row is not already
  // pointing somewhere real, so re-enrichment never rewrites a resolved link.
  if (!link.source_url) {
    try {
      const resolved = await resolveSocialLink(url, meta.text, meta.description);
      if (resolved) {
        const { data: clash } = await db
          .from('links')
          .select('id')
          .eq('norm_url', normalizeUrl(resolved))
          .maybeSingle();

        if (clash && clash.id !== id) {
          // The real tool is already saved. This row is the duplicate.
          await db.from('links').update({
            status: 'error',
            error: 'Duplicate: this post points at #' + clash.id + ', which is already saved.',
            source_url: url,
          }).eq('id', id);
          return { ok: true, id, duplicate_of: clash.id };
        }

        const norm = normalizeUrl(resolved);
        patch.source_url = url;
        patch.url = norm;
        patch.norm_url = norm;
        patch.domain = new URL(norm).hostname;

        // Re-scrape against the real page: the tweet's metadata describes the
        // post, not the product.
        try {
          const better = await scrapeMeta(norm);
          if (better.title) meta = better;
        } catch {
          // Keep the tweet's metadata rather than nothing.
        }
      }
    } catch (e) {
      warnings.push('Could not resolve the linked tool: ' + e.message);
    }
  }

  patch.title = meta.title || link.title || link.domain;
  patch.description = meta.description || null;
  patch.favicon = meta.favicon || faviconFor(url);
  patch.site_name = meta.site_name || null;
  patch.image = meta.image || null;

  const repo = await fetchRepo(url);
  if (repo) {
    Object.assign(patch, {
      repo_owner: repo.repo_owner,
      repo_name: repo.repo_name,
      repo_stars: repo.repo_stars,
      repo_forks: repo.repo_forks,
      repo_open_issues: repo.repo_open_issues,
      repo_open_prs: repo.repo_open_prs,
      repo_language: repo.repo_language,
      repo_license: repo.repo_license,
      repo_pushed_at: repo.repo_pushed_at,
    });
    if (!patch.description && repo.description) patch.description = repo.description;
    if (!patch.title || patch.title === link.domain) patch.title = repo.repo_owner + '/' + repo.repo_name;
  }

  let tags = repo?.topics?.slice(0, 6) ?? [];

  const status = llmStatus();
  if (status.enabled) {
    const parts = [
      'URL: ' + url,
      meta.title && 'Page title: ' + meta.title,
      meta.site_name && 'Site: ' + meta.site_name,
      meta.description && 'Meta description: ' + meta.description,
    ];
    if (repo) {
      parts.push(
        'GitHub repo: ' + repo.repo_owner + '/' + repo.repo_name,
        repo.description && 'Repo description: ' + repo.description,
        repo.repo_language && 'Primary language: ' + repo.repo_language,
        repo.repo_license ? 'License: ' + repo.repo_license : 'License: none declared',
        repo.repo_stars != null && 'Stars: ' + repo.repo_stars,
        repo.topics?.length && 'Topics: ' + repo.topics.join(', '),
        repo.archived && 'NOTE: this repository is archived.',
        repo.readme && 'README excerpt: ' + repo.readme.slice(0, 2000)
      );
    } else if (meta.text) {
      parts.push('Page text excerpt: ' + meta.text.slice(0, 2000));
    }

    try {
      const ai = await chatJSON(SYSTEM_TEXT.replace('%CATEGORIES%', CAT_LIST()), parts.filter(Boolean).join('\n'));
      applyAi(patch, ai);
      if (Array.isArray(ai?.tags) && ai.tags.length) tags = ai.tags;
    } catch (e) {
      warnings.push('AI enrichment failed: ' + e.message);
    }
  } else {
    warnings.push('AI off (' + status.reason + ')');
  }

  // Maturity from the repo itself rather than the model's impression of the
  // README. GitHub knows whether a project is archived and when it was last
  // touched; a language model is only guessing from tone.
  if (repo) {
    if (repo.archived) {
      patch.maturity = 'archived';
    } else if (repo.repo_pushed_at) {
      const months = (Date.now() - new Date(repo.repo_pushed_at).getTime()) / 2.628e9;
      patch.maturity = months <= 9 ? 'active' : 'stale';
    }
  }

  // A fabricated install command costs more than a missing one, so it is
  // checked against the registry before being stored.
  if (patch.install) {
    const verified = await verifyInstall(patch.install);
    if (!verified.ok) {
      patch.install = null;
      warnings.push(verified.reason);
    }
  }

  if (!patch.category) patch.category = repo ? 'DevTools & CLI' : 'Other';

  patch.tags = cleanTags(tags);
  patch.status = 'ready';
  patch.error = warnings.length ? warnings.join(' - ') : null;

  await db.from('links').update(patch).eq('id', id);

  // Embedding last, from the finished row, so it reflects the real content.
  const { data: fresh } = await db.from('links').select('*').eq('id', id).maybeSingle();
  if (fresh) {
    const vec = await embed(embeddingText(fresh));
    if (vec) await db.from('links').update({ embedding: vec }).eq('id', id);

    // Section tags come from the finished summary, so they run after it.
    // Best effort: a link without section tags is still a good link, and the
    // backfill endpoint will pick it up later.
    try {
      await tagSections(fresh);
    } catch {
      /* retried by /api/backfill/sections */
    }
  }

  return { ok: true, id };
}
