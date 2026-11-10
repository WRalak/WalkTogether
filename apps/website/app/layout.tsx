import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { siteConfig } from '@/lib/config';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: 'WalkTogether — walking & running clubs, together', template: '%s · WalkTogether' },
  description: siteConfig.description,
  applicationName: 'WalkTogether',
  openGraph: { type: 'website', siteName: 'WalkTogether', locale: 'en_KE', title: 'WalkTogether', description: siteConfig.description },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = { themeColor: '#127a50', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
