// Project templates and folder presets. Safe to import from client components
// (no database here).
//
// A project is split into folders the way the work itself splits: a website
// into frontend, backend, design and content; an agent into its framework,
// models, memory and tools. Each preset carries the search that fills it, so
// a new "Backend" folder opens with backend tools already suggested, and the
// tone it is drawn in on the project map.
//
// Folder kinds are stable keys. Renaming a folder keeps its kind, so its
// suggestions and colour stay put.

export const TONES = {
  amber: '#e0a95b',
  sage: '#9cc29a',
  sky: '#8fb3d9',
  lilac: '#b7a3d9',
  coral: '#e58c7a',
  sand: '#d6c48f',
  teal: '#7fc4b8',
  rose: '#d99ab3',
};
const TONE_KEYS = Object.keys(TONES);

export const PRESETS = {
  // Building software
  frontend: { name: 'Frontend', tone: 'amber', hint: 'Components, styling, motion and the framework the interface is built in.', query: 'frontend UI components react styling animation' },
  backend: { name: 'Backend', tone: 'sky', hint: 'Databases, APIs, server logic and background jobs.', query: 'backend database API server' },
  design: { name: 'UI/UX design', tone: 'lilac', hint: 'Design systems, inspiration, type, colour and icons.', query: 'UI UX design system inspiration typography icons' },
  auth: { name: 'Auth & payments', tone: 'coral', hint: 'Sign-in, accounts, subscriptions and checkout.', query: 'authentication login payments billing subscriptions' },
  content: { name: 'Content & SEO', tone: 'sand', hint: 'Copy, images, docs and getting found.', query: 'content writing SEO images docs' },
  ship: { name: 'Ship & test', tone: 'teal', hint: 'Hosting, CI, testing, monitoring and security.', query: 'deployment hosting testing monitoring security' },
  ai: { name: 'AI features', tone: 'rose', hint: 'Chat, copilots, RAG and model APIs inside the product.', query: 'AI chatbot LLM API RAG copilot' },
  // Mobile
  mobile_ui: { name: 'Mobile UI', tone: 'amber', hint: 'Native and cross-platform components, navigation and gestures.', query: 'mobile app UI react native components' },
  app_logic: { name: 'App logic & data', tone: 'sky', hint: 'State, offline storage and sync.', query: 'mobile state management offline storage sync' },
  notifications: { name: 'Notifications', tone: 'sand', hint: 'Push, email and in-app messages.', query: 'push notifications email messaging' },
  release: { name: 'Release & testing', tone: 'teal', hint: 'Builds, store release, crash reports and tests.', query: 'mobile release testing crash reporting CI' },
  // Agents
  agent_framework: { name: 'Agent framework', tone: 'rose', hint: 'Frameworks and SDKs the agent is built on.', query: 'AI agent framework SDK' },
  models: { name: 'Models & prompts', tone: 'amber', hint: 'Model APIs, prompting and structured output.', query: 'LLM API models prompting' },
  memory: { name: 'Retrieval & memory', tone: 'sky', hint: 'Vector stores, embeddings and RAG.', query: 'vector database embeddings RAG retrieval' },
  tools: { name: 'Tools & MCP servers', tone: 'lilac', hint: 'MCP servers, skills and integrations the agent can call.', query: 'MCP server agent skills tools integrations' },
  evals: { name: 'Evals & monitoring', tone: 'teal', hint: 'Evaluations, tracing and observability.', query: 'LLM evals tracing observability' },
  // Content and marketing
  writing: { name: 'Writing & copy', tone: 'sand', hint: 'Copywriting, editing and brand voice.', query: 'copywriting writing editing' },
  visuals: { name: 'Visual design', tone: 'lilac', hint: 'Image generation, editing and graphics.', query: 'image generation editing graphic design' },
  video: { name: 'Video & audio', tone: 'coral', hint: 'Video editing, voiceover, music and screen recording.', query: 'video editing voice audio screen recording' },
  distribution: { name: 'Distribution', tone: 'amber', hint: 'Social, email and growth.', query: 'social media marketing email growth' },
  analytics: { name: 'Analytics', tone: 'teal', hint: 'Tracking, dashboards and experiments.', query: 'analytics tracking dashboards' },
  // Automation
  integrations: { name: 'Triggers & integrations', tone: 'sky', hint: 'Webhooks, APIs and the apps a workflow connects.', query: 'workflow automation integrations webhooks' },
  agents: { name: 'Agents & skills', tone: 'rose', hint: 'Agents and skills that do steps of the work.', query: 'AI agents skills automation' },
  extraction: { name: 'Data extraction', tone: 'sand', hint: 'Scraping, parsing and OCR.', query: 'web scraping data extraction parsing' },
  // Data and research
  storage: { name: 'Storage & databases', tone: 'sky', hint: 'Where the data lives.', query: 'database storage data warehouse' },
  analysis: { name: 'Analysis', tone: 'amber', hint: 'Notebooks, querying and statistics.', query: 'data analysis notebooks python' },
  dataviz: { name: 'Visualisation', tone: 'lilac', hint: 'Charts, maps and dashboards.', query: 'charts data visualization dashboards maps' },
  datasets: { name: 'Datasets & sources', tone: 'sage', hint: 'Open datasets and APIs to draw from.', query: 'datasets open data APIs' },
  // Design systems
  tokens: { name: 'Tokens & colour', tone: 'amber', hint: 'Colour, spacing and theme tokens.', query: 'design tokens color palette theme' },
  type: { name: 'Typography', tone: 'sand', hint: 'Fonts and type scales.', query: 'fonts typography' },
  components: { name: 'Components', tone: 'sky', hint: 'Component libraries and primitives.', query: 'UI component library primitives' },
  icons: { name: 'Icons & illustration', tone: 'sage', hint: 'Icon sets and illustration.', query: 'icons illustrations' },
  motion: { name: 'Motion', tone: 'rose', hint: 'Animation libraries and interaction effects.', query: 'animation motion scroll effects' },
  // Anything else
  research: { name: 'Research', tone: 'sage', hint: 'References and reading worth keeping to hand.', query: 'learning reference guides' },
  custom: { name: 'Folder', tone: null, hint: 'Your own folder. Suggestions follow its name.', query: null },
};

export const TEMPLATES = [
  {
    key: 'web-app',
    label: 'Website or web app',
    blurb: 'Marketing sites, SaaS products and dashboards.',
    folders: ['frontend', 'backend', 'design', 'auth', 'content', 'ship'],
  },
  {
    key: 'mobile-app',
    label: 'Mobile app',
    blurb: 'iOS, Android and cross-platform apps.',
    folders: ['mobile_ui', 'app_logic', 'backend', 'notifications', 'release'],
  },
  {
    key: 'ai-agent',
    label: 'AI agent or LLM app',
    blurb: 'Agents, copilots and anything built on a model.',
    folders: ['agent_framework', 'models', 'memory', 'tools', 'evals'],
  },
  {
    key: 'content',
    label: 'Content & marketing',
    blurb: 'Campaigns, launch videos, social and newsletters.',
    folders: ['writing', 'visuals', 'video', 'distribution', 'analytics'],
  },
  {
    key: 'automation',
    label: 'Automation & workflows',
    blurb: 'Jobs that run themselves, from scrapers to agents.',
    folders: ['integrations', 'agents', 'extraction', 'notifications', 'evals'],
  },
  {
    key: 'data',
    label: 'Data & research',
    blurb: 'Collecting, analysing and presenting data.',
    folders: ['extraction', 'storage', 'analysis', 'dataviz', 'datasets'],
  },
  {
    key: 'design-system',
    label: 'Design system',
    blurb: 'Tokens, type, components, icons and motion.',
    folders: ['tokens', 'type', 'components', 'icons', 'motion'],
  },
  {
    key: 'blank',
    label: 'Start empty',
    blurb: 'Add your own folders as you go.',
    folders: [],
  },
];

/** Quick picks offered when adding a folder by hand. */
export const QUICK_FOLDERS = ['frontend', 'backend', 'design', 'auth', 'content', 'ship', 'ai', 'tools', 'motion', 'analytics', 'research'];

export const templateOf = (key) => TEMPLATES.find((t) => t.key === key) || TEMPLATES[TEMPLATES.length - 1];
export const presetOf = (kind) => PRESETS[kind] || PRESETS.custom;
export const isKind = (kind) => Object.prototype.hasOwnProperty.call(PRESETS, kind);

/** A stable colour for a folder: its preset's, or one picked from its id. */
export function toneOf(folder) {
  const preset = PRESETS[folder?.kind];
  if (preset?.tone) return TONES[preset.tone];
  let h = 0;
  for (const ch of String(folder?.id || folder?.name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[TONE_KEYS[h % TONE_KEYS.length]];
}

/** What to search for when suggesting skills for a folder. */
export const queryOf = (folder) => presetOf(folder?.kind).query || folder?.name || '';
export const hintOf = (folder) => (folder?.kind && folder.kind !== 'custom' ? presetOf(folder.kind).hint : null);

/** The preset a typed folder name matches ("backend" -> backend), or custom. */
export function kindForName(name) {
  const n = String(name || '').trim().toLowerCase();
  for (const [key, p] of Object.entries(PRESETS)) if (key !== 'custom' && p.name.toLowerCase() === n) return key;
  return 'custom';
}

export const LIMITS = { projects: 30, folders: 12, items: 150, perFolder: 40 };
