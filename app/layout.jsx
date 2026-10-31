import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './site.css';

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: { default: 'Stash: the right tools for every task', template: '%s | Stash' },
  description:
    'A hand-picked catalogue of developer tools, MCP servers and agent skills. Connect it to Claude, Cursor or Copilot once, and your agent picks the right tool for the job.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport = {
  themeColor: '#11141f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang='en' className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
