import './globals.css';

export const metadata = {
  title: 'Stash',
  description: 'Your personal database of tools, repos and links.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Stash', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon.svg' },
};

export const viewport = {
  themeColor: '#0b0c0e',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
