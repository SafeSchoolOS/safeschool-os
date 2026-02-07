export const SITE_NAME = 'SafeSchool Foundation';
export const SITE_URL = 'https://safeschool.org';
export const CONTACT_EMAIL = 'partners@safeschool.org';
export const GITHUB_URL = 'https://github.com/safeschool/safeschool';

export const NAV_LINKS = [
  { label: 'Schools', href: '/schools' },
  { label: 'Manufacturers', href: '/manufacturers' },
  { label: 'Integrators', href: '/integrators' },
  {
    label: 'Directory',
    href: '#',
    children: [
      { label: 'Hardware', href: '/directory/hardware' },
      { label: 'Installers', href: '/directory/installers' },
    ],
  },
  { label: 'About', href: '/about' },
  { label: 'Blog', href: '/blog' },
] as const;

export const FOOTER_LINKS = {
  platform: [
    { label: 'For Schools', href: '/schools' },
    { label: 'For Manufacturers', href: '/manufacturers' },
    { label: 'For Integrators', href: '/integrators' },
    { label: 'Hardware Directory', href: '/directory/hardware' },
    { label: 'Installer Directory', href: '/directory/installers' },
    { label: "Alyssa's Law", href: '/alyssa-law' },
  ],
  community: [
    { label: 'GitHub', href: 'https://github.com/safeschool/safeschool' },
    { label: 'Documentation', href: '/developers' },
    { label: 'Blog', href: '/blog' },
    { label: 'Contributing', href: 'https://github.com/safeschool/safeschool/blob/main/CONTRIBUTING.md' },
  ],
  legal: [
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'Contact', href: '/contact' },
  ],
} as const;
