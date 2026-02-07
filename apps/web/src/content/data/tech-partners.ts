export interface TechPartner {
  name: string;
  logo: string;
  url: string;
}

export const techPartners: TechPartner[] = [
  { name: 'Claude Code', logo: '/images/partners/claude-code.svg', url: 'https://anthropic.com' },
  { name: 'Railway', logo: '/images/partners/railway.svg', url: 'https://railway.app' },
  { name: 'GitHub', logo: '/images/partners/github.svg', url: 'https://github.com' },
];
