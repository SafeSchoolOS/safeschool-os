export interface FoundingMember {
  name: string;
  slug: string;
  tier: 'charter' | 'platinum' | 'gold' | 'silver';
  logo: string;
  logoLight: string;
  url: string;
  description: string;
  products: string[];
  joinedDate: string;
}

export const foundingMembers: FoundingMember[] = [
  {
    name: 'Sicunet',
    slug: 'sicunet',
    tier: 'charter',
    logo: '/images/members/sicunet.svg',
    logoLight: '/images/members/sicunet-light.svg',
    url: 'https://sicunet.com',
    description: 'Access control hardware manufacturer. Charter Founding Member.',
    products: ['SR-200 Smart Reader', 'SP-100 Smart Panel'],
    joinedDate: '2026-02',
  },
];
