export interface ComplianceState {
  code: string;
  name: string;
  status: 'enacted' | 'pending' | 'none';
  year?: number;
  details: string;
}

export const alyssaLawStates: ComplianceState[] = [
  { code: 'NJ', name: 'New Jersey', status: 'enacted', year: 2019, details: 'First state to enact. Requires silent panic alarms in all public schools.' },
  { code: 'FL', name: 'Florida', status: 'enacted', year: 2020, details: "Alyssa's Law passed as part of school safety legislation." },
  { code: 'NY', name: 'New York', status: 'enacted', year: 2022, details: 'Requires silent panic alarms connected to 911.' },
  { code: 'TX', name: 'Texas', status: 'enacted', year: 2023, details: 'School safety requirements including panic systems.' },
  { code: 'OK', name: 'Oklahoma', status: 'enacted', year: 2023, details: 'Silent alarm requirements for K-12 schools.' },
  { code: 'TN', name: 'Tennessee', status: 'enacted', year: 2023, details: 'Panic alarm mandate for public schools.' },
  { code: 'VA', name: 'Virginia', status: 'enacted', year: 2024, details: 'School safety panic alarm requirements.' },
  { code: 'AZ', name: 'Arizona', status: 'enacted', year: 2024, details: 'Silent panic alarm mandate.' },
  { code: 'NC', name: 'North Carolina', status: 'enacted', year: 2024, details: 'School safety technology requirements.' },
];
