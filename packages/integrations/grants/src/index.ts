/**
 * Grant & Funding Management Module
 *
 * Helps schools and districts find, apply for, and track grants
 * to fund their SafeSchool deployment. Includes a searchable database
 * of federal, state, and private funding sources with eligibility
 * matching and application tracking.
 */

import type { Grant, GrantApplication, GrantSource, GrantStatus } from '@safeschool/core';

/**
 * Built-in grant database with known school safety funding programs.
 * This serves as the seed data - schools can add custom grants too.
 */
export const KNOWN_GRANTS: Omit<Grant, 'id' | 'status'>[] = [
  // ============ FEDERAL GRANTS ============
  {
    name: 'STOP School Violence Prevention Program (SVPP)',
    source: 'FEDERAL' as GrantSource,
    agency: 'DOJ / Bureau of Justice Assistance (BJA)',
    programName: 'STOP School Violence Prevention Program',
    description:
      'Provides funding for evidence-based school safety programs including physical security improvements, threat assessment, and crisis intervention.',
    fundingAmount: { min: 50000, max: 500000, typical: 250000 },
    eligibility: {
      schoolTypes: ['PUBLIC', 'CHARTER'],
      requirements: [
        'Must be a state, unit of local government, or Indian tribe',
        'Partnership with school district required',
        'Must implement evidence-based programs',
      ],
      matchRequired: false,
    },
    timeline: {},
    allowedExpenses: [
      'Panic alarm / silent alert systems',
      'Access control and lockdown systems',
      'Security cameras and video surveillance',
      'Training for school personnel',
      'Threat assessment teams',
      'Anonymous reporting systems',
      'Crisis intervention programs',
      'Coordination with law enforcement',
    ],
    url: 'https://bja.ojp.gov/program/stop-school-violence-prevention-program',
  },
  {
    name: 'COPS School Violence Prevention Program (SVPP)',
    source: 'FEDERAL' as GrantSource,
    agency: 'DOJ / Community Oriented Policing Services (COPS)',
    programName: 'COPS SVPP',
    description:
      'Funds improvements to school security including entry controls, panic buttons, and coordination with law enforcement.',
    fundingAmount: { min: 500000, max: 2000000, typical: 1000000 },
    eligibility: {
      schoolTypes: ['PUBLIC', 'CHARTER'],
      requirements: [
        'Must be a state, local, or tribal law enforcement agency',
        'Must partner with school district',
        'Must be used for K-12 schools',
      ],
      matchRequired: true,
      matchPercentage: 25,
    },
    timeline: {},
    allowedExpenses: [
      'Metal detectors and weapons screening',
      'Panic alarm systems (Alyssa\'s Law compliance)',
      'Access control systems and door locks',
      'Security cameras',
      'Communication systems',
      'School resource officer equipment',
      'Visitor management systems',
      'Training and exercises',
    ],
    url: 'https://cops.usdoj.gov/svpp',
  },
  {
    name: 'Bipartisan Safer Communities Act (BSCA) Funding',
    source: 'FEDERAL' as GrantSource,
    agency: 'DOJ / Various agencies',
    programName: 'Bipartisan Safer Communities Act',
    description:
      'Historic bipartisan legislation providing ~$1 billion for school safety and mental health programs. Funding distributed through multiple existing grant programs.',
    fundingAmount: { min: 50000, max: 1000000, typical: 300000 },
    eligibility: {
      schoolTypes: ['PUBLIC', 'CHARTER', 'PRIVATE'],
      requirements: [
        'Varies by specific sub-program',
        'Must address school safety or mental health',
      ],
      matchRequired: false,
    },
    timeline: {},
    allowedExpenses: [
      'School safety infrastructure',
      'Mental health services',
      'Violence intervention programs',
      'Threat assessment and prevention',
      'School-based mental health professionals',
    ],
  },
  {
    name: 'E-Rate Program (Network Infrastructure)',
    source: 'FEDERAL' as GrantSource,
    agency: 'FCC / Universal Service Administrative Company (USAC)',
    programName: 'E-Rate',
    description:
      'Provides discounts of 20-90% on telecommunications and internet access for schools. Can fund the network infrastructure underlying safety systems.',
    fundingAmount: { min: 5000, max: 500000, typical: 50000 },
    eligibility: {
      schoolTypes: ['PUBLIC', 'CHARTER', 'PRIVATE'],
      requirements: [
        'Must have approved technology plan',
        'Discount based on poverty level and rural/urban status',
        'Must follow competitive bidding process',
      ],
      matchRequired: true,
      matchPercentage: 10, // Minimum 10% co-pay
    },
    timeline: {},
    allowedExpenses: [
      'Network switches and routers',
      'Wireless access points (for safety system connectivity)',
      'Cabling and fiber',
      'Firewall and network security',
      'Internet access',
      'Managed Wi-Fi services',
    ],
    url: 'https://www.usac.org/e-rate/',
  },
  {
    name: 'FEMA Preparedness Grants',
    source: 'FEDERAL' as GrantSource,
    agency: 'DHS / FEMA',
    programName: 'Homeland Security Grant Program / UASI',
    description:
      'DHS preparedness grants that can cover school security improvements in high-risk urban areas.',
    fundingAmount: { min: 100000, max: 5000000, typical: 500000 },
    eligibility: {
      schoolTypes: ['PUBLIC', 'CHARTER'],
      requirements: [
        'Applied through state/local emergency management agency',
        'Must align with FEMA preparedness goals',
        'Urban Areas Security Initiative (UASI) for high-risk metro areas',
      ],
      matchRequired: false,
    },
    timeline: {},
    allowedExpenses: [
      'Emergency communications equipment',
      'Interoperable communications',
      'Physical security enhancements',
      'Training and exercises',
      'Planning and preparedness',
    ],
  },

  // ============ PRIVATE / FOUNDATION GRANTS ============
  {
    name: 'Sandy Hook Promise Foundation Grants',
    source: 'PRIVATE_FOUNDATION' as GrantSource,
    agency: 'Sandy Hook Promise',
    programName: 'Know the Signs Programs',
    description:
      'Provides free programs and training to schools including Say Something Anonymous Reporting System, Start With Hello, and Signs of Suicide prevention.',
    fundingAmount: { min: 0, max: 0, typical: 0 },
    eligibility: {
      schoolTypes: ['PUBLIC', 'CHARTER', 'PRIVATE', 'PAROCHIAL'],
      requirements: ['Must commit to implementing prevention programs'],
      matchRequired: false,
    },
    timeline: {},
    allowedExpenses: [
      'Anonymous reporting system (Say Something)',
      'Violence prevention training',
      'Social-emotional learning programs',
    ],
    url: 'https://www.sandyhookpromise.org',
  },
];

/**
 * Module-to-expense mapping for grant budget planning.
 * Maps SafeSchool modules to common grant-fundable expense categories.
 */
export const MODULE_FUNDING_MAP: Record<string, string[]> = {
  'panic-alerts': [
    'Panic alarm / silent alert systems',
    'Panic alarm systems (Alyssa\'s Law compliance)',
    'Emergency communications equipment',
    'Wearable panic devices',
  ],
  'access-control': [
    'Access control and lockdown systems',
    'Access control systems and door locks',
    'Physical security enhancements',
    'Door hardware and electronic locks',
  ],
  'visitor-management': [
    'Visitor management systems',
    'ID scanning and screening equipment',
    'Badge printing systems',
  ],
  '911-dispatch': [
    'Emergency communications equipment',
    'Interoperable communications',
    'E911 integration',
    'Cellular failover equipment',
  ],
  'cameras': [
    'Security cameras and video surveillance',
    'Security cameras',
    'AI video analytics',
  ],
  'mass-notification': [
    'Communication systems',
    'Mass notification systems',
    'PA and intercom systems',
  ],
  'threat-intel': [
    'Threat assessment teams',
    'Anonymous reporting systems',
    'AI weapon detection',
    'Behavioral threat assessment tools',
  ],
  'transportation': [
    'Student tracking systems',
    'Bus RFID readers',
    'GPS tracking equipment',
    'Parent notification systems',
  ],
  'network-infrastructure': [
    'Network switches and routers',
    'Wireless access points (for safety system connectivity)',
    'Cabling and fiber',
    'Firewall and network security',
    'Cellular failover equipment',
  ],
  'training': [
    'Training for school personnel',
    'Training and exercises',
    'Drill management systems',
  ],
  'mini-pc-edge': [
    'Physical security enhancements',
    'Emergency communications equipment',
    'Server and edge computing hardware',
    'UPS and backup power',
  ],
};

export class GrantService {
  /**
   * Search grants matching school/district criteria.
   */
  searchGrants(filters: {
    schoolType?: 'PUBLIC' | 'CHARTER' | 'PRIVATE' | 'PAROCHIAL';
    state?: string;
    source?: GrantSource;
    modules?: string[]; // SafeSchool modules they want to fund
  }): Omit<Grant, 'id' | 'status'>[] {
    return KNOWN_GRANTS.filter((grant) => {
      if (filters.schoolType && !grant.eligibility.schoolTypes.includes(filters.schoolType)) {
        return false;
      }
      if (filters.state && grant.eligibility.states && !grant.eligibility.states.includes(filters.state)) {
        return false;
      }
      if (filters.source && grant.source !== filters.source) {
        return false;
      }
      if (filters.modules && filters.modules.length > 0) {
        // Check if any of the school's desired modules match grant-fundable expenses
        const fundableExpenses = filters.modules.flatMap((m) => MODULE_FUNDING_MAP[m] || []);
        const hasOverlap = grant.allowedExpenses.some((expense) =>
          fundableExpenses.some((f) => expense.toLowerCase().includes(f.toLowerCase()) || f.toLowerCase().includes(expense.toLowerCase())),
        );
        if (!hasOverlap) return false;
      }
      return true;
    });
  }

  /**
   * Calculate potential funding for a SafeSchool deployment.
   */
  estimateFunding(modules: string[]): {
    totalPotential: { min: number; max: number };
    grantCount: number;
    grants: { name: string; amount: { min?: number; max?: number } }[];
  } {
    const matchingGrants = this.searchGrants({ modules });
    const totalMin = matchingGrants.reduce((sum, g) => sum + (g.fundingAmount.min || 0), 0);
    const totalMax = matchingGrants.reduce((sum, g) => sum + (g.fundingAmount.max || 0), 0);

    return {
      totalPotential: { min: totalMin, max: totalMax },
      grantCount: matchingGrants.length,
      grants: matchingGrants.map((g) => ({
        name: g.name,
        amount: g.fundingAmount,
      })),
    };
  }

  /**
   * Generate a budget template mapping SafeSchool modules to grant line items.
   */
  generateBudgetTemplate(modules: string[]): { category: string; items: string[]; estimatedCost: string }[] {
    return modules.map((module) => ({
      category: module,
      items: MODULE_FUNDING_MAP[module] || ['General safety equipment'],
      estimatedCost: 'TBD', // Schools fill in actual costs
    }));
  }
}
