import { withBotId } from 'botid/next/config';

// Google's OAuth client ID is public by design: the browser hands it to
// Google to draw the sign-in button. Only the client secret is private. So
// GOOGLE_CLIENT_ID is passed to the browser bundle, but only when it has the
// shape of a client ID, so a secret pasted there by mistake never ships.
const GOOGLE_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const googleClientId = [process.env.GOOGLE_CLIENT_ID, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID]
  .map((v) => (v || '').trim())
  .find((v) => GOOGLE_ID.test(v)) || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { GOOGLE_CLIENT_ID: googleClientId },
  // Favicons and og:images come from arbitrary domains, so they are loaded as
  // plain <img> rather than through next/image. No remote patterns needed.
  images: { unoptimized: true },

  async headers() {
    return [
      {
        // Baseline for every response. No site may frame Stash (its pages hold
        // buttons that revoke keys, delete projects and change plans), browsers
        // must not guess content types, and links out carry only the origin.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        ],
      },
      {
        // Every API response is live data about a library that changes as you
        // use it. Without this, Vercel's edge served a cached empty facets
        // response long after the database was healthy again, so the sidebar
        // read zero links while the links themselves were fine.
        //
        // `dynamic = 'force-dynamic'` controls how the route is RENDERED, not
        // what the CDN is allowed to do with the response afterwards. That is
        // the distinction that caught us out.
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'CDN-Cache-Control', value: 'no-store' },
          { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
        ],
      },
      {
        // The MCP consent page holds an Allow button. No other site may frame
        // it and trick a member into pressing it.
        source: '/oauth/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

// BotID serves its invisible browser challenge through rewrites it adds here.
export default withBotId(nextConfig);
