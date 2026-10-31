import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './site.css';

// One family: Archivo, Aruo's own typeface, for headings, body, navigation and
// labels, as a variable font so every weight used (400 to 650) is real, with
// its true italic for the hero's one highlighted word. IBM Plex Mono only for
// code and terminal text. next/font self-hosts both and sizes the fallback to
// match, so swapping in the web font does not shift the layout.
const sans = Archivo({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-archivo', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap' });

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://stashkit.vercel.app';
const DESCRIPTION =
  'Describe what you are building and Stash helps your AI agent find the right skills, plugins, MCP servers and developer tools. Works with Claude Code, Cursor and GitHub Copilot.';

export const metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Stash: the right tools for what you are building', template: '%s | Stash' },
  description: DESCRIPTION,
  applicationName: 'Stash',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon-180.png' },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Stash',
    title: 'Stash: the right tools for what you are building',
    description: DESCRIPTION,
    url: '/',
    images: [{ url: '/icon-512.png', width: 512, height: 512, alt: 'Stash' }],
  },
  twitter: { card: 'summary', title: 'Stash', description: DESCRIPTION },
};

export const viewport = {
  themeColor: '#070707',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang='en' className={`${sans.variable} ${mono.variable}`}>
      <body>
        {children}
        {/* /_vercel/insights only exists on Vercel deployments. */}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
