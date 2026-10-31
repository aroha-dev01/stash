import { headers } from 'next/headers';
import { getViewer } from '@/lib/auth';
import SiteHeader from '../_ui/SiteHeader';
import SiteFooter from '../_ui/SiteFooter';
import Guide from './guide';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Connect your agent',
  description: 'Connect Stash to Claude Code, Cursor, GitHub Copilot in VS Code, Claude, Windsurf or any remote MCP client. Step-by-step setup with copyable config.',
  alternates: { canonical: '/connect' },
};

/** The setup guide. Open to visitors, so the steps can be read before signing in. */
export default async function ConnectPage({ searchParams }) {
  const sp = await searchParams;
  const viewer = await getViewer().catch(() => null);

  // The MCP address follows whichever domain this page is served on, so it is
  // right locally, on previews and in production alike.
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https');
  const mcpUrl = proto + '://' + host + '/api/mcp';

  return (
    <div className='k'>
      <SiteHeader current='connect' />
      <main id='main' className='k-wrap k-page'>
        <div className='k-section-head' style={{ marginBottom: 0 }}>
          <span className='k-eyebrow'>Setup guide</span>
          <h1 className='k-h1' style={{ fontSize: 'var(--text-page)' }}>Connect your agent to Stash.</h1>
          <p className='k-lede'>
            Pick your agent, create a key and paste one config. Stash then shows up as an MCP server your agent can search
            whenever it needs a tool.
          </p>
        </div>
        <Guide
          signedIn={!!viewer}
          name={viewer?.name || ''}
          mcpUrl={mcpUrl}
          isPro={!!viewer?.isPro}
          initialClient={typeof sp?.client === 'string' ? sp.client : 'claude-code'}
          welcome={sp?.welcome === '1'}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
