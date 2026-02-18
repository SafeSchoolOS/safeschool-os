import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export interface ParentChild {
  id: string;
  studentName: string;
  cardId: string;
  grade: string | null;
  busNumber: string | null;
  busId: string | null;
  routeName: string | null;
  routeNumber: string | null;
  latestScan: {
    scanType: 'BOARD' | 'EXIT';
    scannedAt: string;
    busNumber: string;
  } | null;
  status: 'ON_BUS' | 'OFF_BUS';
  parentContactId: string;
  relationship: string;
}

export interface ParentBusStatus {
  id: string;
  busNumber: string;
  currentLatitude: number | null;
  currentLongitude: number | null;
  currentSpeed: number | null;
  currentHeading: number | null;
  lastGpsAt: string | null;
  currentStudentCount: number;
  isActive: boolean;
}

export interface ParentAlert {
  id: string;
  level: string;
  status: string;
  message: string | null;
  buildingName: string;
  triggeredAt: string;
}

export interface ParentNotification {
  id: string;
  channel: string;
  message: string;
  status: string;
  sentAt: string;
}

export interface ParentSiteInfo {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface ParentDashboardData {
  children: ParentChild[];
  busStatus: ParentBusStatus[];
  schoolStatus: 'ALL_CLEAR' | 'LOCKDOWN' | 'ALERT_ACTIVE';
  activeAlerts: ParentAlert[];
  recentNotifications: ParentNotification[];
  site: ParentSiteInfo | null;
}

export function useParentDashboard() {
  return useQuery<ParentDashboardData>({
    queryKey: ['parent-dashboard'],
    queryFn: () => apiClient.get('/api/v1/parent/dashboard'),
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });
}
