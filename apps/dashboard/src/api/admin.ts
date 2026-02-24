import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export interface DemoRequest {
  id: string;
  name: string;
  email: string;
  school: string;
  role: string;
  phone: string | null;
  buildings: number | null;
  state: string | null;
  message: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export function useDemoRequests(status?: string) {
  return useQuery<{ requests: DemoRequest[]; total: number }>({
    queryKey: ['demo-requests', status],
    queryFn: () => apiClient.get(`/api/v1/demo-requests${status ? `?status=${status}` : ''}`),
  });
}

export function useDemoRequestStats() {
  return useQuery<{ pending: number; approved: number; rejected: number; total: number }>({
    queryKey: ['demo-request-stats'],
    queryFn: () => apiClient.get('/api/v1/demo-requests/stats'),
  });
}

export function useReviewDemoRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes?: string }) =>
      apiClient.put(`/api/v1/demo-requests/${id}`, { status, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demo-requests'] });
      qc.invalidateQueries({ queryKey: ['demo-request-stats'] });
    },
  });
}

export interface AdminSite {
  id: string; name: string; address: string; city: string; state: string; zip: string;
  district: string; organizationId: string | null;
  organization: { id: string; name: string } | null;
  _count: { buildings: number; users: number };
}

export function useAllSites(search?: string) {
  return useQuery<{ sites: AdminSite[]; total: number }>({
    queryKey: ['admin-sites', search],
    queryFn: () => apiClient.get(`/api/v1/sites/all${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });
}

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiClient.post('/api/v1/sites', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sites'] }),
  });
}

export function useUpdateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string;[k: string]: any }) =>
      apiClient.put(`/api/v1/sites/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sites'] }),
  });
}

export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/sites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sites'] }),
  });
}

export function useAllUsers(params?: { search?: string; role?: string }) {
  return useQuery<{ users: any[]; total: number }>({
    queryKey: ['admin-users', params],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params?.search) qs.set('search', params.search);
      if (params?.role) qs.set('role', params.role);
      const q = qs.toString();
      return apiClient.get(`/api/v1/users/all${q ? `?${q}` : ''}`);
    },
  });
}

export interface Organization {
  id: string; name: string; slug: string; type: string;
  address: string | null; city: string | null; state: string | null; zip: string | null;
  phone: string | null; website: string | null; parentId: string | null;
  sites?: any[]; children?: any[];
  _count?: { sites: number; children: number };
}

export function useOrganizations() {
  return useQuery<Organization[]>({
    queryKey: ['organizations'],
    queryFn: () => apiClient.get('/api/v1/organizations'),
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiClient.post('/api/v1/organizations', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string;[k: string]: any }) =>
      apiClient.put(`/api/v1/organizations/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}

export function useDeleteOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/organizations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}
