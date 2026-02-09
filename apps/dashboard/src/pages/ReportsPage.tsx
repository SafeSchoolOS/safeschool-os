import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type ReportType = 'incident' | 'compliance' | 'visitor' | 'environmental';

interface IncidentSummary {
  period: string;
  totalAlerts: number;
  byLevel: Record<string, number>;
  byStatus: Record<string, number>;
  avgResponseTimeMs: number;
  lockdowns: number;
  dispatches: number;
}

export function ReportsPage() {
  const { token } = useAuth();
  const [reportType, setReportType] = useState<ReportType>('incident');
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10),
  });

  const { data: incidentData, isLoading: incidentLoading } = useQuery({
    queryKey: ['report-incidents', dateRange],
    enabled: reportType === 'incident',
    queryFn: async () => {
      const res = await fetch(
        `${API_URL}/api/v1/alerts?limit=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const alerts = await res.json();
      // Client-side aggregation
      const filtered = (alerts || []).filter((a: any) => {
        const d = new Date(a.createdAt);
        return d >= new Date(dateRange.start) && d <= new Date(dateRange.end + 'T23:59:59');
      });
      const byLevel: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      for (const a of filtered) {
        byLevel[a.level] = (byLevel[a.level] || 0) + 1;
        byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      }
      return {
        totalAlerts: filtered.length,
        byLevel,
        byStatus,
        lockdowns: filtered.filter((a: any) => a.level === 'LOCKDOWN' || a.level === 'ACTIVE_THREAT').length,
      };
    },
  });

  const { data: complianceData, isLoading: complianceLoading } = useQuery({
    queryKey: ['report-compliance'],
    enabled: reportType === 'compliance',
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/drills/compliance/report`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const { data: visitorData, isLoading: visitorLoading } = useQuery({
    queryKey: ['report-visitors', dateRange],
    enabled: reportType === 'visitor',
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/visitors?date=${dateRange.end}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const visitors = await res.json();
      const total = (visitors || []).length;
      const checkedOut = (visitors || []).filter((v: any) => v.checkOutTime).length;
      const screened = (visitors || []).filter((v: any) => v.screening).length;
      return { total, checkedOut, stillOnSite: total - checkedOut, screened };
    },
  });

  const isLoading = incidentLoading || complianceLoading || visitorLoading;

  const REPORT_TYPES: { key: ReportType; label: string }[] = [
    { key: 'incident', label: 'Incident Summary' },
    { key: 'compliance', label: 'Drill Compliance' },
    { key: 'visitor', label: 'Visitor Activity' },
  ];

  return (
    <div className="p-6">
      {/* Report Type Selector */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2">
          {REPORT_TYPES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setReportType(key)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                reportType === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
          />
          <span className="text-gray-500">to</span>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
          />
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Incident Report */}
      {reportType === 'incident' && incidentData && !incidentLoading && (
        <div>
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold">{incidentData.totalAlerts}</div>
              <div className="text-gray-400 text-sm">Total Incidents</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">{incidentData.lockdowns}</div>
              <div className="text-gray-400 text-sm">Lockdowns/Active Threats</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-green-400">{incidentData.byStatus?.RESOLVED || 0}</div>
              <div className="text-gray-400 text-sm">Resolved</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-yellow-400">
                {incidentData.totalAlerts - (incidentData.byStatus?.RESOLVED || 0) - (incidentData.byStatus?.CANCELLED || 0)}
              </div>
              <div className="text-gray-400 text-sm">Active/Pending</div>
            </div>
          </div>

          {/* Breakdown Tables */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-semibold mb-3">By Alert Level</h3>
              <div className="space-y-2">
                {Object.entries(incidentData.byLevel).map(([level, count]) => (
                  <div key={level} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">{level}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-32 bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            level === 'ACTIVE_THREAT' ? 'bg-red-500' :
                            level === 'LOCKDOWN' ? 'bg-orange-500' :
                            level === 'MEDICAL' ? 'bg-yellow-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${Math.min(100, ((count as number) / incidentData.totalAlerts) * 100)}%` }}
                        />
                      </div>
                      <span className="font-medium w-8 text-right">{count as number}</span>
                    </div>
                  </div>
                ))}
                {Object.keys(incidentData.byLevel).length === 0 && (
                  <div className="text-gray-500 text-sm">No incidents in this period</div>
                )}
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-semibold mb-3">By Status</h3>
              <div className="space-y-2">
                {Object.entries(incidentData.byStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">{status}</span>
                    <span className="font-medium">{count as number}</span>
                  </div>
                ))}
                {Object.keys(incidentData.byStatus).length === 0 && (
                  <div className="text-gray-500 text-sm">No incidents in this period</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compliance Report */}
      {reportType === 'compliance' && complianceData && !complianceLoading && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-lg font-semibold">{complianceData.year} Alyssa's Law Compliance</h2>
            <span className={`px-3 py-1 rounded text-xs font-bold ${complianceData.overallCompliant ? 'bg-green-600' : 'bg-red-600'}`}>
              {complianceData.overallCompliant ? 'COMPLIANT' : 'NOT COMPLIANT'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-6">
            {(complianceData.requirements || []).map((req: any) => (
              <div key={req.type} className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{req.label}</span>
                  <span className={`w-3 h-3 rounded-full ${req.compliant ? 'bg-green-500' : 'bg-red-500'}`} />
                </div>
                <div className="text-3xl font-bold mb-1">{req.completed} / {req.required}</div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${req.compliant ? 'bg-green-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, (req.completed / req.required) * 100)}%` }}
                  />
                </div>
                <div className="text-xs text-gray-400 mt-2">
                  {req.compliant ? 'Requirement met' : `${req.required - req.completed} more needed`}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-sm text-gray-400">
              Total drills completed this year: <span className="text-white font-medium">{complianceData.totalDrills}</span>
            </div>
          </div>
        </div>
      )}

      {/* Visitor Report */}
      {reportType === 'visitor' && visitorData && !visitorLoading && (
        <div>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold">{visitorData.total}</div>
              <div className="text-gray-400 text-sm">Total Visitors</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-green-400">{visitorData.checkedOut}</div>
              <div className="text-gray-400 text-sm">Checked Out</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-yellow-400">{visitorData.stillOnSite}</div>
              <div className="text-gray-400 text-sm">Still On Site</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-400">{visitorData.screened}</div>
              <div className="text-gray-400 text-sm">Screened</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
