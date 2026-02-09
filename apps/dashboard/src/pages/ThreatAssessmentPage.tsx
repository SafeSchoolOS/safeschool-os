import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface ThreatReport {
  id: string;
  subjectName: string;
  subjectGrade?: string;
  subjectRole?: string;
  category: string;
  description: string;
  riskLevel: string;
  status: string;
  assignedToId?: string;
  actionTaken?: string;
  createdAt: string;
}

const RISK_COLORS: Record<string, string> = {
  LOW: 'bg-green-600',
  MODERATE: 'bg-yellow-600',
  HIGH: 'bg-orange-600',
  IMMINENT: 'bg-red-600',
};

const STATUS_LABELS: Record<string, string> = {
  REPORTED: 'Reported',
  UNDER_ASSESSMENT: 'Under Assessment',
  INTERVENTION_PLANNED: 'Intervention Planned',
  INTERVENTION_ACTIVE: 'Intervention Active',
  MONITORING: 'Monitoring',
  RESOLVED: 'Resolved',
  ESCALATED_TO_LE: 'Escalated to LE',
  CLOSED: 'Closed',
};

const CATEGORIES = [
  'VERBAL_THREAT', 'WRITTEN_THREAT', 'SOCIAL_MEDIA', 'BEHAVIORAL_CHANGE',
  'WEAPON_POSSESSION', 'SELF_HARM', 'BULLYING', 'DOMESTIC', 'SUBSTANCE_ABUSE', 'OTHER_CONCERN',
];

const RISK_FACTORS = [
  'Specific target identified', 'Specific plan articulated', 'Access to weapons',
  'Prior violent behavior', 'Recent stressors or losses', 'Social isolation',
  'Fixation on violence', 'Substance abuse', 'Mental health concerns', 'Communication of intent',
];

export function ThreatAssessmentPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const { data: reports = [] } = useQuery<ThreatReport[]>({
    queryKey: ['threat-assessments', filterStatus],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      const res = await fetch(`${API_URL}/api/v1/threat-assessments?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const { data: dashboard } = useQuery({
    queryKey: ['threat-assessments-dashboard'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/threat-assessments/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-gray-400 hover:text-white transition-colors">&larr; Command Center</a>
          <h1 className="text-xl font-bold">Threat Assessment</h1>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded text-sm font-medium"
        >
          {showForm ? 'Cancel' : 'New Report'}
        </button>
      </header>

      <div className="p-6">
        {/* Dashboard Stats */}
        {dashboard && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold">{dashboard.total}</div>
              <div className="text-gray-400 text-sm">Total Reports</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-yellow-400">{dashboard.active}</div>
              <div className="text-gray-400 text-sm">Active Cases</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">{dashboard.byRiskLevel?.IMMINENT || 0}</div>
              <div className="text-gray-400 text-sm">Imminent Risk</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-orange-400">{dashboard.byRiskLevel?.HIGH || 0}</div>
              <div className="text-gray-400 text-sm">High Risk</div>
            </div>
          </div>
        )}

        {showForm && <NewReportForm token={token!} onComplete={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ['threat-assessments'] }); }} />}

        {/* Filters */}
        <div className="mb-4 flex gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {/* Reports List */}
        <div className="space-y-3">
          {reports.map((report) => (
            <div key={report.id} className="bg-gray-800 rounded-lg p-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`${RISK_COLORS[report.riskLevel]} px-2 py-0.5 rounded text-xs font-bold`}>
                    {report.riskLevel}
                  </span>
                  <span className="font-medium">{report.subjectName}</span>
                  {report.subjectGrade && <span className="text-gray-400 text-sm">Grade {report.subjectGrade}</span>}
                </div>
                <div className="text-sm text-gray-300">{report.category.replace(/_/g, ' ')}: {report.description.slice(0, 120)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {STATUS_LABELS[report.status] || report.status} | {new Date(report.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
          {reports.length === 0 && (
            <div className="text-center text-gray-500 py-8">No threat reports found.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewReportForm({ token, onComplete }: { token: string; onComplete: () => void }) {
  const [form, setForm] = useState({
    subjectName: '',
    subjectGrade: '',
    subjectRole: 'student',
    category: 'OTHER_CONCERN',
    description: '',
    riskFactors: [] as string[],
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/threat-assessments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to submit report');
      return res.json();
    },
    onSuccess: onComplete,
  });

  const toggleFactor = (factor: string) => {
    setForm((prev) => ({
      ...prev,
      riskFactors: prev.riskFactors.includes(factor)
        ? prev.riskFactors.filter((f) => f !== factor)
        : [...prev.riskFactors, factor],
    }));
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-bold mb-4">New Threat Report</h2>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <input
          placeholder="Subject Name"
          value={form.subjectName}
          onChange={(e) => setForm({ ...form, subjectName: e.target.value })}
          className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
        />
        <input
          placeholder="Grade (optional)"
          value={form.subjectGrade}
          onChange={(e) => setForm({ ...form, subjectGrade: e.target.value })}
          className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
        />
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      <textarea
        placeholder="Describe the concern..."
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm mb-4 h-20"
      />
      <div className="mb-4">
        <div className="text-sm font-medium mb-2">Risk Factors (CSTAG)</div>
        <div className="grid grid-cols-2 gap-2">
          {RISK_FACTORS.map((factor) => (
            <label key={factor} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.riskFactors.includes(factor)}
                onChange={() => toggleFactor(factor)}
                className="rounded"
              />
              {factor}
            </label>
          ))}
        </div>
      </div>
      <button
        onClick={() => mutation.mutate()}
        disabled={!form.subjectName || !form.description || mutation.isPending}
        className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium"
      >
        {mutation.isPending ? 'Submitting...' : 'Submit Report'}
      </button>
    </div>
  );
}
