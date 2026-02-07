import type { Metadata } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://safeschool.org';

const pageMetadata: Record<string, { title: string; description: string }> = {
  home: {
    title: 'SafeSchool — The Open Standard for School Safety Technology',
    description:
      'Free, open source school safety platform. Unify access control, panic buttons, and cameras from any manufacturer. 100% free for schools.',
  },
  schools: {
    title: 'Free School Safety Platform | SafeSchool',
    description:
      'Get the complete SafeSchool platform at zero cost. Access control, panic alerts, location tracking, and Alyssa\'s Law compliance. Free forever.',
  },
  manufacturers: {
    title: 'Become a SafeSchool Founding Member | Manufacturers',
    description:
      'Get your hardware into every school in America. Join the SafeSchool ecosystem as a founding member. Certification included.',
  },
  integrators: {
    title: 'Certified Installer Program | SafeSchool',
    description:
      'Build your business on school safety. Get trained, certified, and listed in the SafeSchool installer directory.',
  },
  about: {
    title: 'About SafeSchool Foundation | Our Mission',
    description:
      'SafeSchool exists to ensure every school in America has access to the best safety technology, regardless of budget.',
  },
  contact: {
    title: 'Contact SafeSchool Foundation',
    description:
      'Get in touch with the SafeSchool team. Questions about the platform, membership, or certification program.',
  },
  membership: {
    title: 'Manufacturer Membership Application | SafeSchool',
    description:
      'Apply to become a SafeSchool founding member. Get your hardware certified and listed in the directory.',
  },
  'alyssa-law': {
    title: "Alyssa's Law Compliance | SafeSchool",
    description:
      "Understand Alyssa's Law requirements by state. SafeSchool meets every requirement for silent panic alarms in schools.",
  },
  developers: {
    title: 'Open Source & Developers | SafeSchool',
    description:
      'SafeSchool is open source under AGPL. View the code, contribute, build integrations.',
  },
  blog: {
    title: 'Blog | SafeSchool Foundation',
    description:
      'News, insights, and thought leadership on school safety technology and Alyssa\'s Law compliance.',
  },
  'hardware-directory': {
    title: 'Certified Hardware Directory | SafeSchool',
    description:
      'Browse SafeSchool-certified hardware. Readers, panels, panic buttons, cameras — all tested and verified.',
  },
  'installer-directory': {
    title: 'Certified Installer Directory | SafeSchool',
    description:
      'Find a SafeSchool-certified installer in your area. Trained, tested, ready to deploy.',
  },
};

export function generatePageMetadata(page: string): Metadata {
  const meta = pageMetadata[page] || pageMetadata.home;
  return {
    title: meta.title,
    description: meta.description,
    metadataBase: new URL(BASE_URL),
    openGraph: {
      title: meta.title,
      description: meta.description,
      siteName: 'SafeSchool Foundation',
      url: BASE_URL,
      type: 'website',
      images: [{ url: '/images/og/default.png', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
    },
  };
}
