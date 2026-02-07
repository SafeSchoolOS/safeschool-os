import type { Metadata } from 'next';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'SafeSchool — The Open Standard for School Safety Technology',
  description:
    'Free, open source school safety platform. Unify access control, panic buttons, and cameras from any manufacturer. 100% free for schools.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://safeschool.org'),
  openGraph: {
    siteName: 'SafeSchool Foundation',
    type: 'website',
    images: [{ url: '/images/og/default.png', width: 1200, height: 630 }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        <main className="pt-[72px]">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
