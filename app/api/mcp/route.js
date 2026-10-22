import { NextResponse } from 'next/server';
import { db, shape } from '@/lib/supabase';
import { embed } from '@/lib/embed';
import { enrichLink } from '@/lib/enrich';
import { normalizeUrl } from '@/lib/util';
import { inferSource, CATEGORIES, STAGES, stageFor, stageLabel, SECTIONS, STYLES, EFFECTS } from '@/lib/taxonomy';
import { buildContext, SYSTEM } from '@/lib/context';
import { chatJSON } from '@/lib/llm';
import { createAudit, advance, loadAudit } from '@/lib/audit/run';
import { designBrief } from '@/lib/design';
import { importCodeFindings } from '@/lib/audit/codefindings';
import { backlinkPlan } from '@/lib/audit/backlinks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Stash as an MCP server, so any agent - Claude in a project, Claude Code,
// anything else that speaks MCP - can consult the tools you have curated
// instead of guessing from the whole internet.
//
// Transport is JSON-RPC 2.0 over a single POST endpoint, which is what a
// remote MCP connector expects.
//
// On access: writing is off unless STASH_TOKEN is set. An open endpoint that
// only reads a list of public tool links is a small thing; an open endpoint
// that lets anyone write into your library is not. Rather than making you
// configure a secret before anything works, the server degrades to read-only
// on its own and tells you so in its capabilities.

const PROTOCOL = '2025-06-18';
const SERVER = { name: 'stash', title: 'Stash', version: '2.5.0' };

/* ------------------------------------------------------------- resources */

// Tools are for asking questions. Resources are for handing a client
// something to attach as context, which is a different job: "put Clerk's
// entry in front of the model" should not require a tool call and a round
// trip through search.

async function listResources() {
  const { data } = await db
    .from('links')
    .select('id,title,domain,summary,type,category')
    .order('created_at', { ascending: false })
    .limit(300);

  const links = (data || []).map((l) => ({
    uri: 'stash://link/' + l.id,
    name: l.title || l.domain,
    title: l.title || l.domain,
    description: [l.type, l.category, l.summary].filter(Boolean).join(' — ').slice(0, 200),
    mimeType: 'application/json',
  }));

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
  return {
    resourceTemplates: [
      {
        uriTemplate: 'stash://link/{id}',
        name: 'saved-tool',
        title: 'One saved tool',
        description: 'Full record for a single tool, including install, quickstart and repo signals.',
        mimeType: 'application/json',
      },
      {
        uriTemplate: 'stash://collection/{name}',
        name: 'project-collection',
        title: 'Everything filed under one project',
        description: 'All tools filed under a given project name.',
        mimeType: 'application/json',
      },
    ],
  };
}

async function readResource(uri) {
  if (uri === 'stash://index') {
    const ctx = await buildContext('');
    return {
      contents: [{ uri, mimeType: 'text/markdown', text: ctx.text }],
    };
  }

  const link = uri.match(/^stash:\/\/link\/(\d+)$/);
  if (link) {
    const { data } = await db.from('links').select('*').eq('id', Number(link[1])).maybeSingle();
    if (!data) throw new Error('No saved tool at ' + uri);
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(render(data), null, 2) }],
    };
  }

  const coll = uri.match(/^stash:\/\/collection\/(.+)$/);
  if (coll) {
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
    name: 'design_site',
    title: 'Design a whole website from my library',
    description: 'Pick the best premium components for every section of a site, in one coherent style.',
    arguments: [
      { name: 'brief', description: 'What the site is for, who it is for, and the feeling wanted.', required: true },
      { name: 'stack', description: 'Stack in use, comma separated.', required: false },
    ],
  },
  {
    name: 'design_hero',
    title: 'Design a hero section from my library',
    description: 'Pick the best premium hero for a brief, with alternates and install steps.',
    arguments: [{ name: 'brief', description: 'What the site is for and the feeling wanted.', required: true }],
  },
  {
    name: 'whats_rotting',
    title: 'What needs attention',
    description: 'Surface broken links, archived repos and anything that never enriched.',
    arguments: [],
  },
];

async function designBriefTool(args) {
  const { build_brief, ...rest } = await designBrief(args || {});
  return { build_brief, ...rest };
}

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
    design_site:
      'Design a website: ' + (args.brief || '') + '\n' +
      'Call design_brief first' + (args.stack ? ' with stack ' + args.stack : '') + ' and build from the picks it returns, ' +
      'in its direction and following its rules. Call how_to_use on each pick before writing integration code. ' +
      'Show me the preview images of what you chose and why.',
    design_hero:
      'Design a hero section: ' + (args.brief || '') + '\n' +
      'Call design_brief with sections ["hero"], show me the top pick and alternates with their preview images, ' +
      'then build the one I choose (default to the top pick).',
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
  } else if (name === 'language' || name === 'collection' || name === 'works_with') {
    const { data } = await db.rpc('stash_facets');
    const key = name === 'language' ? 'languages' : name === 'collection' ? 'collections' : 'tags';
    values = ((data || {})[key] || []).map((x) => x.name);
  }

  const hits = values.filter((v) => String(v).toLowerCase().includes(typed)).slice(0, 100);
  return { completion: { values: hits, total: hits.length, hasMore: false } };
}

const token = () => process.env.STASH_TOKEN || null;

function authorised(req) {
  const want = token();
  if (!want) return { ok: true, canWrite: false };

  const header = req.headers.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const given = bearer || req.nextUrl.searchParams.get('token');

  if (given && given === want) return { ok: true, canWrite: true };
  return { ok: false, canWrite: false };
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
    name: 'backlink_plan',
    title: 'Backlink plan for an audited site',
    description:
      'A white-hat plan for earning backlinks to a site that has been audited: profiles to claim, ranked link channels for its industry, ' +
      'the exact Google searches that find real prospects, one-page asset ideas, outreach templates and what to avoid. ' +
      'Use when the user asks how to get backlinks, rank higher on Google or be found for a client\'s business. ' +
      'Pass the audit id from audit_site; add city so the searches are local.',
    inputSchema: {
      type: 'object',
      properties: {
        audit_id: { type: 'number', description: 'The Stash audit id.' },
        city: { type: 'string', description: 'City or area the business serves.' },
        industry: { type: 'string', description: 'Optional override: real-estate, hospitality, health, professional, saas, ecommerce, education, local, agency, nonprofit.' },
      },
      required: ['audit_id'],
    },
  },
  {
    name: 'design_brief',
    title: 'Design brief: the best components for the site being built',
    description:
      'CALL THIS FIRST whenever the user asks you to design or build a website, landing page, hero, ' +
      'section or UI ("design me a hero", "build a site for a real estate agency", "make this look premium"). ' +
      'Describe what is being built and for whom. It reads the brief, then returns for each section the ' +
      'best-looking component from the user\'s own curated library, ranked on design quality, style fit, ' +
      'industry fit and motion budget, checked so the picks look like one site. Also returns a style guide ' +
      '(type, colour, spacing, motion), install commands, inspiration references and rules against generic ' +
      'AI-looking output. Build from the picks rather than from your own defaults.',
    inputSchema: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'What is being built, for whom, and the feeling wanted. E.g. "premium plots and villas website for a Hyderabad real estate developer".' },
        sections: { type: 'array', items: { type: 'string' }, description: 'Optional: sections to cover, e.g. ["hero","pricing"]. Omit to let Stash decide (one section for "a hero", a full page for "a website").' },
        style: { type: 'string', description: 'Optional visual style override: minimal, editorial, brutalist, playful, luxury, corporate, futuristic-tech, glassmorphism, retro, organic, bold-colorful, dark-mode.' },
        stack: { type: 'array', items: { type: 'string' }, description: 'Optional: the stack in use, e.g. ["react","tailwind","nextjs"]. Picks that support it rank higher.' },
        premium: { type: 'number', description: 'Optional 0-1: how premium the result must feel. Defaults to reading the brief.' },
      },
      required: ['brief'],
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
    name: 'audit_site',
    title: 'Audit a client website',
    creates: true,
    description:
      'Point Stash at a live website (usually a client site the user is building or redesigning). It ' +
      'splits the page into sections, scores each for problems (weak headline, no clear CTA, wall of ' +
      'text, flat visuals, generic copy, missing proof, static feel), and writes 2-3 concrete redesign ' +
      'directions for the weakest sections, each built on tools from the user\'s own library, with a ' +
      'ready-to-paste build prompt. Call this whenever the user shares a site URL and wants it improved, ' +
      'reviewed or redesigned. A full audit takes 1-3 minutes: if it is not finished when this returns, ' +
      'call get_audit with the id to continue it.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The page to audit, e.g. https://client.com' },
        client: { type: 'string', description: 'Optional client or project name, used to file the tools they pick.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_audit',
    title: 'Continue or read an audit',
    creates: true,
    description:
      'Continues an unfinished audit (each call does up to ~45 seconds of work) and returns its current ' +
      'state: sections, scores, problems and redesign directions. Call repeatedly until status is "done".',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Audit id from audit_site.' } },
      required: ['id'],
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
    name: 'add_code_findings',
    title: 'Attach a code security review to an audit',
    description:
      "Attach the findings.json produced by Cloudflare's security-audit skill (run on the client's source code) to a Stash audit. " +
      'Confirmed findings appear with severity, unproven leads as "needs validation", and the fix plan is re-ranked. ' +
      'Use after running the security-audit skill on the project the audit is about.',
    inputSchema: {
      type: 'object',
      properties: {
        audit_id: { type: 'number', description: 'The Stash audit id.' },
        findings: { type: 'array', items: { type: 'object' }, description: 'The records from findings.json.' },
      },
      required: ['audit_id', 'findings'],
    },
  },
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

  if (l.note) out.user_note = l.note;
  if (l.collections?.length) out.projects = l.collections;
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
  if (!data) throw new Error('No saved tool with id ' + id);
  const l = shape(data);

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
    rows = data || [];
  } else if (args.query) {
    const q = String(args.query);
    const q_embedding = await embed(q);
    const { data } = await db.rpc('search_links', {
      q, q_embedding,
      f_category: null, f_pricing: null, f_source: null, f_kind: null,
      f_status: null, f_tags: null, f_oss: false, f_starred: false,
      f_collection: null, f_dead: false, f_works_with: null, f_type: null,
      f_language: null, f_min_stars: null, f_maintained: false, f_used_only: false,
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
    used_before: (l.used_in || []).length ? l.used_in : null,
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

  const { data: link } = await db.from('links').select('*').eq('id', id).maybeSingle();
  if (!link) throw new Error('No saved tool with id ' + id);

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

  const context = await buildContext(question);
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
  if (!data) throw new Error('No saved tool with id ' + id);
  return render(data);
}

async function listCategories() {
  const { data, error } = await db.rpc('stash_facets');
  if (error) throw new Error(error.message);

  const f = data || {};
  return {
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

const APP_URL = 'https://stash-cyatra.vercel.app';

/** Compact, agent-friendly view of an audit. */
function renderAudit(a) {
  const tools = a.tools || {};
  return {
    id: a.id,
    status: a.status,
    progress: a.step_detail || undefined,
    error: a.error || undefined,
    url: a.url,
    client: a.client || undefined,
    view: APP_URL + '/audit/' + a.id,
    site: a.site ? { framework: a.site.framework, fonts: a.site.fonts, colours: a.site.colours } : undefined,
    health: a.summary?.health,
    page_judgement: a.site?.judgement || undefined,
    area_scores: a.summary?.site_scores || undefined,
    how_it_is_served: a.site?.network || undefined,
    visual_read: a.site?.visual && !a.site.visual.skipped ? a.site.visual : undefined,
    pages_analysed: (a.site?.pages || []).length > 1 ? a.site.pages.map((p) => ({ path: p.home ? '/' : p.path, status: p.status, title: p.title, sections: p.sections, issues: p.issues })) : undefined,
    ai_visibility: a.site?.ai ? { score: a.site.ai.score, parts: a.site.ai.parts, bots: (a.site.ai.bots || []).map((b) => ({ name: b.name, role: b.role, robots: b.robots, reachable: b.reachable })), scrapers: a.site.ai.scrapers, llms_txt: a.site.ai.llms_txt, schema_types: a.site.ai.schema_types, sample_questions: a.site.ai.prompts || undefined } : undefined,
    real_visitors_and_safety: a.site?.google && !a.site.google.skipped ? a.site.google : undefined,
    since_last_audit: a.compare || undefined,
    client_approval: a.plan?.approvals || undefined,
    fix_progress: a.plan?.status && Object.keys(a.plan.status).length ? a.plan.status : undefined,
    competitors: (a.plan?.competitors || []).length ? a.plan.competitors.map((c) => ({ host: c.host, scores: c.scores, facts: c.facts, error: c.error })) : undefined,
    needs_human_check: a.summary?.uncertain_sections?.length ? a.summary.uncertain_sections : undefined,
    lighthouse_mobile: a.psi?.scores || (a.psi?.skipped ? 'not measured: ' + a.psi.skipped : undefined),
    core_web_vitals: a.psi?.vitals ? Object.fromEntries(Object.entries(a.psi.vitals).map(([k, v]) => [k, v.value])) : undefined,
    overview: a.plan?.overview || undefined,
    client_summary: a.plan?.client_summary || undefined,
    fix_first: (a.plan?.items || []).slice(0, 12).map((i) => ({
      tier: i.tier, area: i.category, issue: i.title, why: i.why, fix: i.fix, effort: i.effort, impact: i.impact, wcag: i.wcag || undefined,
    })),
    client_report: a.status === 'done' ? APP_URL + '/audit/' + a.id + '/report' : undefined,
    page_basics: a.summary?.basics,
    sections: (a.sections || []).map((s) => ({
      position: s.position + 1,
      page: s.signals?.page_path || undefined,
      type: s.type,
      heading: s.heading,
      needs_work: s.needs_work != null ? Number(s.needs_work) : undefined,
      problems: s.issues?.length ? s.issues : undefined,
      verdict: s.status === 'skipped' ? 'solid' : s.status === 'designed' ? 'redesign' : s.status,
      diagnosis: s.suggestion?.diagnosis || undefined,
      better_headline: s.suggestion?.copy?.headline || undefined,
      best_visual_references: (s.suggestion?.visuals || []).length
        ? s.suggestion.visuals.filter((v) => tools[v.tool_id]).map((v) => ({ name: tools[v.tool_id].title, url: tools[v.tool_id].url, match: v.label, why: v.why, borrow: v.borrow || undefined }))
        : undefined,
      directions: (s.suggestion?.directions || []).map((d) => ({
        title: d.title,
        idea: d.idea,
        effort: d.effort,
        jev_check: d.checks || undefined,
        visual_match: (s.suggestion?.visuals || []).find((v) => (d.tool_ids || []).includes(v.tool_id)) || undefined,
        warning: d.flag || undefined,
        tools: (d.tool_ids || []).map((id) => tools[id]).filter(Boolean)
          .map((t) => ({ id: t.id, name: t.title, url: t.url, preview_image: t.image || undefined, format: t.usage_format })),
        build_prompt: d.prompt,
      })),
    })),
    show_the_user:
      a.status === 'done'
        ? 'Lead with the overview and the "fix_first" list (tier "now" first), then the weakest sections with their diagnosis and directions (tools, previews, build prompt). Offer the client_report link for sharing with the client. Full report: ' + APP_URL + '/audit/' + a.id
        : 'Still running. Tell the user it is in progress and call get_audit with id ' + a.id + ' again.',
  };
}

async function auditSite(args) {
  const url = String(args.url || '').trim();
  if (!url) throw new Error('url is required');
  const id = await createAudit(url, args.client);
  await advance(id, 48000);
  return renderAudit(await loadAudit(id));
}

async function getAudit(args) {
  const id = Number(args.id);
  if (!Number.isFinite(id)) throw new Error('id must be a number');
  await advance(id, 48000);
  const a = await loadAudit(id);
  if (!a) throw new Error('No audit with id ' + id);
  return renderAudit(a);
}

async function callTool(name, args, canWrite) {
  switch (name) {
    case 'audit_site': return auditSite(args);
    case 'get_audit': return getAudit(args);
    case 'search_tools': return searchTools(args);
    case 'get_tool': return getTool(args);
    case 'list_categories': return listCategories();
    case 'how_to_use': return howToUse(args);
    case 'build_stack': return buildStack(args);
    case 'review_project': return reviewProject(args);
    case 'compare_tools': return compareTools(args);
    case 'find_inspiration': return findInspiration(args);
    case 'design_brief': return designBriefTool(args);
    case 'backlink_plan': {
      const a = await loadAudit(Number(args.audit_id), { withTools: false });
      if (!a) throw new Error('No audit ' + args.audit_id);
      return backlinkPlan(a, { city: args.city, industry: args.industry });
    }
    case 'ask_stash': return askStash(args);
    case 'mark_used':
      // Writes, but only ever adds provenance to a row that already exists.
      // Gating this behind the token would mean the library never learns,
      // which defeats the point.
      return markUsed(args);
    case 'add_code_findings':
      if (!canWrite) throw new Error('Writes are disabled. Connect with STASH_TOKEN.');
      return importCodeFindings(args.audit_id, args.findings);
    case 'save_tool':
      if (!canWrite) {
        throw new Error(
          'Saving is disabled. Set STASH_TOKEN in the Stash deployment and connect with that token to enable writes.'
        );
      }
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
          "Stash is this user's own curated library of tools, repos and links. They collected every entry",
          'deliberately, so it is a far better starting point than a fresh search of the open internet.',
          'They run an AI-based website/web-app building service for clients, so most saved tools exist',
          'to be reused across client builds — treat this as their go-to toolkit for that work, not a',
          'general bookmark pile.',
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
          '0. FIRST of all: when the user asks you to design or build a website, landing page, hero or any',
          '   section or UI, or to make something look premium or good — call design_brief BEFORE writing',
          '   any markup. It chooses the best-looking components from their library for the site being',
          '   built, in one coherent style, with a style guide and rules against generic AI-looking output.',
          '   Build from its picks; do not substitute your own defaults.',
          '8. When the user shares a website URL (a client site, their own site, a competitor) and wants',
          '   it reviewed, improved or redesigned — call audit_site. It returns section-by-section problems',
          '   and redesign directions built on their saved tools. If status is not "done", call get_audit',
          '   with the id until it is; tell the user it is running rather than waiting silently.',
          '',
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
          'When a tool is genuinely wired into a project, call mark_used. It files the tool under that',
          'project and lifts it in future results. This is how the library learns which tools survive real',
          'work, and it only happens if you record it — the user will not.',
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
      const withHints = ({ creates, ...t }, write) => ({
        ...t,
        annotations: {
          title: t.title,
          readOnlyHint: !write && !creates,
          destructiveHint: false,
          idempotentHint: !creates,
          // audit_site reads a site on the open web; everything else is the library.
          openWorldHint: !!creates,
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
        const result = await callTool(name, params?.arguments || {}, auth.canWrite);
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
        return ok(id, await readResource(params?.uri));
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

export async function POST(req) {
  const auth = authorised(req);
  if (!auth.ok) {
    return NextResponse.json(fail(null, -32001, 'Unauthorised'), { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(fail(null, -32700, 'Parse error'), { status: 400 });
  }

  // A client may batch several calls into one array.
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handle(m, auth)))).filter(Boolean);
    return replies.length ? NextResponse.json(replies) : new Response(null, { status: 202 });
  }

  const reply = await handle(body, auth);
  return reply ? NextResponse.json(reply) : new Response(null, { status: 202 });
}

/** Plain GET is a health check, so you can eyeball it in a browser. */
export async function GET(req) {
  const origin = req?.nextUrl?.origin || 'https://stash-cyatra.vercel.app';
  const url = origin + '/api/mcp';

  return NextResponse.json({
    server: SERVER,
    protocol: PROTOCOL,
    transport: 'streamable-http (JSON-RPC over POST)',
    write_enabled: !!token(),
    capabilities: ['tools', 'resources', 'prompts', 'completions'],
    tools: (token() ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS).map((t) => t.name),
    prompts: PROMPTS.map((p) => p.name),
    resources: ['stash://index', 'stash://link/{id}', 'stash://collection/{name}'],
    hint: token()
      ? 'Connect with Authorization: Bearer <STASH_TOKEN>'
      : 'Read-only. Set STASH_TOKEN in Vercel to enable save_tool.',
    // Copy-paste config for the common clients, so connecting is not a
    // documentation exercise.
    connect: {
      claude: 'Settings, Connectors, Add custom connector, then paste: ' + url,
      cursor: { mcpServers: { stash: { url } } },
      claude_code: 'claude mcp add --transport http stash ' + url,
    },
  });
}
