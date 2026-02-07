export interface TeamMember {
  name: string;
  role: string;
  bio: string;
  image?: string;
}

export const teamMembers: TeamMember[] = [
  {
    name: 'Brian Wattendorf',
    role: 'Founder & Executive Director',
    bio: 'A 20-year veteran of the access control industry, Brian saw firsthand how proprietary silos left schools with expensive, inflexible safety systems. He founded SafeSchool to create a universal, open standard.',
  },
];
