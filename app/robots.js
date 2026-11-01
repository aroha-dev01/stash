const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://stashkit.vercel.app';

// AI crawlers may not read Stash at all, for training or for answers; proxy.js
// turns away the ones that ignore this. Search engines still index the public
// pages, so people can find the site.
const AI_CRAWLERS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'CCBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'PerplexityBot', 'Perplexity-User', 'Amazonbot',
  'meta-externalagent', 'meta-externalfetcher', 'FacebookBot', 'cohere-ai', 'cohere-training-data-crawler',
  'Diffbot', 'ImagesiftBot', 'Omgilibot', 'Timpibot', 'YouBot', 'AI2Bot', 'DuckAssistBot', 'MistralAI-User',
  'Google-CloudVertexBot', 'PanguBot', 'Webzio-Extended', 'TikTokSpider',
];

export default function robots() {
  return {
    rules: [
      { userAgent: AI_CRAWLERS, disallow: '/' },
      { userAgent: '*', allow: '/', disallow: ['/api/', '/admin', '/account', '/auth/', '/assistant'] },
    ],
    sitemap: SITE + '/sitemap.xml',
  };
}
