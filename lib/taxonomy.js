// Use-case-first taxonomy. You search by "what job does this do", not by
// "what technology is it", so the categories are jobs.
//
// This list is a *strong suggestion* to the model, not a hard constraint --
// if something genuinely doesn't fit, the model may invent a new category and
// it will show up in your sidebar automatically. Edit this list freely; it is
// read at request time, so a server restart picks up changes.

export const CATEGORIES = [
  // Interface & design
  'UI Components & Elements',
  'Onboarding & Product Tours',
  'Icons & Illustrations',
  'Fonts & Typography',
  'Color & Design Systems',
  'Animation & Motion',
  'Landing Pages & Templates',
  'Design Inspiration',
  'Charts & Data Viz',

  // Media
  'Screenshots & Screen Recording',
  'Image Generation & Editing',
  'Video Generation & Editing',
  'Audio, Voice & Music',
  '3D & Graphics',

  // AI
  'AI Agents & Frameworks',
  'LLM APIs & Models',
  'AI Coding Tools',
  'Vector DBs & RAG',
  'Prompting & Evals',

  // Engineering
  'Databases & Backend',
  'Auth & Identity',
  'Payments & Billing',
  'APIs & Integrations',
  'Deployment & Hosting',
  'DevTools & CLI',
  'Testing & Monitoring',
  'Security & Privacy',
  'Scraping & Data Extraction',
  'Automation & Workflows',

  // Product & growth
  'Analytics & Tracking',
  'Email & Notifications',
  'Marketing & Growth',
  'No-code & Builders',
  'Docs & Knowledge Bases',
  'Productivity & Notes',
  'Maps & Geo',

  // Fallbacks
  'Learning & Reference',
  'Datasets & APIs',
  'Other',
];

export const PRICING = ['free', 'freemium', 'paid', 'open-source', 'unknown'];

// The section-aware axis: which part of a website a tool helps you build or
// improve. This is what lets Stash answer "what do I have for a weak pricing
// section" — and later, what the site audit matches each detected section
// against. Kept as fixed lists so the model's output can be validated rather
// than trusted.
export const SECTIONS = [
  'navbar', 'hero', 'features', 'how-it-works', 'product-showcase', 'logos',
  'testimonials', 'stats', 'pricing', 'faq', 'cta', 'contact', 'footer',
  'about-team', 'gallery-portfolio', 'blog-content', 'forms-signup',
  'dashboard-ui', 'background', 'page-transitions', 'cursor-interactions',
  'loaders', 'whole-page',
];

export const EFFECTS = [
  'scroll-animation', '3d-webgl', 'micro-interaction', 'hover-effect',
  'page-transition', 'text-animation', 'typography', 'layout-grid',
  'color-palette', 'imagery-illustration', 'iconography', 'video-media',
  'background-effect', 'cursor-effect', 'data-viz', 'copywriting',
];

export const STYLES = [
  'minimal', 'editorial', 'brutalist', 'playful', 'luxury', 'corporate',
  'futuristic-tech', 'glassmorphism', 'retro', 'organic', 'bold-colorful',
  'dark-mode',
];

export const USAGE_FORMATS = [
  'copy-paste-component', 'ai-prompt', 'npm-library', 'template', 'gallery',
  'tutorial', 'design-asset', 'saas-tool', 'not-web-design',
];

// A second, coarser axis over the same categories: which phase of building a
// client website or web app this tool belongs to. Categories already say
// "what job does this do" — this says "when in a build do I reach for it",
// which is how a freelancer/agency actually walks a project: gather
// references, design the interface, wire up the backend, add auth/payments,
// fill it with content, ship it, then keep clients happy. No new data is
// needed for this: every link already has a category, so every link gets a
// stage for free the moment it's saved.
export const STAGES = [
  {
    key: 'design',
    label: 'Design & Inspiration',
    hint: 'What the client project should look and feel like, before code.',
    categories: [
      'Design Inspiration', 'UI Components & Elements', 'Onboarding & Product Tours',
      'Icons & Illustrations', 'Fonts & Typography', 'Color & Design Systems',
      'Animation & Motion', 'Landing Pages & Templates', 'Charts & Data Viz', '3D & Graphics',
    ],
  },
  {
    key: 'ai-features',
    label: 'AI Features',
    hint: 'Chatbots, copilots, and generative features to build into a site.',
    categories: [
      'AI Agents & Frameworks', 'LLM APIs & Models', 'AI Coding Tools',
      'Vector DBs & RAG', 'Prompting & Evals',
    ],
  },
  {
    key: 'backend-data',
    label: 'Backend & Data',
    hint: 'Where the client’s data lives and how the frontend talks to it.',
    categories: [
      'Databases & Backend', 'APIs & Integrations', 'Automation & Workflows',
      'Scraping & Data Extraction', 'Maps & Geo',
    ],
  },
  {
    key: 'auth-payments',
    label: 'Auth & Payments',
    hint: 'Logins, accounts, and taking money on a client’s site.',
    categories: ['Auth & Identity', 'Payments & Billing'],
  },
  {
    key: 'content-media',
    label: 'Content & Media',
    hint: 'Images, video, audio, and docs that go into the finished site.',
    categories: [
      'Image Generation & Editing', 'Video Generation & Editing', 'Audio, Voice & Music',
      'Screenshots & Screen Recording', 'Docs & Knowledge Bases',
    ],
  },
  {
    key: 'ship-operate',
    label: 'Ship & Operate',
    hint: 'Getting a client site live and keeping it healthy after launch.',
    categories: [
      'Deployment & Hosting', 'DevTools & CLI', 'Testing & Monitoring', 'Security & Privacy',
    ],
  },
  {
    key: 'growth-client-ops',
    label: 'Growth & Client Ops',
    hint: 'Analytics, marketing, and running the service side of client work.',
    categories: [
      'Analytics & Tracking', 'Email & Notifications', 'Marketing & Growth',
      'No-code & Builders', 'Productivity & Notes',
    ],
  },
  {
    key: 'reference',
    label: 'Reference',
    hint: 'Background reading and things that don’t fit a build phase yet.',
    categories: ['Learning & Reference', 'Datasets & APIs', 'Other'],
  },
];

const STAGE_BY_CATEGORY = new Map();
for (const s of STAGES) for (const c of s.categories) STAGE_BY_CATEGORY.set(c, s.key);

export function stageFor(category) {
  return STAGE_BY_CATEGORY.get(category) || 'reference';
}

export function stageLabel(key) {
  return STAGES.find((s) => s.key === key)?.label || 'Reference';
}

export function inferSource(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (h === 'x.com' || h.endsWith('twitter.com')) return 'twitter';
    if (h.endsWith('reddit.com')) return 'reddit';
    if (h.endsWith('instagram.com')) return 'instagram';
    if (h.endsWith('github.com') || h.endsWith('gitlab.com')) return 'github';
    if (h.endsWith('ycombinator.com')) return 'hackernews';
    if (h.endsWith('producthunt.com')) return 'producthunt';
    if (h.endsWith('youtube.com') || h === 'youtu.be') return 'youtube';
    if (h.endsWith('linkedin.com')) return 'linkedin';
    return 'web';
  } catch {
    return 'web';
  }
}
