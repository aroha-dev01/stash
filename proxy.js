import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Runs before every page and API request (Next 16 calls this Proxy; it used
// to be Middleware). Two jobs:
//
//   1. Refresh the Supabase session, so its cookies never quietly expire.
//   2. Turn signed-out visitors away early: pages go to /login, API calls
//      get a 401.
//
// This is the optimistic check only. Each route still resolves the user
// itself (lib/auth.js currentUser) before touching anyone's data.

// Reachable signed out: the public site and catalogue (lib/access.js decides
// what each visitor may open), the setup guide, sign-in itself, and endpoints
// that authenticate their own callers (MCP keys, the hidden iOS endpoint,
// Vercel cron, backfills).
const OPEN = [
  /^\/$/, /^\/explore(\/|$)/, /^\/pricing$/, /^\/upgrade$/, /^\/connect$/, /^\/privacy$/, /^\/login$/, /^\/auth\//,
  /^\/sitemap\.xml$/, /^\/robots\.txt$/,
  /^\/api\/catalog(\/|$)/,
  /^\/api\/mcp/, /^\/api\/save/, /^\/api\/cron\//, /^\/api\/backfill/,
  // Vercel BotID's challenge script, which every visitor's browser loads.
  /^\/149e9513-01fa-4fb0-aad4-566afd725d1b\//,
];

// Crawlers that collect pages for AI training or AI answers. robots.txt asks
// them to stay away; this turns away the ones that ask anyway. Agents working
// for a member come in through MCP with a key instead.
const AI_CRAWLERS = /GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|CCBot|Bytespider|PerplexityBot|Perplexity-User|Amazonbot|meta-externalagent|meta-externalfetcher|FacebookBot|cohere-ai|cohere-training-data-crawler|Diffbot|ImagesiftBot|Omgilibot|omgili|Timpibot|YouBot|PetalBot|AI2Bot|Ai2Bot-Dolma|Applebot-Extended|DuckAssistBot|Kangaroo Bot|PanguBot|Scrapy|img2dataset|Webzio-Extended|MistralAI-User|Google-CloudVertexBot|TikTokSpider|Brightbot|SemrushBot-OCOB|webzio|Crawl4AI|FirecrawlAgent|Firecrawl/i;

// stash.aruo.dev is home. Pages on the old Vercel address move there, so
// sign-in (whose Google button only works on its listed origins) and cookies
// live on one domain. Never /api: agents are configured with the old MCP
// address, and a redirect would drop their Authorization header. Never a
// sign-in already under way (/auth, ?code=), whose cookies are on this host.
const OLD_HOST = 'stashkit.vercel.app';
const HOME = 'https://stash.aruo.dev';

export async function proxy(request) {
  const { pathname, search, searchParams } = request.nextUrl;
  if (
    request.headers.get('host') === OLD_HOST &&
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/auth/') &&
    !pathname.startsWith('/149e9513-') &&
    !searchParams.has('code')
  ) {
    return NextResponse.redirect(HOME + pathname + search, 308);
  }

  if (AI_CRAWLERS.test(request.headers.get('user-agent') || '') && request.nextUrl.pathname !== '/robots.txt') {
    return new NextResponse('Automated collection of Stash is not allowed. See /robots.txt.', { status: 403 });
  }

  // If Supabase falls back to the Site URL, the sign-in code arrives on the
  // home page. Finish the sign-in instead of showing the landing page.
  if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.has('code')) {
    const to = request.nextUrl.clone();
    to.pathname = '/auth/callback';
    return NextResponse.redirect(to);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list, headers) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers || {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    }
  );

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  if (!data?.user && !OPEN.some((r) => r.test(path))) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }
    const back = path + request.nextUrl.search;
    const to = request.nextUrl.clone();
    to.pathname = '/login';
    to.search = back === '/' ? '' : '?next=' + encodeURIComponent(back);
    return NextResponse.redirect(to);
  }

  return response;
}

export const config = {
  // Everything except static assets and Vercel's own /_vercel paths (the
  // analytics script must never be answered with a sign-in redirect).
  matcher: ['/((?!_next/static|_next/image|_vercel|icon|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
