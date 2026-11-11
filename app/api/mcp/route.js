import { AsyncLocalStorage } from 'node:async_hooks';
import { NextResponse } from 'next/server';
import { db, shape } from '@/lib/supabase';
import { embed } from '@/lib/embed';
import { enrichLink } from '@/lib/enrich';
import { normalizeUrl } from '@/lib/util';
import { inferSource, CATEGORIES, STAGES, stageFor, stageLabel, SECTIONS, STYLES, EFFECTS } from '@/lib/taxonomy';
import { buildContext, SYSTEM } from '@/lib/context';
import { chatJSON } from '@/lib/llm';
import { resolveKey, noteClient } from '@/lib/mcpkeys';
import { policyFor, rpcAccess, canOpen } from '@/lib/access';
import { PRO, proLine } from '@/lib/plans';
import { waitFor } from '@/lib/guard';
import { originOf } from '@/lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Stash as an MCP server, so any agent - Claude, Claude Code, Cursor,
// Copilot, anything that speaks MCP - can pick tools from the curated
// catalogue instead of guessing from the whole internet.
//
// Transport is JSON-RPC 2.0 over a single POST endpoint, which is what a
// remote MCP connector expects.
//
// On access: every call carries a member's key (created on /account), sent as
// a bearer header or ?key=. The key decides the plan: members get discovery,
// Pro adds the AI tools, and only an admin (or STASH_TOKEN) can write to the
// shared catalogue or see the owner's private notes and project names.
//
// Which entries a caller may see at all is lib/access.js, the same policy as
// the website: every search passes rpcAccess(), and every lookup by id goes
// through openOr(), so a locked entry cannot be reached from an agent either.

const PROTOCOL = '2025-06-18';
const SERVER = { name: 'stash', title: 'Stash', version: '3.0.0' };
const APP_URL = 'https://stash.aruo.dev';

// Who is calling, for the length of one request. Fluid compute serves several
// requests from one instance at once, so this must never be a module global.
const caller = new AsyncLocalStorage();
const isOwner = () => !!caller.getStore()?.admin;
const policy = () => caller.getStore().policy;

/** The row, if this caller may open it. Otherwise says what it takes, and nothing about the entry. */
function openOr(row, id) {
  if (!row) throw new Error('No saved tool with id ' + id);
  if (!canOpen(row, policy())) {
    throw new Error(
      'Entry ' + id + ' is part of Stash ' + proLine() + '. Upgrade at ' + APP_URL + '/pricing to open it, ' +
      'or carry on with the entries this plan includes.'
    );
  }
  return row;
}

// AI-backed tools: each call spends a model request, so they are Pro.
const PRO_TOOLS = new Set(['build_stack', 'compare_tools', 'review_project', 'ask_stash']);

// The owner's private working notes. render() already leaves them out for
// everyone else; this is the backstop for any other path that returns rows.
// ('note' is deliberately absent: tools use it for their own messages, and
// the owner's note always travels as user_note.)
const PRIVATE_KEYS = new Set(['user_note', 'projects', 'projects_hint', 'collections', 'used_in', 'used_before', 'times_used', 'used_count', 'last_used_at']);

function scrub(value) {
  if (isOwner()) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!PRIVATE_KEYS.has(k)) out[k] = scrub(v);
    return out;
  }
  return value;
}

/* ------------------------------------------------------------- resources */

// Tools are for asking questions. Resources are for handing a client
// something to attach as context, which is a different job: "put Clerk's
// entry in front of the model" should not require a tool call and a round
// trip through search.

async function listResources() {
  // Curators list the whole library. Members list only what they saved, so
  // the resource list is never a way to copy the catalogue in one call;
  // search_tools is how an agent finds everything else.
  let query = db
    .from('links')
    .select('id,title,domain,summary,type,category,access')
    .order('created_at', { ascending: false });
  if (!isOwner()) {
    const { data: saves } = await db.from('saves').select('link_id').eq('user_id', caller.getStore()?.userId);
    query = query.in('id', (saves || []).map((s) => s.link_id).concat(-1));
  }
  const { data } = await query;

  // Filter before capping: a lock may have changed since it was saved.
  const links = (data || []).filter((l) => canOpen(l, policy())).slice(0, isOwner() ? 300 : 50).map((l) => ({
    uri: 'stash://link/' + l.id,
    name: l.title || l.domain,
    title: l.title || l.domain,
    description: [l.type, l.category, l.summary].filter(Boolean).join(' — ').slice(0, 200),
    mimeType: 'application/json',
  }));

  if (!isOwner()) return { resources: links };

  return {
    resources: [
      {
        uri: 'stash://index',
        name: 'stash-index',
        title: 'Whole library index',
        description:
          'Every saved tool in one compact list: id, name, type, category, tags. ' +
          'Attach this to give a model the shape of the library in a few thousand tokens.',
        mimeType: 'text/markdown',
      },
      ...links,
    ],
  };
}

function resourceTemplates() {
  const templates = [
    {
      uriTemplate: 'stash://link/{id}',
      name: 'saved-tool',
      title: 'One saved tool',
      description: 'Full record for a single tool, including install, quickstart and repo signals.',
      mimeType: 'application/json',
    },
  ];
  // Project collections are the owner's client work.
  if (isOwner()) {
    templates.push({
      uriTemplate: 'stash://collection/{name}',
      name: 'project-collection',
      title: 'Everything filed under one project',
      description: 'All tools filed under a given project name.',
      mimeType: 'application/json',
    });
  }
  return { resourceTemplates: templates };
}

async function readResource(uri) {
  // The whole-library index is a curator's tool, not something to hand out per key.
  if (uri === 'stash://index' && isOwner()) {
    const ctx = await buildContext('', { owner: isOwner(), policy: policy() });
    return {
      contents: [{ uri, mimeType: 'text/markdown', text: ctx.text }],
    };
  }

  const link = uri.match(/^stash:\/\/link\/(\d+)$/);
  if (link) {
    const { data } = await db.from('links').select('*').eq('id', Number(link[1])).maybeSingle();
    openOr(data, link[1]);
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(render(data), null, 2) }],
    };
  }

  const coll = uri.match(/^stash:\/\/collection\/(.+)$/);
  if (coll && isOwner()) {
    const name = decodeURIComponent(coll[1]);
    const { data } = await db
      .from('links')
      .select('*')
      .contains('collections', [name])
      .order('created_at', { ascending: false });
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ project: name, tools: (data || []).map(render) }, null, 2),
        },
      ],
    };
  }

  throw new Error('Unknown resource: ' + uri);
}

/* --------------------------------------------------------------- prompts */

// Ready-made starting points, so the useful questions are one click away
// rather than something the user has to think to phrase.

const PROMPTS = [
  {
    name: 'find_tool',
    title: 'Find a tool for a problem',
    description: 'Search the library by describing what you are trying to do.',
    arguments: [{ name: 'problem', description: 'What you are trying to build or fix.', required: true }],
  },
  {
    name: 'plan_stack',
    title: 'Plan a stack for a new project',
    description: 'Assemble a working set of saved tools for something you are starting.',
    arguments: [{ name: 'project', description: 'What you are building.', required: true }],
  },
  {
    name: 'audit_dependencies',
    title: 'Audit what I am using against my library',
    description: 'Compare the dependencies of the current project with tools already saved.',
    arguments: [{ name: 'dependencies', description: 'Paste package.json dependencies, or a list.', required: false }],
  },
  {
    name: 'improve_this_project',
    title: 'Improve this project using my library',
    description: 'Review the current project and suggest improvements from tools already saved.',
    arguments: [
      { name: 'project', description: 'What the project is.', required: true },
      { name: 'stack', description: 'What it currently uses, comma separated.', required: false },
    ],
  },
  {
    name: 'whats_rotting',
    title: 'What needs attention',
    description: 'Surface broken links, archived repos and anything that never enriched.',
    arguments: [],
  },
];

function getPrompt(name, args = {}) {
  const text = {
    find_tool:
      'Search my saved library for something that solves this: "' + (args.problem || '') + '".\n' +
      'Use search_tools. Prefer what I already saved. If nothing fits, say so plainly before ' +
      'suggesting anything from outside. Call how_to_use on your top pick so I get the real install command.',
    plan_stack:
      'I am building: ' + (args.project || '') + '\n' +
      'Use build_stack to pick tools from my library that work together, then call how_to_use on each ' +
      'so I have the install commands. Tell me which roles nothing in my library covers.',
    audit_dependencies:
      'Here is what the current project uses:\n' + (args.dependencies || '(read package.json yourself)') + '\n\n' +
      'Compare against my saved library with search_tools. Point out where I am using something I never ' +
      'saved, and where I saved a better-maintained alternative. Check repo activity, not just stars.',
    improve_this_project:
      'Project: ' + (args.project || '') + '\n' +
      (args.stack ? 'Currently uses: ' + args.stack + '\n' : 'Read the manifest to work out what it uses.\n') +
      '\nCall review_project with that, and give me the suggestions worth acting on. Be blunt: if my ' +
      'stack is already fine, say so rather than finding something to recommend.',
    whats_rotting:
      'Audit my library. Use search_tools with include_broken true to find dead links, and list_categories ' +
      'for the totals. Flag archived repos and anything unmaintained for over a year. Keep it short: ' +
      'what should I remove, and what should I replace.',
  }[name];

  if (!text) throw new Error('Unknown prompt: ' + name);

  const meta = PROMPTS.find((p) => p.name === name);
  return {
    description: meta.description,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}

/* ------------------------------------------------------------ completions */

/** Suggests real values for enum-ish arguments, from the live data. */
async function complete(ref, argument) {
  const name = argument?.name;
  const typed = String(argument?.value || '').toLowerCase();

  let values = [];
  if (name === 'category') {
    values = CATEGORIES;
  } else if (name === 'stage') {
    values = STAGES.map((s) => s.key);
  } else if (name === 'section') {
    values = SECTIONS;
  } else if (name === 'style') {
    values = STYLES;
  } else if (name === 'effect') {
    values = EFFECTS;
  } else if (name === 'type') {
    values = ['library', 'saas', 'cli', 'app', 'reference', 'template', 'mcp-server', 'dataset', 'article', 'other'];
  } else if (name === 'language' || (name === 'collection' && isOwner()) || name === 'works_with') {
    const { data } = await db.rpc('stash_facets');
    const key = name === 'language' ? 'languages' : name === 'collection' ? 'collections' : 'tags';
    values = ((data || {})[key] || []).map((x) => x.name);
  }

  const hits = values.filter((v) => String(v).toLowerCase().includes(typed)).slice(0, 100);
  return { completion: { values: hits, total: hits.length, hasMore: false } };
}

const token = () => process.env.STASH_TOKEN || null;

/**
 * The caller behind a request: a member's key from /account, or STASH_TOKEN
 * for the owner's own scripts. A bearer header is preferred; ?key= exists for
 * clients that can only take a URL (URLs end up in logs, headers do not).
 */
async function authorise(req) {
  const header = req.headers.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const p = req.nextUrl.searchParams;
  const given = bearer || p.get('key') || p.get('token');
  if (!given) return { ok: false, given: false };

  if (token() && given === token()) return { ok: true, admin: true, pro: true, canWrite: true, userId: null };

  const member = await resolveKey(given);
  if (!member) return { ok: false, given: true };
  return { ok: true, admin: member.isAdmin, pro: member.isPro, canWrite: member.isAdmin, userId: member.userId, keyId: member.keyId };
}

/* ------------------------------------------------------------------ tools */

const READ_TOOLS = [
  {
    name: 'search_tools',
    title: 'Search saved tools',
    description:
      "Search the user's personal library of saved tools, libraries, repos and links. " +
      'Searches by meaning as well as keyword, so describe the PROBLEM being solved ' +
      '("record the screen as a gif", "add login to a side project") rather than guessing product names. ' +
      'Use this before recommending any third-party tool, so the answer favours things the user already trusts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the user is trying to do, in plain language.' },
        collection: {
          type: 'string',
          description:
            'Optional project name. The user files tools under the project they are for. ' +
            'If you know which project this work belongs to, pass it to search only that set. ' +
            'Call list_categories to see the available project names.',
        },
        category: { type: 'string', description: 'Optional exact category filter. Call list_categories first.' },
        stage: {
          type: 'string',
          description:
            'Filter to one phase of a website/web-app build: design (visual references, UI kits, motion), ' +
            'ai-features (chatbots, copilots, RAG), backend-data (databases, APIs, automation), ' +
            'auth-payments (login, billing), content-media (images, video, docs), ' +
            'ship-operate (hosting, testing, security), growth-client-ops (analytics, marketing, no-code), ' +
            'or reference (background reading). Call list_categories to see counts per stage first. ' +
            'Use this to browse "what do I have for the design phase of a client site" style questions.',
        },
        section: {
          type: 'string',
          description:
            'Only tools tagged for one part of a website: navbar, hero, features, how-it-works, ' +
            'product-showcase, logos, testimonials, stats, pricing, faq, cta, contact, footer, ' +
            'about-team, gallery-portfolio, blog-content, forms-signup, dashboard-ui, background, ' +
            'page-transitions, cursor-interactions, loaders, whole-page. Use this when improving a ' +
            'specific section of a site, e.g. section "pricing" when the pricing block looks weak.',
        },
        style: {
          type: 'string',
          description:
            'Only tools suited to a visual style: minimal, editorial, brutalist, playful, luxury, ' +
            'corporate, futuristic-tech, glassmorphism, retro, organic, bold-colorful, dark-mode. ' +
            'Match the style of the site you are working on.',
        },
        effect: {
          type: 'string',
          description:
            'Only tools giving a kind of effect: scroll-animation, 3d-webgl, micro-interaction, ' +
            'hover-effect, page-transition, text-animation, typography, layout-grid, color-palette, ' +
            'imagery-illustration, iconography, video-media, background-effect, cursor-effect, data-viz, copywriting.',
        },
        type: {
          type: 'string',
          description:
            'Filter by what kind of thing it is: library, saas, cli, app, reference, template, ' +
            'mcp-server, dataset, article. Pass "library" when you need something installable, ' +
            'and avoid "reference" and "article" — those are galleries and posts, not dependencies.',
        },
        works_with: {
          type: 'string',
          description:
            'Only tools compatible with this framework, language or platform, e.g. nextjs, react, ' +
            'python, macos. Use the stack of the repo you are working in.',
        },
        language: {
          type: 'string',
          description:
            'Only GitHub repos written in this language, e.g. TypeScript, Python, Go, Rust. ' +
            'Use when the user needs something they can read, fork or contribute to in their own language.',
        },
        min_stars: {
          type: 'number',
          description: 'Only repos with at least this many stars. Useful for filtering to proven projects.',
        },
        maintained_only: {
          type: 'boolean',
          description:
            'Drop repos with no commits in over a year, and anything archived. ' +
            'Use when picking a dependency to build on rather than a reference to read.',
        },
        open_source_only: { type: 'boolean', description: 'Only return open-source projects.' },
        include_broken: {
          type: 'boolean',
          description: 'Include links a health check found unreachable. Off by default.',
        },
        limit: { type: 'number', description: 'Max results, 1-25. Defaults to 8.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_tool',
    title: 'Get one saved tool',
    description:
      'Full detail on one saved tool by id: summary, how it helps, use cases, tags, pricing, ' +
      'licence, GitHub stars and any private note the user wrote.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'The tool id from search_tools.' } },
      required: ['id'],
    },
  },
  {
    name: 'list_categories',
    title: 'List categories',
    description:
      'The shape of the library: every category with a count, plus totals, plus those categories ' +
      'grouped into website/web-app build phases (design, ai-features, backend-data, auth-payments, ' +
      'content-media, ship-operate, growth-client-ops, reference) via the `stages` field. ' +
      'Useful for orienting before searching, or answering "what kinds of things have I saved" or ' +
      '"what do I have for the design phase of a client build".',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'how_to_use',
    title: 'How to use a saved tool',
    description:
      'Everything needed to actually put one saved tool to work: the install command, a minimal ' +
      'quickstart, prerequisites, what it works with, known limits, and when it is the wrong choice. ' +
      'Call this after search_tools, BEFORE writing any integration code, so the commands come from ' +
      "the tool's own docs rather than from memory.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'The tool id from search_tools.' } },
      required: ['id'],
    },
  },
  {
    name: 'build_stack',
    title: 'Assemble a stack for a project',
    description:
      'Given what the user is building, return a small set of saved tools that fit TOGETHER, each ' +
      'with the role it plays — auth, email, motion, deployment. Use this when starting something ' +
      'new, rather than running several separate searches: it reasons over the whole library at once ' +
      'and avoids picking two tools that do the same job.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'What is being built, in plain language. Mention the framework if known.',
        },
        collection: { type: 'string', description: 'Optional project name to restrict the picks to.' },
      },
      required: ['project'],
    },
  },
  {
    name: 'compare_tools',
    title: 'Compare candidates before committing',
    description:
      'Put several saved tools side by side before choosing one. Give it ids, or a query to gather ' +
      'candidates itself. Returns a comparison across install effort, pricing, licence, maturity and ' +
      'compatibility, plus what each one is best at and what it costs you. ALWAYS use this before ' +
      'committing to one of several similar options, and show the user the comparison rather than ' +
      'announcing a winner. The choice between five design tools is theirs to make, not yours.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'Ids to compare. Two to six. Omit if passing a query instead.',
        },
        query: {
          type: 'string',
          description: 'Gather candidates for this job automatically, then compare them.',
        },
        criteria: {
          type: 'string',
          description:
            'What matters here, e.g. "must work with Next.js and be free", "needs to look premium". ' +
            'The verdict is written against this.',
        },
      },
    },
  },
  {
    name: 'review_project',
    title: 'Review a project against the library',
    description:
      'THE PROACTIVE ONE. Call this when you start work on any project, and whenever you are about to ' +
      'add a dependency or start a new feature. Give it what the project is and what it already uses, ' +
      'and it returns concrete improvements drawn from tools this user has already vetted: things they ' +
      'own that would help here, better-maintained alternatives to what they are using, and gaps worth ' +
      'filling. Cheap to call. Call it before recommending anything from the open internet.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'What the project is and what it does. A sentence or two is enough.',
        },
        stack: {
          type: 'array',
          items: { type: 'string' },
          description:
            'What it currently uses: dependency names from package.json, requirements.txt, go.mod, ' +
            'or just frameworks you can see in the repo.',
        },
        goal: {
          type: 'string',
          description: 'Optional. What you are about to do — the feature, fix or refactor at hand.',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'find_inspiration',
    title: 'Find visual inspiration',
    description:
      'Search the reference half of the library: galleries, showcases, curated lists and design ' +
      'archives. These are things to LOOK at, never to install. Use this when the user wants ideas, ' +
      'a visual direction or examples of how something is done well — not when they need a dependency. ' +
      'Returns preview images where available.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The look, feeling or pattern you are after.' },
        section: {
          type: 'string',
          description: 'Optional: only references for one part of a page, e.g. hero, pricing, footer, testimonials.',
        },
        style: {
          type: 'string',
          description: 'Optional: only references in one visual style, e.g. minimal, editorial, luxury, brutalist.',
        },
        limit: { type: 'number', description: 'Max results, 1-15. Defaults to 6.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'mark_used',
    title: 'Record that a tool was actually used',
    description:
      'Call this after a saved tool is genuinely adopted in a project — installed, wired up, shipped. ' +
      'Not when it was merely mentioned or considered. This is the only signal that separates tools ' +
      'that survived contact with real work from ones that just looked good when bookmarked, and it ' +
      'lifts them in future results. Takes a second, and compounds.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The tool id.' },
        project: { type: 'string', description: 'Which project it was used in.' },
        note: { type: 'string', description: 'Optional: how it worked out, or what it was chosen over.' },
      },
      required: ['id', 'project'],
    },
  },
  {
    name: 'ask_stash',
    title: 'Ask the library',
    description:
      "Answer a question using only this user's saved library — the same assistant as the Ask " +
      'button in the app. Use when the user asks what they already saved, what to use for a job, ' +
      'or to compare options they trust. Prefer this over guessing tools from the internet.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The problem or question in plain language, e.g. "what have I saved for MCP in Cursor".',
        },
      },
      required: ['question'],
    },
  },
];

const WRITE_TOOLS = [
  {
    name: 'save_tool',
    title: 'Save a tool',
    description:
      "Save a new link into the user's library. It is fetched, summarised, categorised and tagged " +
      'automatically. Use when you find something genuinely worth keeping. Saving the same URL twice is safe.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The link to save.' },
        note: { type: 'string', description: 'Optional note on why it is worth keeping.' },
      },
      required: ['url'],
    },
  },
];

/* ------------------------------------------------------------ tool bodies */

/**
 * One sentence on whether a repo is alive, so an agent does not have to
 * interpret raw counts. A 50k-star project last touched in 2023 is a museum
 * piece, and the star count alone will not tell you that.
 */
function repoActivity(l) {
  if (!l.repo_pushed_at) return null;

  const months = (Date.now() - new Date(l.repo_pushed_at).getTime()) / 2.628e9;
  const when =
    months < 1 ? 'updated this month'
    : months < 3 ? 'updated within 3 months'
    : months < 9 ? 'updated within 9 months'
    : months < 24 ? 'last touched over a year ago'
    : 'dormant for years';

  const prs = l.repo_open_prs;
  const contribution =
    prs == null ? null
    : prs === 0 ? 'no open pull requests'
    : prs === 1 ? '1 open pull request'
    : prs + ' open pull requests';

  const verdict = months > 24 ? 'Likely unmaintained.' : months > 9 ? 'Slowing down.' : 'Actively maintained.';
  return [when, contribution].filter(Boolean).join(', ') + '. ' + verdict;
}

function render(link) {
  const l = shape(link);
  const cases = l.use_cases || [];
  const out = {
    id: l.id,
    name: l.title,
    url: l.url,

    // Labels first: an agent should be able to judge fit before reading prose.
    // `type` in particular decides whether this is something you install at
    // all, or a gallery you merely look at.
    type: l.type || 'other',
    role: l.role || null,
    integration_effort: l.integration_effort || 'unknown',
    commercial_ok: l.commercial_ok || 'unknown',

    // A screenshot of the thing. For a design tool this decides the question
    // faster than any description, and a client that can render images should
    // show it before the user commits.
    preview_image: l.image || null,

    what_it_is: l.summary || l.description || null,
    how_it_helps: cases[0] || null,
    use_when: cases.slice(1),
    category: l.category,
    // Which phase of a client website/web-app build this fits into, e.g. a
    // build starts with Design & Inspiration, then Backend & Data, then
    // Ship & Operate. Derived from category, so every link has one for free.
    stage: stageFor(l.category),
    stage_label: stageLabel(stageFor(l.category)),
    // Which parts of a website this helps build (hero, pricing, footer...),
    // the effect it gives, the look it suits, and how you use it. This is
    // what a section-by-section site review matches against.
    sections: l.sections || [],
    effects: l.effect_kind || [],
    styles: l.style_tags || [],
    usage_format: l.usage_format || null,
    tags: l.tags,
    pricing: l.pricing,
    open_source: !!l.is_open_source,
  };

  if (out.type === 'reference' || out.type === 'article') {
    out.not_installable = 'Reference material. Read it for ideas; there is nothing to add to a project.';
  }
  // Repo signals, with a plain-language read of them. Stars alone mislead:
  // they accumulate and never decay, so an abandoned project still looks
  // healthy. Last commit and open PRs are what say whether it is alive.
  if (l.repo_owner) {
    out.github = {
      repo: l.repo_owner + '/' + l.repo_name,
      stars: l.repo_stars ?? null,
      forks: l.repo_forks ?? null,
      open_prs: l.repo_open_prs ?? null,
      open_issues: l.repo_open_issues ?? null,
      language: l.repo_language || null,
      license: l.repo_license || null,
      last_commit: l.repo_pushed_at || null,
      activity: repoActivity(l),
    };
  }
  if (l.repo_language) out.language = l.repo_language;
  if (l.repo_license) out.license = l.repo_license;
  // Usage fields, present only when actually known. An absent key reads as
  // "not recorded", which is honest; an empty string reads as a fact.
  if (l.install) out.install = l.install;
  if (l.works_with?.length) out.works_with = l.works_with;
  if (l.requires?.length) out.requires = l.requires;
  if (l.avoid_when) out.avoid_when = l.avoid_when;
  if (l.limits) out.limits = l.limits;
  if (l.maturity && l.maturity !== 'unknown') out.maturity = l.maturity;

  if (isOwner() && l.note) out.user_note = l.note;
  if (isOwner() && l.collections?.length) out.projects = l.collections;
  if (l.dead) out.warning_broken = 'A health check could not reach this link (' + (l.dead_reason || 'unreachable') + ')';
  if (l.status !== 'ready') out.warning = 'Not fully enriched yet (' + l.status + ')';
  return out;
}

async function searchTools(args) {
  const query = String(args.query || '').trim();
  const stage = STAGES.find((s) => s.key === String(args.stage || '').trim())?.key || null;
  if (!query && !stage && !args.section && !args.style && !args.effect) {
    throw new Error('query is required (or pass stage, section, style or effect to browse)');
  }

  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 25);
  const q_embedding = query ? await embed(query) : null;

  // A stage spans several categories, and the RPC only filters on one exact
  // category at a time, so when browsing by stage this over-fetches and
  // filters client-side rather than adding another round trip to the DB.
  const stageCats = stage ? STAGES.find((s) => s.key === stage).categories : null;

  const { data, error } = await db.rpc('search_links', {
    q: query || null,
    q_embedding,
    f_category: stageCats ? null : args.category || null,
    f_pricing: null,
    f_source: null,
    f_kind: null,
    f_status: null,
    f_tags: null,
    f_oss: !!args.open_source_only,
    f_starred: false,
    f_collection: args.collection || null,
    f_works_with: args.works_with || null,
    f_type: args.type || null,
    f_language: args.language || null,
    f_min_stars: args.min_stars ? Number(args.min_stars) : null,
    f_maintained: !!args.maintained_only,
    // Broken links are hidden by default; recommending a dead link is worse
    // than returning one fewer result.
    f_dead: args.include_broken ? null : false,
    f_section: args.section || null,
    f_style: args.style || null,
    f_effect: args.effect || null,
    ...rpcAccess(policy()),
    sort_by: 'newest',
    max_rows: stageCats ? Math.max(limit * 6, 60) : limit,
    skip_rows: 0,
  });
  if (error) throw new Error(error.message);

  let rows = data || [];
  if (stageCats) {
    rows = rows.filter((r) => stageCats.includes(r.category)).slice(0, limit);
  }

  const results = rows.map(render);

  return {
    query: query || undefined,
    stage: stage || undefined,
    found: results.length,
    results,
    note: results.length
      ? undefined
      : 'Nothing saved matches this. Say so plainly rather than substituting an unrelated saved tool.',
  };
}

async function howToUse(args) {
  const id = Number(args.id);
  if (!Number.isFinite(id)) throw new Error('id must be a number');

  const { data } = await db.from('links').select('*').eq('id', id).maybeSingle();
  const l = shape(openOr(data, id));

  const out = {
    id: l.id,
    name: l.title,
    url: l.url,
    what_it_is: l.summary,
    install: l.install || null,
    quickstart: l.quickstart || null,
    works_with: l.works_with || [],
    requires: l.requires || [],
    limits: l.limits || null,
    avoid_when: l.avoid_when || null,
    maturity: l.maturity || 'unknown',
    docs: l.url,
  };

  const gaps = [];
  if (!l.install) gaps.push('no install command was found in its docs');
  if (!l.quickstart) gaps.push('no quickstart was captured');
  if (l.enriched_v < 2) gaps.push('this entry predates usage capture, so those fields were never extracted');

  if (gaps.length) {
    out.note =
      'Incomplete: ' + gaps.join('; ') + '. Read ' + l.url +
      ' before writing integration code rather than inferring a command.';
  }
  if (l.dead) out.warning_broken = 'A health check could not reach this link.';
  if (l.maturity === 'archived') out.warning_archived = 'This project is archived and no longer maintained.';
  if (l.maturity === 'stale') out.warning_stale = 'No commits in over nine months.';

  return out;
}

/**
 * Picks a set of tools that work together.
 *
 * Retrieval alone returns the top N most similar things, which for "build a
 * SaaS landing page" means five animation libraries and no auth. Composition
 * is a different question, so the candidates are retrieved broadly and then a
 * model assigns roles and drops the duplicates.
 */
async function buildStack(args) {
  const project = String(args.project || '').trim();
  if (!project) throw new Error('project is required');

  const q_embedding = await embed(project);
  const { data, error } = await db.rpc('search_links', {
    q: project,
    q_embedding,
    f_category: null, f_pricing: null, f_source: null, f_kind: null,
    f_status: null, f_tags: null, f_oss: false, f_starred: false,
    f_collection: args.collection || null,
    f_dead: false,
    f_works_with: null,
    ...rpcAccess(policy()),
    sort_by: 'newest',
    max_rows: 30,
    skip_rows: 0,
  });
  if (error) throw new Error(error.message);

  const candidates = (data || []).map(shape);
  if (!candidates.length) {
    return { project, stack: [], note: 'Nothing in the library matches this project.' };
  }

  const brief = candidates
    .map((l) => {
      const bits = ['#' + l.id + ' ' + l.title, l.category, l.summary];
      if (l.works_with?.length) bits.push('works with: ' + l.works_with.join(', '));
      if (l.install) bits.push('install: ' + l.install);
      return bits.filter(Boolean).join(' | ');
    })
    .join('\n');

  const system = [
    'You assemble a working toolkit from a developer\'s own saved tools.',
    'Given a project description and candidate tools, choose the ones that fit TOGETHER.',
    'Return strict JSON:',
    '{ "stack": [ { "id": number, "role": "the job it does here", "why": "one sentence",',
    '               "runners_up": [ { "id": number, "why_not": "why this lost, in one clause" } ] } ],',
    '  "gaps": ["roles nothing saved covers"] }',
    'Rules:',
    '- 2 to 5 tools. Fewer is better than padding.',
    '- One tool per role. Never include two that do the same job.',
    '- runners_up is REQUIRED whenever other candidates could have filled the same role. List them with',
    '  an honest reason they lost. A silent choice between five similar tools is useless to the user:',
    '  they cannot tell whether you picked well or picked first. If nothing else competed, use [].',
    '- why_not must be a real trade-off, not a dismissal. "Heavier setup", "React only", "unmaintained".',
    '- Only ids from the candidate list.',
    '- Respect compatibility: do not put a macOS-only or React-only tool in a project that cannot use it.',
    '- gaps lists roles the project needs that nothing here covers. An empty list is fine, but do not invent tools to fill a gap.',
  ].join('\n');

  let picked;
  try {
    picked = await chatJSON(system, 'Project: ' + project + '\n\nCandidates:\n' + brief);
  } catch (e) {
    // Still useful without the composition step.
    return {
      project,
      stack: candidates.slice(0, 5).map((l) => ({ id: l.id, role: l.category, tool: render(l) })),
      note: 'Ranked by relevance only; the composition step failed (' + e.message + ')',
    };
  }

  const byId = new Map(candidates.map((l) => [l.id, l]));
  const stack = (picked?.stack || [])
    .map((s) => {
      const l = byId.get(Number(s.id));
      if (!l) return null; // ignore anything hallucinated

      // The tools that lost this slot, so the choice can be second-guessed.
      const runnersUp = (s.runners_up || [])
        .map((r) => {
          const alt = byId.get(Number(r.id));
          if (!alt) return null;
          return {
            id: alt.id,
            name: alt.title,
            why_not: r.why_not || null,
            preview_image: alt.image || null,
            url: alt.url,
          };
        })
        .filter(Boolean);

      return { role: s.role || l.category, why: s.why || null, tool: render(l), runners_up: runnersUp };
    })
    .filter(Boolean);

  return {
    project,
    stack,
    gaps: picked?.gaps || [],
    show_the_user:
      'Show the runners_up alongside each pick. If several tools could fill a slot, call compare_tools ' +
      'and let the user choose rather than deciding silently.',
  };
}

/**
 * Side-by-side comparison, so a choice between similar tools is visible
 * rather than silently made.
 *
 * The failure this exists to prevent: an agent finds five design libraries,
 * silently picks one, and writes the integration. The four it discarded never
 * surface, so there is no way to tell whether the pick was right or merely
 * first. Comparison hands the decision back, with the evidence attached.
 */
async function compareTools(args) {
  let rows = [];

  if (Array.isArray(args.ids) && args.ids.length) {
    const ids = args.ids.map(Number).filter(Number.isFinite).slice(0, 6);
    const { data } = await db.from('links').select('*').in('id', ids);
    // Locked ids drop out quietly; a comparison of what the caller can open is still honest.
    rows = (data || []).filter((r) => canOpen(r, policy()));
  } else if (args.query) {
    const q = String(args.query);
    const q_embedding = await embed(q);
    const { data } = await db.rpc('search_links', {
      q, q_embedding,
      f_category: null, f_pricing: null, f_source: null, f_kind: null,
      f_status: null, f_tags: null, f_oss: false, f_starred: false,
      f_collection: null, f_dead: false, f_works_with: null, f_type: null,
      f_language: null, f_min_stars: null, f_maintained: false, f_used_only: false,
      ...rpcAccess(policy()),
      sort_by: 'newest', max_rows: 5, skip_rows: 0,
    });
    rows = data || [];
  } else {
    throw new Error('Pass either ids or a query');
  }

  if (rows.length < 2) {
    return { note: 'Need at least two candidates to compare.', candidates: rows.map(render) };
  }

  const candidates = rows.map(shape);

  // The factual grid is assembled from stored data, not written by the model,
  // so the numbers in it cannot drift.
  const table = candidates.map((l) => ({
    id: l.id,
    name: l.title,
    preview_image: l.image || null,
    url: l.url,
    type: l.type || 'other',
    role: l.role || null,
    pricing: l.pricing || 'unknown',
    commercial_ok: l.commercial_ok || 'unknown',
    integration_effort: l.integration_effort || 'unknown',
    install: l.install || null,
    works_with: l.works_with || [],
    requires: l.requires || [],
    limits: l.limits || null,
    avoid_when: l.avoid_when || null,
    maturity: l.maturity || 'unknown',
    stars: l.repo_stars ?? null,
    open_prs: l.repo_open_prs ?? null,
    last_commit: l.repo_pushed_at || null,
    used_before: isOwner() && (l.used_in || []).length ? l.used_in : null,
  }));

  const system = [
    'You compare tools a developer has already saved, so they can choose between them.',
    'Return strict JSON:',
    '{ "verdict": { "id": number, "because": "one sentence" },',
    '  "each": [ { "id": number, "best_at": "what it is strongest at", "cost": "what choosing it costs you", "pick_when": "the situation where this is the right answer" } ],',
    '  "tie_breaker": "the single question the user should answer to decide" }',
    'Rules:',
    '- Every candidate gets an entry in "each". Do not skip the ones you would not pick.',
    '- "cost" must be real. Everything has one: a licence, a lock-in, effort, a stale repo, a missing feature.',
    '- Judge against the stated criteria first, then general quality.',
    '- Prefer something already used in one of their projects, and say that is why.',
    '- If two are genuinely equivalent, say so rather than manufacturing a winner.',
    '- Never invent a fact. Only what appears in the grid.',
  ].join('\n');

  let analysis;
  try {
    analysis = await chatJSON(
      system,
      (args.criteria ? 'What matters: ' + args.criteria + '\n\n' : '') +
        'Candidates:\n' + JSON.stringify(table, null, 1)
    );
  } catch (e) {
    return { comparison: table, note: 'Facts only; the analysis step failed (' + e.message + ')' };
  }

  const byId = new Map(candidates.map((l) => [l.id, l]));
  return {
    criteria: args.criteria || null,
    comparison: table,
    each: (analysis?.each || []).filter((e) => byId.has(Number(e.id))),
    verdict: analysis?.verdict || null,
    tie_breaker: analysis?.tie_breaker || null,
    show_the_user:
      'Present the comparison, not just the verdict. The user decides which trade-off they want.',
  };
}

/**
 * The proactive entry point.
 *
 * An MCP server cannot interrupt anyone — it only answers when called. So
 * "proactive" has to mean: make the agent want to call this at the moments
 * that matter, and make the answer worth the call. The trigger conditions
 * live in the tool description and the server instructions; the value lives
 * here, in returning things the user already trusts rather than a fresh
 * opinion from the open web.
 */
async function reviewProject(args) {
  const project = String(args.project || '').trim();
  if (!project) throw new Error('project is required');

  const stack = Array.isArray(args.stack) ? args.stack.map(String).slice(0, 60) : [];
  const goal = String(args.goal || '').trim();

  // Retrieve against the project, the immediate goal, and the stack itself.
  // Three angles, because what they are building, what they are about to do,
  // and what they already use surface different parts of the library.
  const queries = [project, goal, stack.slice(0, 12).join(' ')].filter((s) => s && s.length > 2);
  const seen = new Map();

  for (const q of queries) {
    const q_embedding = await embed(q);
    const { data } = await db.rpc('search_links', {
      q, q_embedding,
      f_category: null, f_pricing: null, f_source: null, f_kind: null,
      f_status: null, f_tags: null, f_oss: false, f_starred: false,
      f_collection: null, f_dead: false, f_works_with: null, f_type: null,
      f_language: null, f_min_stars: null, f_maintained: false,
      ...rpcAccess(policy()),
      sort_by: 'newest', max_rows: 14, skip_rows: 0,
    });
    for (const row of data || []) if (!seen.has(row.id)) seen.set(row.id, shape(row));
  }

  const candidates = [...seen.values()];
  if (!candidates.length) {
    return { project, suggestions: [], note: 'Nothing in the library relates to this project.' };
  }

  const brief = candidates
    .map((l) => {
      const bits = [
        '#' + l.id + ' ' + l.title,
        'type=' + (l.type || 'other'),
        l.role ? 'role=' + l.role : null,
        l.summary,
        l.works_with?.length ? 'works with: ' + l.works_with.join(', ') : null,
        l.install ? 'install: ' + l.install : null,
        l.repo_stars != null ? l.repo_stars + ' stars' : null,
        l.maturity && l.maturity !== 'unknown' ? 'maturity: ' + l.maturity : null,
        l.avoid_when ? 'avoid when: ' + l.avoid_when : null,
      ].filter(Boolean);
      return bits.join(' | ');
    })
    .join('\n');

  const system = [
    "You advise on a project using only tools this developer has already saved and vetted.",
    'Return strict JSON:',
    '{ "suggestions": [ { "id": number, "suggestion": "what to do", "why": "one sentence", "impact": "high|medium|low" } ],',
    '  "already_covered": ["things in their stack that are fine as they are"],',
    '  "gaps": ["needs this project has that nothing saved covers"] }',
    'Rules:',
    '- At most 4 suggestions. Silence beats padding: if the stack is already sensible, return fewer.',
    '- Only ids from the candidates. Never invent a tool.',
    '- Do not suggest something they already use. Check the stack list first.',
    '- Never suggest a reference or article as a dependency; those are for reading.',
    '- Respect compatibility. Do not propose a macOS-only or React-only tool to a project that cannot use it.',
    '- impact is high only when it removes real work or replaces something unmaintained.',
    '- gaps must be honest. Naming a gap they should fill elsewhere is more useful than a forced match.',
  ].join('\n');

  const user = [
    'Project: ' + project,
    goal ? 'About to work on: ' + goal : null,
    stack.length ? 'Currently uses: ' + stack.join(', ') : 'Current stack unknown.',
    '',
    'Candidates from their saved library:',
    brief,
  ].filter(Boolean).join('\n');

  let advice;
  try {
    advice = await chatJSON(system, user);
  } catch (e) {
    return {
      project,
      suggestions: candidates.slice(0, 5).map((l) => ({ tool: render(l) })),
      note: 'Relevant saved tools, unranked; the analysis step failed (' + e.message + ')',
    };
  }

  const byId = new Map(candidates.map((l) => [l.id, l]));
  const suggestions = (advice?.suggestions || [])
    .map((s) => {
      const l = byId.get(Number(s.id));
      if (!l) return null;
      return { suggestion: s.suggestion, why: s.why, impact: s.impact || 'medium', tool: render(l) };
    })
    .filter(Boolean);

  return {
    project,
    suggestions,
    already_covered: advice?.already_covered || [],
    gaps: advice?.gaps || [],
    considered: candidates.length,
  };
}

/**
 * Records that something was actually adopted, and files it under the project
 * as a side effect.
 *
 * Across 91 links this library had zero notes, zero collections and zero
 * stars — every field that asks a human to curate mid-scroll stayed empty.
 * So nothing here asks. The agent writes it while the work is happening, and
 * the library organises itself as a by-product.
 */
async function markUsed(args) {
  const id = Number(args.id);
  const project = String(args.project || '').trim();
  if (!Number.isFinite(id)) throw new Error('id must be a number');
  if (!project) throw new Error('project is required');

  const { data } = await db.from('links').select('*').eq('id', id).maybeSingle();
  const link = openOr(data, id);

  const usedIn = [...new Set([...(link.used_in || []), project])];
  const collections = [...new Set([...(link.collections || []), project])];

  const stamp = new Date().toISOString().slice(0, 10);
  const entry = stamp + ' — used in ' + project + (args.note ? ': ' + args.note : '');
  const why = link.why ? link.why + '\n' + entry : entry;

  const { data: updated, error } = await db
    .from('links')
    .update({
      used_in: usedIn,
      collections,
      used_count: (link.used_count || 0) + 1,
      last_used_at: new Date().toISOString(),
      why,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  return {
    ok: true,
    tool: updated.title,
    used_in: usedIn,
    times_used: updated.used_count,
    also_filed_under: project,
    effect: 'This tool now ranks higher in future searches, and is filed under ' + project + '.',
  };
}

async function findInspiration(args) {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('query is required');

  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 15);
  const q_embedding = await embed(query);

  // Reference and article only. Asking for inspiration should never surface
  // an npm package, and asking for a package should never surface a gallery.
  const out = [];
  for (const kind of ['reference', 'article']) {
    const { data } = await db.rpc('search_links', {
      q: query, q_embedding,
      f_category: null, f_pricing: null, f_source: null, f_kind: null,
      f_status: null, f_tags: null, f_oss: false, f_starred: false,
      f_collection: null, f_dead: false, f_works_with: null,
      f_type: kind, f_language: null, f_min_stars: null,
      f_maintained: false, f_used_only: false,
      f_section: args.section || null,
      f_style: args.style || null,
      f_effect: null,
      ...rpcAccess(policy()),
      sort_by: 'newest', max_rows: limit, skip_rows: 0,
    });
    out.push(...(data || []));
  }

  const seen = new Set();
  const results = out
    .filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
    .slice(0, limit)
    .map((l) => {
      const s = shape(l);
      return {
        id: s.id,
        name: s.title,
        url: s.url,
        preview_image: s.image || null,
        what_it_is: s.summary,
        why_look: (s.use_cases || [])[0] || null,
        sections: s.sections || [],
        styles: s.style_tags || [],
        tags: s.tags,
      };
    });

  return {
    query,
    found: results.length,
    inspiration: results,
    reminder: 'These are galleries and references. Show the previews and links; do not try to install them.',
  };
}

async function askStash(args) {
  const question = String(args.question || '').trim();
  if (!question) throw new Error('question is required');

  const context = await buildContext(question, { owner: isOwner(), policy: policy() });
  const answer = await chatJSON(
    SYSTEM + '\n\nReturn strict JSON: { "answer": "your reply", "ids": [ids you referenced] }',
    context.text + '\n\nQuestion: ' + question
  );

  return {
    question,
    answer: answer?.answer || '',
    referenced: (answer?.ids || [])
      .map((id) => context.sources.find((s) => s.id === Number(id)))
      .filter(Boolean),
    library_size: context.total,
  };
}

async function getTool(args) {
  const id = Number(args.id);
  if (!Number.isFinite(id)) throw new Error('id must be a number');

  const { data } = await db.from('links').select('*').eq('id', id).maybeSingle();
  return render(openOr(data, id));
}

async function listCategories() {
  const { data, error } = await db.rpc('stash_facets');
  if (error) throw new Error(error.message);

  const f = data || {};
  const p = policy();
  return {
    // Counts below cover the whole catalogue; searches return only what this plan opens.
    your_plan:
      p.level === 'admin' || p.level === 'premium'
        ? 'Every entry and toolkit is open to this key.'
        : 'This key opens the Free collection. Entries reserved for ' + PRO.name +
          (p.lockedToolkits.length ? ', and the ' + p.lockedToolkits.join(', ') + ' toolkits,' : '') +
          ' never appear in results. Upgrade at ' + APP_URL + '/pricing.',
    total_saved: f.stats?.total ?? 0,
    open_source: f.stats?.oss ?? 0,
    broken_links: f.stats?.dead ?? 0,
    github_repos: f.stats?.repos ?? 0,
    languages: (f.languages || []).map((l) => ({ name: l.name, count: l.count })),
    languages_hint: 'Pass one as the language argument to search_tools to get only repos in it.',
    kinds: (f.types || []).map((t) => ({ name: t.name, count: t.count })),
    kinds_hint: 'The type argument filters on these. reference and article are not installable.',
    projects: (f.collections || []).map((c) => ({ name: c.name, count: c.count })),
    projects_hint:
      'Pass one of these as the collection argument to search_tools to search only that project.',
    categories: (f.categories || []).map((c) => ({ name: c.name, count: c.count })),
    top_tags: (f.tags || []).slice(0, 30).map((t) => t.name),
    available_categories: CATEGORIES,
    // Categories grouped into the phase of a client website/web-app build
    // they belong to, so "what do I have for the design phase" doesn't
    // require knowing all 28 category names first.
    stages: STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      hint: s.hint,
      count: (f.categories || [])
        .filter((c) => s.categories.includes(c.name))
        .reduce((sum, c) => sum + c.count, 0),
    })),
    stages_hint: 'Pass a stage key as the stage argument to search_tools to browse just that build phase.',
    sections: (f.sections || []).map((x) => ({ name: x.name, count: x.count })),
    sections_hint:
      'Website sections tools are tagged for (hero, pricing, footer...). Pass one as the section ' +
      'argument to search_tools or find_inspiration to get only tools for that part of a page.',
    styles: (f.styles || []).map((x) => ({ name: x.name, count: x.count })),
    effects: (f.effects || []).map((x) => ({ name: x.name, count: x.count })),
    section_tagged: f.stats?.section_tagged ?? 0,
  };
}

async function saveTool(args) {
  let norm;
  try {
    norm = normalizeUrl(args.url);
  } catch {
    throw new Error('That does not look like a URL');
  }

  const { data: existing } = await db.from('links').select('*').eq('norm_url', norm).maybeSingle();
  if (existing) return { already_saved: true, tool: render(existing) };

  const { data, error } = await db
    .from('links')
    .insert({
      kind: 'link',
      url: norm,
      norm_url: norm,
      domain: new URL(norm).hostname,
      title: new URL(norm).hostname,
      note: args.note || null,
      source: 'mcp',
      tags: [],
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  try {
    await enrichLink(data.id);
  } catch {
    // The row survives; enrichment retries when the app next opens.
  }

  const { data: fresh } = await db.from('links').select('*').eq('id', data.id).maybeSingle();
  return { saved: true, tool: render(fresh || data) };
}

async function callTool(name, args, auth) {
  if (PRO_TOOLS.has(name) && !auth.pro) {
    throw new Error(
      name + ' is part of Stash ' + proLine() + ': AI recommendations built from the catalogue. ' +
      'Upgrade at ' + APP_URL + '/pricing. search_tools, get_tool, how_to_use and find_inspiration stay free.'
    );
  }

  switch (name) {
    case 'search_tools': return searchTools(args);
    case 'get_tool': return getTool(args);
    case 'list_categories': return listCategories();
    case 'how_to_use': return howToUse(args);
    case 'build_stack': return buildStack(args);
    case 'review_project': return reviewProject(args);
    case 'compare_tools': return compareTools(args);
    case 'find_inspiration': return findInspiration(args);
    case 'ask_stash': return askStash(args);
    case 'mark_used': {
      // The owner's provenance (project names, notes) lives on the shared row.
      // A member's adoption goes to their own My Stash instead.
      if (auth.admin) return markUsed(args);
      const id = Number(args.id);
      if (!Number.isFinite(id)) throw new Error('id must be a number');
      const { data: row } = await db.from('links').select('id,category,access').eq('id', id).maybeSingle();
      openOr(row, id);
      const { error } = await db.from('saves').upsert({ user_id: auth.userId, link_id: id }, { onConflict: 'user_id,link_id' });
      if (error) throw new Error(error.message);
      return { recorded: true, id, effect: 'Added to your saved tools on ' + APP_URL + '/explore?saved=1' };
    }
    case 'save_tool':
      if (!auth.canWrite) throw new Error('Only Stash curators can add tools to the shared catalogue.');
      return saveTool(args);
    default:
      throw new Error('Unknown tool: ' + name);
  }
}

/* --------------------------------------------------------------- JSON-RPC */

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg, auth) {
  const { id, method, params } = msg || {};

  switch (method) {
    case 'initialize':
      noteClient(auth.keyId, params?.clientInfo);
      return ok(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
          completions: {},
        },
        serverInfo: SERVER,
        instructions: [
          'Stash is a curated catalogue of developer tools, MCP servers, agent skills, libraries and',
          'references. Every entry was picked by hand and enriched with what it does, how to install it,',
          'what it works with and when to avoid it, so it is a far better starting point than a fresh',
          'search of the open internet.',
          auth.pro
            ? 'This member is on ' + PRO.name + ': every entry, plus build_stack, compare_tools, review_project and ask_stash.'
            : 'This member is on the free plan: build_stack, compare_tools, review_project and ask_stash are ' + PRO.name + ' ' +
              'and will say so. search_tools, get_tool, how_to_use, list_categories and find_inspiration are free. ' +
              'Free covers a curated collection of the catalogue; the rest is reserved for ' + PRO.name + ' and never appears in this member\'s results. If a search ' +
              'comes back thin, say the free plan covers part of the catalogue rather than implying nothing exists.',
          '',
          'CHECK STASH AT THESE MOMENTS, without being asked:',
          '1. Starting work on any project — call review_project with what it is and what it uses. It returns',
          '   improvements drawn from tools they already trust, and names the gaps nothing covers.',
          '2. About to add a dependency, or reaching for a well-known package by reflex — call search_tools',
          '   first. They may already have something better suited, or a reason they avoided the obvious pick.',
          '3. Starting a new feature or a greenfield project — call build_stack.',
          '4. Before writing integration code — call how_to_use, so install commands come from real docs.',
          '5. When they ask what to use for anything — call ask_stash.',
          '6. When they describe a new client project or ask "what do I have for [design/backend/auth/etc]"',
          '   — call search_tools with the stage argument, or list_categories to see the stages breakdown,',
          '   to browse tools by which phase of a website build they belong to.',
          '7. When working on ONE part of a page (the hero, the pricing block, the footer) — call',
          '   search_tools or find_inspiration with the section argument, plus style to match the',
          '   site\'s look. Every entry lists the sections it helps with, its effects and its styles.',
          '',
          'CHOOSING BETWEEN SIMILAR TOOLS:',
          'When several saved tools could fill the same slot, do not pick one silently. Call compare_tools',
          'and show the user the comparison — what each is best at, what it costs, and the question that',
          'settles it. They can only judge your choice if they can see what you rejected. Every pick from',
          'build_stack carries runners_up for this reason; show them.',
          'Entries include preview_image where available. For anything visual, show the image: it answers',
          'the question faster than any description.',
          '',
          'AFTER SOMETHING IS ADOPTED:',
          'When a tool is genuinely wired into a project, call mark_used. It adds the tool to the user\'s',
          'saved tools on Stash, so the ones that survived real work are easy to find again.',
          '',
          'Do not announce that you are checking; just check, and fold what you find into your answer.',
          'If the library has nothing relevant, say so in one line and carry on with your own knowledge.',
          'Never pad an answer with a saved tool that does not genuinely fit — a forced match is worse than none.',
          '',
          'Search by describing the PROBLEM, not by guessing product names.',
          '',
          'Every entry carries labels for judging fit without reading prose:',
          '- type: library and saas are usable in a build. reference and article are galleries and posts,',
          '  so read them for ideas but never install them or add them to a manifest.',
          '- role: the single job it does, so you can spot two tools competing for the same slot.',
          '- stage: which phase of a website/web-app build it belongs to (design, ai-features,',
          '  backend-data, auth-payments, content-media, ship-operate, growth-client-ops, reference).',
          '- works_with: frameworks and platforms it supports. Filter on the stack you are in.',
          '- integration_effort, commercial_ok, maturity: cost, licensing and whether it is still maintained.',
          '',
          'Call how_to_use before writing integration code, so install commands come from the docs',
          'rather than from memory. Call build_stack when starting something new, instead of several',
          'separate searches: it picks tools that fit together and names the gaps nothing covers.',
          'If a field is absent it was never captured. Say so rather than filling it in.',
          auth.canWrite
            ? 'You may save genuinely useful new finds with save_tool.'
            : 'This connection is read-only.',
        ].join('\n'),
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // notifications carry no reply

    case 'ping':
      return ok(id, {});

    case 'tools/list': {
      // Annotations let a client decide what is safe to run unattended.
      // Everything here reads; only save_tool writes, and it is idempotent
      // because saving the same URL twice returns the existing entry.
      const withHints = (t, write) => ({
        ...t,
        description: PRO_TOOLS.has(t.name) && !auth.pro ? '[Stash ' + PRO.name + '] ' + t.description : t.description,
        annotations: {
          title: t.title,
          readOnlyHint: !write,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      });
      return ok(id, {
        tools: auth.canWrite
          ? [...READ_TOOLS.map((t) => withHints(t, false)), ...WRITE_TOOLS.map((t) => withHints(t, true))]
          : READ_TOOLS.map((t) => withHints(t, false)),
      });
    }

    case 'tools/call': {
      const name = params?.name;
      try {
        const result = scrub(await callTool(name, params?.arguments || {}, auth));
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        });
      } catch (e) {
        // A failed tool is reported inside the result, not as a protocol
        // error, so the agent can read the reason and adapt.
        return ok(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
      }
    }

    case 'resources/list':
      return ok(id, await listResources());

    case 'resources/templates/list':
      return ok(id, resourceTemplates());

    case 'resources/read':
      try {
        return ok(id, scrub(await readResource(params?.uri)));
      } catch (e) {
        return fail(id, -32002, e.message);
      }

    case 'prompts/list':
      return ok(id, { prompts: PROMPTS });

    case 'prompts/get':
      try {
        return ok(id, getPrompt(params?.name, params?.arguments || {}));
      } catch (e) {
        return fail(id, -32602, e.message);
      }

    case 'completion/complete':
      try {
        return ok(id, await complete(params?.ref, params?.argument));
      } catch {
        return ok(id, { completion: { values: [], total: 0, hasMore: false } });
      }

    default:
      return fail(id, -32601, 'Method not found: ' + method);
  }
}

/**
 * 401 with the pointer MCP clients follow to sign in (RFC 9728): Claude's
 * custom connectors read resource_metadata, find Stash's sign-in and send the
 * member there. Without it they have nowhere to go.
 */
function unauthorised(req, given) {
  const origin = originOf(req);
  const challenge =
    'Bearer realm="stash", resource_metadata="' + origin + '/.well-known/oauth-protected-resource/api/mcp"' +
    (given ? ', error="invalid_token", error_description="The Stash key is wrong or revoked"' : '');
  return NextResponse.json(
    fail(null, -32001, 'Unauthorised: sign in when your agent asks, or connect with a Stash key from ' + origin + '/connect'),
    { status: 401, headers: { 'www-authenticate': challenge } }
  );
}

export async function POST(req) {
  const auth = await authorise(req);
  if (!auth.ok) return unauthorised(req, auth.given);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(fail(null, -32700, 'Parse error'), { status: 400 });
  }

  // Members' keys share one pace per account (lib/guard.js); the owner's
  // script token does not count.
  if (auth.userId) {
    const wait = await waitFor('mcp', 'u:' + auth.userId, Array.isArray(body) ? Math.max(body.length, 1) : 1);
    if (wait) {
      return NextResponse.json(
        fail(Array.isArray(body) ? null : body?.id ?? null, -32029, 'Too many requests. Try again in ' + wait + ' seconds.'),
        { status: 429, headers: { 'retry-after': String(wait) } }
      );
    }
  }

  auth.policy = await policyFor({ isAdmin: auth.admin, isPro: auth.pro });

  return caller.run(auth, async () => {
    // A client may batch several calls into one array.
    if (Array.isArray(body)) {
      const replies = (await Promise.all(body.map((m) => handle(m, auth)))).filter(Boolean);
      return replies.length ? NextResponse.json(replies) : new Response(null, { status: 202 });
    }

    const reply = await handle(body, auth);
    return reply ? NextResponse.json(reply) : new Response(null, { status: 202 });
  });
}

/**
 * Plain GET is a health check, so you can eyeball it in a browser. A client
 * asking for an event stream gets 405: Stash answers every call in the POST
 * response, and the transport spec says to refuse the stream that way.
 */
export async function GET(req) {
  if ((req.headers.get('accept') || '').includes('text/event-stream')) {
    return new Response(null, { status: 405, headers: { allow: 'POST' } });
  }
  const origin = originOf(req);
  return NextResponse.json({
    server: SERVER,
    protocol: PROTOCOL,
    transport: 'streamable-http (JSON-RPC over POST)',
    auth: 'OAuth sign-in (' + origin + '/.well-known/oauth-protected-resource), or Authorization: Bearer <your Stash key> from ' + origin + '/connect',
    capabilities: ['tools', 'resources', 'prompts', 'completions'],
    tools: READ_TOOLS.map((t) => t.name),
    pro_tools: [...PRO_TOOLS],
    prompts: PROMPTS.map((p) => p.name),
    setup: origin + '/connect',
  });
}
