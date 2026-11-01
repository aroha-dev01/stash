import Link from 'next/link';
import { getViewer } from '@/lib/auth';
import { policyFor } from '@/lib/access';
import { browse, overview, demoSearch } from '@/lib/browse';
import { connectionOf } from '@/lib/mcpkeys';
import { TYPE_LABELS } from '@/lib/labels';
import { PRO } from '@/lib/plans';
import SiteHeader from './_ui/SiteHeader';
import SiteFooter from './_ui/SiteFooter';
import EntryCard from './_ui/EntryCard';
import CodeBox from './_ui/CodeBox';
import TrackedLink from './_ui/TrackedLink';
import { ArrowIcon, LockIcon, SparkIcon } from './_ui/icons';
import { PLACEHOLDER_KEY } from './_ui/agents';
import AgentProvider from './_landing/AgentProvider';
import AgentOrbit from './_landing/AgentOrbit';
import McpScrollDemo from './_landing/McpScrollDemo';
import AgentEcosystem from './_landing/AgentEcosystem';
import CategoryArt from './_landing/CategoryArt';
import ConnectButton from './_landing/ConnectButton';
import ConnectPrompt from './_landing/ConnectPrompt';
import Peeker from './_landing/Peeker';
import './landing.css';

export const dynamic = 'force-dynamic';

// What the demo's agent asks Stash. It has to be answerable from the visitor
// sample, since the demo only ever shows entries anyone can open.
const DEMO_QUERY = 'build a polished landing page';
// The three toolkits the brief leads with come first; the bento gives them the most room.
const TILE_ORDER = ['ui-ux', 'content', 'automation', 'development', 'research'];
const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://stash.aruo.dev';

/** What a toolkit tile says about access, true for whoever is looking. */
function accessLine(t, level) {
  if (t.needs) return 'Unlock with ' + PRO.name;
  const shut = t.count - t.open;
  if (!shut) return level === 'visitor' ? 'All public' : 'All open to you';
  return level === 'visitor' ? t.open + ' public, ' + shut + ' for members' : t.open + ' open to you, ' + shut + ' with ' + PRO.name;
}

/** Each block degrades on its own: a failed query hides its section, never the page. */
const settle = (p, fallback) => p.catch(() => fallback);

async function load(viewer) {
  const policy = await policyFor(viewer);
  const [counts, featured, recent, demo, connection] = await Promise.all([
    settle(overview(policy), null),
    settle(browse(policy, { featured: true, limit: 11 }), { items: [] }),
    settle(browse(policy, { sort: 'newest', limit: 14 }), { items: [] }),
    settle(demoSearch(DEMO_QUERY, 3), []),
    viewer ? settle(connectionOf(viewer.id), null) : null,
  ]);
  const featuredIds = new Set(featured.items.map((i) => i.id));
  return {
    level: policy.level,
    counts,
    featured: featured.items,
    recent: recent.items.filter((i) => !featuredIds.has(i.id)).slice(0, 8),
    picks: demo.map((d) => ({ ...d, kind: TYPE_LABELS[d.type] || 'Tool' })),
    connected: !!connection?.connected,
  };
}

export default async function Home() {
  const viewer = await getViewer().catch(() => null);
  const { level, counts, featured, recent, picks, connected } = await load(viewer);
  const signedIn = !!viewer;
  const lead = featured.slice(0, 3);
  const rest = featured.slice(3);

  return (
    <div className='k k-home'>
      <SiteHeader current='home' />
      <main id='main'>
        <AgentProvider>
          {/* ------------------------------------------------ hero */}
          <section className='k-hero' aria-labelledby='hero-h'>
            <div className='k-hero-glow' aria-hidden='true' />
            <div className='k-wrap k-hero-grid'>
              <div className='k-hero-copy'>
                <span className='k-eyebrow'>Discovery for coding agents</span>
                <h1 id='hero-h' className='k-h1'>
                  Find the right tools for what you&apos;re <em className='k-hl'>building.</em>
                </h1>
                <p className='k-lede'>
                  Stash connects your AI coding agent to a curated library of skills, plugins, MCP servers and developer
                  tools. Describe your task. Discover what fits. Build with confidence.
                </p>
                <div className='k-hero-cta'>
                  <TrackedLink className='k-btn k-btn-primary k-btn-lg' href='/explore' event='hero_primary_cta_click'>Explore Stash</TrackedLink>
                  <a className='k-btn k-btn-lg' href='#how-it-works'>See how it works</a>
                </div>
                <p className='k-hero-note'>
                  Works with Claude Code, Cursor, GitHub Copilot and compatible MCP clients.
                  {counts ? <> <span className='k-hero-count'>{counts.total} hand-picked entries.</span></> : null}
                </p>
              </div>
              <AgentOrbit picks={picks.map((p) => ({ id: p.id, title: p.title, kind: p.kind }))} />
            </div>
          </section>

          {/* ------------------------------------------------ demo */}
          <McpScrollDemo picks={picks} query={DEMO_QUERY} />

          {/* ------------------------------------------------ agents */}
          <AgentEcosystem />

          {/* ------------------------------------------------ featured */}
          {featured.length || recent.length ? (
            <section className='k-section k-feat' id='featured' aria-labelledby='feat-h'>
              <div className='k-wrap'>
                <div className='k-section-head-row'>
                  <div className='k-section-head'>
                    <span className='k-eyebrow'>{featured.length ? 'Featured by the curator' : 'From the catalogue'}</span>
                    <h2 id='feat-h' className='k-h2'>A better starting point for your next build.</h2>
                    <p className='k-lede'>Explore useful skills, plugins and tools selected from the Stash catalogue.</p>
                  </div>
                  <Link className='k-arrow' href='/explore'>Explore all skills and plugins <ArrowIcon /></Link>
                </div>

                {lead.length ? (
                  <div className='k-feat-lead'>
                    <Peeker agent='cursor' />
                    {lead.map((item, i) => <EntryCard key={item.id} item={item} size='lg' eager={i === 0} />)}
                  </div>
                ) : null}
                {rest.length ? (
                  <div className='k-grid k-feat-rest'>
                    {rest.map((item) => <EntryCard key={item.id} item={item} />)}
                  </div>
                ) : null}

                {recent.length ? (
                  <div className='k-feat-recent'>
                    <div className='k-ex-label'>
                      <h3 className='k-h3'>Recently added</h3>
                      <Link className='k-arrow k-small' href='/explore?sort=newest'>See everything new <ArrowIcon size={14} /></Link>
                    </div>
                    <div className='k-ex-feature-row'>
                      {recent.map((item) => <EntryCard key={item.id} item={item} size='sm' />)}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* ------------------------------------------------ categories */}
          {counts ? (
            <section className='k-section k-cats' id='categories' aria-labelledby='cats-h'>
              <div className='k-wrap'>
                <div className='k-section-head'>
                  <span className='k-eyebrow'>Categories</span>
                  <h2 id='cats-h' className='k-h2'>Explore by what you&apos;re trying to do.</h2>
                  <p className='k-lede'>Five toolkits, filed by the job a tool does. Filter by kind, from MCP servers to templates, once you are inside.</p>
                </div>
                <div className='k-cat-grid'>
                  {[...counts.toolkits].sort((a, b) => TILE_ORDER.indexOf(a.key) - TILE_ORDER.indexOf(b.key)).map((t) => (
                    <Link
                      key={t.key}
                      href={t.needs ? '/upgrade?toolkit=' + t.key : '/explore?toolkit=' + t.key}
                      className={'k-cat k-cat-' + t.key + (t.needs ? ' k-cat-locked' : '')}
                      aria-label={t.label + (t.needs ? ', ' + PRO.name + ' only' : '') + ', ' + t.count + ' entries'}
                    >
                      <span className='k-cat-art'><CategoryArt toolkit={t.key} /></span>
                      <span className='k-cat-body'>
                        <span className='k-cat-top'>
                          <b>{t.label}</b>
                          {t.premium ? <span className='k-access k-access-premium'>{t.needs ? <LockIcon size={12} /> : <SparkIcon />}{PRO.name}</span> : null}
                        </span>
                        <span className='k-cat-blurb'>{t.needs ? t.pitch : t.blurb}</span>
                        <span className='k-cat-foot'>
                          <span>{t.count} entries</span>
                          <span>{accessLine(t, level)}</span>
                          <ArrowIcon />
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {/* ------------------------------------------------ connect */}
          <section className='k-section k-cta' aria-labelledby='cta-h'>
            <div className='k-wrap'>
              <div className='k-cta-card'>
                <div className='k-cta-copy'>
                  <span className='k-eyebrow'>Connect</span>
                  <h2 id='cta-h' className='k-h2'>Your agent is one connection away.</h2>
                  <p className='k-lede'>Connect Stash to your coding agent and discover tools directly from your workflow.</p>
                  <div className='k-hero-cta'>
                    <ConnectButton signedIn={signedIn} connected={connected} from='cta' className='k-btn k-btn-accent k-btn-lg' />
                    <Link className='k-btn k-btn-lg' href='/connect'>See setup instructions</Link>
                  </div>
                  <p className='k-small k-dim' style={{ margin: 0 }}>Free with a Google sign-in. Your key is yours to revoke at any time.</p>
                </div>
                <div className='k-cta-code' aria-label='Example: the Claude Code setup command'>
                  <span className='k-eyebrow'>Claude Code, one command</span>
                  <CodeBox text={'claude mcp add --transport http stash ' + SITE + '/api/mcp \\\n  --header "Authorization: Bearer ' + PLACEHOLDER_KEY + '"'} />
                  <span className='k-small k-dim'>Cursor, VS Code, Claude and Windsurf each get their own exact config in the guide.</span>
                </div>
              </div>
            </div>
          </section>

          <ConnectPrompt signedIn={signedIn} connected={connected} />
        </AgentProvider>
      </main>
      <SiteFooter />
    </div>
  );
}
