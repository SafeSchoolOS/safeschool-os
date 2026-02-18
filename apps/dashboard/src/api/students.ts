import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

const API_BASE = import.meta.env.VITE_API_URL || '';

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('safeschool_token');
  const headers: HeadersInit = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

interface StudentFilters {
  search?: string;
  grade?: string;
  buildingId?: string;
  roomId?: string;
  isActive?: string;
  siteId?: string;
}

export function useStudents(filters: StudentFilters = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.grade) params.set('grade', filters.grade);
  if (filters.buildingId) params.set('buildingId', filters.buildingId);
  if (filters.roomId) params.set('roomId', filters.roomId);
  if (filters.isActive) params.set('isActive', filters.isActive);
  if (filters.siteId) params.set('siteId', filters.siteId);

  const qs = params.toString();
  return useQuery({
    queryKey: ['students', filters],
    queryFn: () => apiClient.get(`/api/v1/students${qs ? `?${qs}` : ''}`),
  });
}

export function useStudent(id: string) {
  return useQuery({
    queryKey: ['students', id],
    queryFn: () => apiClient.get(`/api/v1/students/${id}`),
    enabled: !!id,
  });
}

export function useCreateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      firstName: string;
      lastName: string;
      studentNumber: string;
      grade?: string;
      dateOfBirth?: string;
      buildingId?: string;
      roomId?: string;
      medicalNotes?: string;
      allergies?: string;
    }) => apiClient.post('/api/v1/students', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['students'] }),
  });
}

export function useUpdateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; [key: string]: any }) =>
      apiClient.put(`/api/v1/students/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['students'] }),
  });
}

export function useUploadStudentPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/api/v1/students/${id}/photo`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['students'] }),
  });
}

export function useDeleteStudentPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/students/${id}/photo`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['students'] }),
  });
}

export function useLinkTransportCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cardId }: { id: string; cardId: string }) =>
      apiClient.post(`/api/v1/students/${id}/transport-card`, { cardId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['students'] }),
  });
}

export function usePrintIdCard() {
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/students/${id}/print-id-card`, {}),
  });
}
