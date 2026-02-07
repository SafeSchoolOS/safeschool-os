export interface PricingTierData {
  name: string;
  price: string;
  period: string;
  highlighted: boolean;
  badge?: string;
  features: string[];
}

export const pricingTiers: PricingTierData[] = [
  {
    name: 'Silver',
    price: '$5,000',
    period: '/year',
    highlighted: false,
    features: [
      '1 product certification included',
      'Listed in hardware directory',
      'Logo on website',
      'Community integration support',
    ],
  },
  {
    name: 'Gold',
    price: '$15,000',
    period: '/year',
    highlighted: true,
    badge: 'Most Popular',
    features: [
      'Up to 3 product certifications',
      'Listed in hardware directory',
      'Logo on website',
      'Roadmap input',
      'Early API access',
      'Standard integration support',
    ],
  },
  {
    name: 'Platinum',
    price: '$25,000',
    period: '/year',
    highlighted: false,
    features: [
      'Unlimited product certifications',
      'Top placement in directory',
      'Logo on dashboard',
      'Advisory board seat',
      'Priority integration support',
      'Early API access',
      'Conference speaking opportunity',
    ],
  },
];
