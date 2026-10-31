const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://stashkit.vercel.app';

export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin', '/account', '/auth/', '/assistant'] }],
    sitemap: SITE + '/sitemap.xml',
  };
}
