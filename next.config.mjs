/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Favicons and og:images come from arbitrary domains, so they are loaded as
  // plain <img> rather than through next/image. No remote patterns needed.
  images: { unoptimized: true },

  async headers() {
    return [
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
    ];
  },
};

export default nextConfig;
