export interface Feature {
  icon: string;
  title: string;
  description: string;
}

export const platformFeatures: Feature[] = [
  {
    icon: 'Shield',
    title: 'Unified Access Control',
    description: 'Single dashboard for all doors, readers, and credentials — regardless of manufacturer.',
  },
  {
    icon: 'Bell',
    title: 'Emergency Panic Alerts',
    description: 'Silent panic button with indoor location tracking. Instant notification to staff and 911.',
  },
  {
    icon: 'Radio',
    title: 'Direct 911 Dispatch',
    description: 'NENA i3 compliant dispatch with location data. Failover chain ensures alerts always get through.',
  },
  {
    icon: 'UserCheck',
    title: 'Visitor Management',
    description: 'ID scanning, watchlist screening, badge printing. Know who is in your building at all times.',
  },
  {
    icon: 'Bus',
    title: 'Student Transportation',
    description: 'RFID student tracking, bus GPS, missed-bus alerts. Parents get real-time notifications.',
  },
  {
    icon: 'Eye',
    title: 'Threat Intelligence',
    description: 'AI-powered weapon detection integration. Automatic lockdown on confirmed threats.',
  },
];

export const schoolFeatures: Feature[] = [
  { icon: 'Shield', title: 'Unified Access Control Dashboard', description: 'Manage all doors, credentials, and schedules from one interface.' },
  { icon: 'Bell', title: 'Emergency Panic Alert System', description: 'Silent panic with indoor location tracking for instant response.' },
  { icon: 'Wifi', title: 'BLE Mesh Indoor Positioning', description: 'Precise location data during emergencies for first responders.' },
  { icon: 'UserCheck', title: 'Visitor Check-In', description: 'Basic visitor management with ID scanning and badge printing.' },
  { icon: 'MessageSquare', title: 'Real-Time Notifications', description: 'Email, SMS, and push alerts to staff and first responders.' },
  { icon: 'Building', title: 'Multi-Site Management', description: 'Districts manage all schools from a single platform.' },
  { icon: 'CheckCircle', title: 'Certified Hardware Compatibility', description: 'Choose from any SafeSchool-certified hardware.' },
  { icon: 'FileCheck', title: "Alyssa's Law Compliance", description: 'Built-in compliance reporting for every requirement.' },
  { icon: 'Phone', title: '911/PSAP Integration', description: 'Direct dispatch with location data per NENA i3 standards.' },
  { icon: 'Cloud', title: 'Cloud Hosted', description: 'No servers to manage. Always updated. Always running.' },
];
