import Link from 'next/link';
import { db } from '@/lib/supabase';
import { getViewer } from '@/lib/auth';
import { TOOLKITS, toolkitFor } from '@/lib/taxonomy';
import { TYPE_LABELS } from '@/lib/catalog';
import SiteHeader from './_ui/SiteHeader';
import SiteFooter from './_ui/SiteFooter';
import AgentDemo from './_ui/AgentDemo';
import { CheckIcon } from './_ui/icons';

export const dynamic = 'force-dynamic';

// Real entries for the hero exchange, so the demo shows the catalogue as it is.
const DEMO_IDS = [187, 233, 17];

const firstClause = (s, max = 78) => {
  const t = String(s || '').split(/(?<=[.;])\s/)[0];
  if (t.length <= max) return t.replace(/[.;]$/, '');
  return t.slice(0, t.lastIndexOf(' ', max)) + '…';
};

async function load() {
  const [{ data: rows }, { data: demo }] = await Promise.all([
    db.from('links').select('category,is_premium').eq('dead', false),
    db.from('links').select('id,title,summary,type,install').in('id', DEMO_IDS),
  ]);

  const toolkits = TOOLKITS.map((t) => ({ ...t, count: 0, premium: 0 }));
  const byKey = new Map(toolkits.map((t) => [t.key, t]));
  for (const r of rows || []) {
    const t = byKey.get(toolkitFor(r.category));
    t.count += 1;
    if (r.is_premium) t.premium += 1;
  }

  const picks = DEMO_IDS.map((id) => (demo || []).find((d) => d.id === id))
    .filter(Boolean)
    .map((d) => ({ id: d.id, title: d.title, why: firstClause(d.summary), install: d.install, kind: TYPE_LABELS[d.type] || d.type }));

  return { total: (rows || []).length, toolkits, picks };
}

export default async function Home() {
  const [{ total, toolkits, picks }, viewer] = await Promise.all([load(), getViewer().catch(() => null)]);
  const connectHref = viewer ? '/account#connect' : '/login?next=' + encodeURIComponent('/account#connect');

  return (
    <div className='k'>
      <SiteHeader current='home' />

      <main>
        <section className='k-hero'>
          <div className='k-wrap k-hero-grid'>
            <div className='k-hero-copy'>
              <h1 className='k-h1'>Stop collecting tools. Start using the right ones.</h1>
              <p className='k-lede'>
                Stash is a hand-picked catalogue of {total} developer tools, MCP servers and agent skills. Connect it
                to Claude, Cursor or Copilot once, and your agent checks it before reaching for anything else.
              </p>
              <div className='k-hero-cta'>
                <Link className='k-btn k-btn-brass' href='/explore'>Browse the catalogue</Link>
                <Link className='k-btn' href={connectHref}>Connect your agent</Link>
              </div>
              <p className='k-hero-note'>Free to browse. Sign in with Google to unlock every entry and get your MCP key.</p>
            </div>
            {picks.length ? (
              <AgentDemo
                prompt='Add smooth scroll animations to my landing page.'
                query='scroll animations for a landing page'
                picks={picks}
                reply={picks[0].title + ' fits best here: it is open source and works with React. I will install it and add a reveal to the hero section.'}
              />
            ) : null}
          </div>
        </section>

        <section className='k-section'>
          <div className='k-wrap'>
            <div className='k-section-head'>
              <h2 className='k-h2'>How it works</h2>
              <p className='k-lede'>Your agent stops guessing from the open internet and starts from tools someone has already vetted.</p>
            </div>
            <ol className='k-steps'>
              <li>
                <h3 className='k-h3'>Connect once</h3>
                <p>Create a key in your account and paste one line into Claude, Claude Code, Cursor, VS Code or Windsurf.</p>
              </li>
              <li>
                <h3 className='k-h3'>Describe the task</h3>
                <p>Ask for what you are building, not for a product name. Stash searches by meaning, so a calmer onboarding flow finds the right tour library.</p>
              </li>
              <li>
                <h3 className='k-h3'>Choose, then build</h3>
                <p>You get ranked picks with install steps, what each one needs and when to skip it. Nothing is installed until you say so.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className='k-section'>
          <div className='k-wrap'>
            <div className='k-section-head'>
              <h2 className='k-h2'>Five toolkits, one catalogue</h2>
              <p className='k-lede'>
                Libraries, MCP servers, skills, apps and references, filed by the job they do. Members-only entries
                open when you sign in.
              </p>
            </div>
            <div className='k-drawers'>
              {toolkits.map((t) => (
                <Link key={t.key} className='k-drawer' href={'/explore?toolkit=' + t.key}>
                  <span className='k-drawer-name'>{t.label}</span>
                  <span className='k-drawer-blurb'>{t.blurb}</span>
                  <span className='k-drawer-count'>
                    <b>{t.count}</b>
                    {t.premium ? t.premium + ' members-only' : 'all public'}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className='k-section'>
          <div className='k-wrap k-split'>
            <div className='k-section-head' style={{ marginBottom: 0 }}>
              <h2 className='k-h2'>Works where you already work</h2>
              <p className='k-lede'>
                Stash speaks MCP, so any client that can add a remote server can use it. Your account page has the
                exact setup for each one, with your key already filled in.
              </p>
              <div><Link className='k-btn' href={connectHref}>Get your MCP key</Link></div>
            </div>
            <div className='k-clients' aria-label='Supported clients'>
              {['Claude', 'Claude Code', 'Cursor', 'VS Code with Copilot', 'Windsurf', 'Any MCP client'].map((c) => (
                <span key={c} className='k-client'>{c}</span>
              ))}
            </div>
          </div>
        </section>

        <section className='k-section'>
          <div className='k-wrap'>
            <div className='k-section-head'>
              <h2 className='k-h2'>Free to use, a dollar for the AI</h2>
              <p className='k-lede'>Discovery is free for every member. Pro adds the recommendations that cost us a model call.</p>
            </div>
            <div className='k-plans'>
              <div className='k-plan'>
                <h3 className='k-h3'>Free</h3>
                <ul>
                  <li><CheckIcon /><span>The whole catalogue, members-only entries included</span></li>
                  <li><CheckIcon /><span>Your saved tools, in one place</span></li>
                  <li><CheckIcon /><span>MCP search, details and install steps in your agent</span></li>
                </ul>
              </div>
              <div className='k-plan k-plan-pro'>
                <h3 className='k-h3'>Pro, $1 a month</h3>
                <ul>
                  <li><CheckIcon /><span>Everything in Free</span></li>
                  <li><CheckIcon /><span>AI recommendations in your agent: stacks, comparisons and project reviews</span></li>
                  <li><CheckIcon /><span>The Stash assistant on the web</span></li>
                </ul>
              </div>
            </div>
            <p style={{ marginTop: 24 }}><Link className='k-link' href='/pricing'>Compare plans in detail</Link></p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
