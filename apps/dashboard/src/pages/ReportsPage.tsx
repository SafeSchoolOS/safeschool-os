import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { exportToCsv, formatDate } from '../utils/export';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  RadialBarChart, RadialBar,
} from 'recharts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type ReportType = 'incident' | 'compliance' | 'visitor';

const LEVEL_COLORS: Record<string, string> = {
  ACTIVE_THREAT: '#ef4444',
  LOCKDOWN: '#f97316',
  MEDICAL: '#eab308',
  FIRE: '#f59e0b',
  WEATHER: '#3b82f6',
  ALL_CLEAR: '#22c55e',
  CUSTOM: '#8b5cf6',
};

const STATUS_COLORS: Record<string, string> = {
  TRIGGERED: '#ef4444',
  ACKNOWLEDGED: '#f97316',
  DISPATCHED: '#eab308',
  RESPONDING: '#3b82f6',
  RESOLVED: '#22c55e',
  CANCELLED: '#6b7280',
};

const VISITOR_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#8b5cf6'];

export function ReportsPage() {
  const { token } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);
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
        `${API_URL}/api/v1/alerts?limit=500`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Failed to load alerts (${res.status})`);
      const alerts = await res.json();
      const filtered = (alerts || []).filter((a: any) => {
        const d = new Date(a.createdAt);
        return d >= new Date(dateRange.start) && d <= new Date(dateRange.end + 'T23:59:59');
      });
      const byLevel: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      const byDay: Record<string, number> = {};
      for (const a of filtered) {
        byLevel[a.level] = (byLevel[a.level] || 0) + 1;
        byStatus[a.status] = (byStatus[a.status] || 0) + 1;
        const day = new Date(a.createdAt).toISOString().slice(0, 10);
        byDay[day] = (byDay[day] || 0) + 1;
      }
      return {
        totalAlerts: filtered.length,
        rawAlerts: filtered,
        byLevel,
        byStatus,
        byDay,
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
      if (!res.ok) throw new Error(`Failed to load compliance data (${res.status})`);
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
      if (!res.ok) throw new Error(`Failed to load visitors (${res.status})`);
      const visitors = await res.json();
      const total = (visitors || []).length;
      const checkedOut = (visitors || []).filter((v: any) => v.checkOutTime).length;
      const screened = (visitors || []).filter((v: any) => v.screening).length;
      const flagged = (visitors || []).filter((v: any) => v.status === 'FLAGGED').length;
      const byPurpose: Record<string, number> = {};
      for (const v of visitors || []) {
        const purpose = v.purpose || 'Other';
        byPurpose[purpose] = (byPurpose[purpose] || 0) + 1;
      }
      return { total, checkedOut, stillOnSite: total - checkedOut, screened, flagged, byPurpose };
    },
  });

  const isLoading = incidentLoading || complianceLoading || visitorLoading;

  const handleExportCsv = () => {
    const timestamp = new Date().toISOString().slice(0, 10);

    if (reportType === 'incident' && incidentData) {
      const headers = ['ID', 'Level', 'Status', 'Message', 'Created At', 'Updated At'];
      const rows = (incidentData.rawAlerts || []).map((a: any) => [
        a.id || '',
        a.level || '',
        a.status || '',
        a.message || '',
        formatDate(a.createdAt),
        formatDate(a.updatedAt),
      ]);
      exportToCsv(`incidents_${timestamp}`, headers, rows);
    } else if (reportType === 'compliance' && complianceData) {
      const headers = ['Drill Type', 'Required', 'Completed', 'Compliant'];
      const rows = (complianceData.requirements || []).map((r: any) => [
        r.label || r.type || '',
        String(r.required),
        String(r.completed),
        r.compliant ? 'Yes' : 'No',
      ]);
      exportToCsv(`compliance_${timestamp}`, headers, rows);
    } else if (reportType === 'visitor' && visitorData) {
      const headers = ['Purpose', 'Count'];
      const rows = Object.entries(visitorData.byPurpose).map(([purpose, count]) => [
        purpose,
        String(count),
      ]);
      rows.push(['---', '---']);
      rows.push(['Total Visitors', String(visitorData.total)]);
      rows.push(['Checked Out', String(visitorData.checkedOut)]);
      rows.push(['Still On Site', String(visitorData.stillOnSite)]);
      rows.push(['Screened', String(visitorData.screened)]);
      rows.push(['Flagged', String(visitorData.flagged)]);
      exportToCsv(`visitor_activity_${timestamp}`, headers, rows);
    }
  };

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const title = REPORT_TYPES.find(r => r.key === reportType)?.label || 'Report';
    printWindow.document.write(`<!DOCTYPE html><html><head><title>SafeSchool - ${title}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #1a1a1a; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #2563eb; padding-bottom: 15px; }
        .header h1 { font-size: 24px; color: #1e3a5f; }
        .header p { color: #666; font-size: 14px; margin-top: 5px; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
        .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
        .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
        .card-value { font-size: 28px; font-weight: 700; }
        .card-label { font-size: 12px; color: #6b7280; margin-top: 4px; }
        .section { margin-bottom: 24px; }
        .section h3 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
        th { font-weight: 600; background: #f9fafb; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
        .badge-green { background: #dcfce7; color: #166534; }
        .badge-red { background: #fee2e2; color: #991b1b; }
        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 15px; }
        @media print { body { padding: 20px; } }
      </style></head><body>
      <div class="header">
        <h1>SafeSchool OS - ${title}</h1>
        <p>Period: ${dateRange.start} to ${dateRange.end} | Generated: ${new Date().toLocaleString()}</p>
      </div>`);

    // Render report-specific content
    if (reportType === 'incident' && incidentData) {
      printWindow.document.write(`
        <div class="grid">
          <div class="card"><div class="card-value">${incidentData.totalAlerts}</div><div class="card-label">Total Incidents</div></div>
          <div class="card"><div class="card-value" style="color:#dc2626">${incidentData.lockdowns}</div><div class="card-label">Lockdowns/Active Threats</div></div>
          <div class="card"><div class="card-value" style="color:#16a34a">${incidentData.byStatus?.RESOLVED || 0}</div><div class="card-label">Resolved</div></div>
          <div class="card"><div class="card-value" style="color:#ca8a04">${incidentData.totalAlerts - (incidentData.byStatus?.RESOLVED || 0) - (incidentData.byStatus?.CANCELLED || 0)}</div><div class="card-label">Active/Pending</div></div>
        </div>
        <div class="grid-2">
          <div class="section"><h3>By Alert Level</h3><table><tr><th>Level</th><th>Count</th></tr>
            ${Object.entries(incidentData.byLevel).map(([l, c]) => `<tr><td>${l}</td><td>${c}</td></tr>`).join('')}
          </table></div>
          <div class="section"><h3>By Status</h3><table><tr><th>Status</th><th>Count</th></tr>
            ${Object.entries(incidentData.byStatus).map(([s, c]) => `<tr><td>${s}</td><td>${c}</td></tr>`).join('')}
          </table></div>
        </div>`);
    } else if (reportType === 'compliance' && complianceData) {
      printWindow.document.write(`
        <div style="margin-bottom:20px"><span class="badge ${complianceData.overallCompliant ? 'badge-green' : 'badge-red'}">${complianceData.overallCompliant ? 'COMPLIANT' : 'NOT COMPLIANT'}</span>
        <span style="margin-left:10px;font-weight:600">${complianceData.year} Alyssa's Law Compliance</span></div>
        <table><tr><th>Drill Type</th><th>Required</th><th>Completed</th><th>Status</th></tr>
          ${(complianceData.requirements || []).map((r: any) => `<tr><td>${r.label}</td><td>${r.required}</td><td>${r.completed}</td><td><span class="badge ${r.compliant ? 'badge-green' : 'badge-red'}">${r.compliant ? 'MET' : 'NOT MET'}</span></td></tr>`).join('')}
        </table>
        <div style="margin-top:16px;font-size:13px;color:#666">Total drills: ${complianceData.totalDrills}</div>`);
    } else if (reportType === 'visitor' && visitorData) {
      printWindow.document.write(`
        <div class="grid">
          <div class="card"><div class="card-value">${visitorData.total}</div><div class="card-label">Total Visitors</div></div>
          <div class="card"><div class="card-value" style="color:#16a34a">${visitorData.checkedOut}</div><div class="card-label">Checked Out</div></div>
          <div class="card"><div class="card-value" style="color:#ca8a04">${visitorData.stillOnSite}</div><div class="card-label">Still On Site</div></div>
          <div class="card"><div class="card-value" style="color:#2563eb">${visitorData.screened}</div><div class="card-label">Screened</div></div>
        </div>
        ${visitorData.flagged > 0 ? `<div style="color:#dc2626;font-weight:600;margin-bottom:16px">Flagged Visitors: ${visitorData.flagged}</div>` : ''}
        <div class="section"><h3>By Purpose</h3><table><tr><th>Purpose</th><th>Count</th></tr>
          ${Object.entries(visitorData.byPurpose).map(([p, c]) => `<tr><td>${p}</td><td>${c}</td></tr>`).join('')}
        </table></div>`);
    }

    printWindow.document.write(`
      <div class="footer">SafeSchool OS | Alyssa's Law Compliant School Safety Platform | Confidential</div>
      </body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

  const REPORT_TYPES: { key: ReportType; label: string }[] = [
    { key: 'incident', label: 'Incident Summary' },
    { key: 'compliance', label: 'Drill Compliance' },
    { key: 'visitor', label: 'Visitor Activity' },
  ];

  // Chart data transforms
  const levelChartData = incidentData
    ? Object.entries(incidentData.byLevel).map(([name, value]) => ({ name, value: value as number }))
    : [];
  const statusChartData = incidentData
    ? Object.entries(incidentData.byStatus).map(([name, value]) => ({ name, value: value as number }))
    : [];
  const trendData = incidentData
    ? Object.entries(incidentData.byDay).sort().map(([date, count]) => ({
        date: date.slice(5), // MM-DD
        incidents: count as number,
      }))
    : [];
  const complianceChartData = complianceData
    ? (complianceData.requirements || []).map((r: any) => ({
        name: r.label,
        completed: r.completed,
        required: r.required,
        fill: r.compliant ? '#22c55e' : '#ef4444',
      }))
    : [];
  const visitorPieData = visitorData
    ? [
        { name: 'Checked Out', value: visitorData.checkedOut },
        { name: 'On Site', value: visitorData.stillOnSite },
        ...(visitorData.flagged > 0 ? [{ name: 'Flagged', value: visitorData.flagged }] : []),
      ].filter(d => d.value > 0)
    : [];
  const purposeChartData = visitorData
    ? Object.entries(visitorData.byPurpose).map(([name, value]) => ({ name, count: value as number }))
    : [];

  return (
    <div className="p-6" ref={printRef}>
      {/* Report Type Selector + Actions */}
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
        <div className="flex items-center gap-3">
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
          <button
            onClick={handleExportCsv}
            className="ml-2 px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Export PDF
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ===== INCIDENT REPORT ===== */}
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

          {/* Trend Chart */}
          {trendData.length > 1 && (
            <div className="bg-gray-800 rounded-lg p-4 mb-6">
              <h3 className="font-semibold mb-4">Incident Trend</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                    labelStyle={{ color: '#e5e7eb' }}
                  />
                  <Bar dataKey="incidents" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Pie Charts */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-semibold mb-3">By Alert Level</h3>
              {levelChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={levelChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                      {levelChartData.map((entry) => (
                        <Cell key={entry.name} fill={LEVEL_COLORS[entry.name] || '#6b7280'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-gray-500 text-sm py-8 text-center">No incidents in this period</div>
              )}
            </div>

            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-semibold mb-3">By Status</h3>
              {statusChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={statusChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                      {statusChartData.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#6b7280'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-gray-500 text-sm py-8 text-center">No incidents in this period</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== COMPLIANCE REPORT ===== */}
      {reportType === 'compliance' && complianceData && !complianceLoading && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-lg font-semibold">{complianceData.year} Alyssa's Law Compliance</h2>
            <span className={`px-3 py-1 rounded text-xs font-bold ${complianceData.overallCompliant ? 'bg-green-600' : 'bg-red-600'}`}>
              {complianceData.overallCompliant ? 'COMPLIANT' : 'NOT COMPLIANT'}
            </span>
          </div>

          {/* Radial bar chart for compliance */}
          {complianceChartData.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4 mb-6">
              <h3 className="font-semibold mb-4">Drill Completion</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={complianceChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} width={120} />
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                  <Bar dataKey="completed" name="Completed" radius={[0, 4, 4, 0]}>
                    {complianceChartData.map((entry: any, i: number) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                  <Bar dataKey="required" name="Required" fill="#374151" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

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

      {/* ===== VISITOR REPORT ===== */}
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

          <div className="grid grid-cols-2 gap-6">
            {/* Visitor status pie */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-semibold mb-3">Visitor Status</h3>
              {visitorPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={visitorPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {visitorPieData.map((_, i) => (
                        <Cell key={i} fill={VISITOR_COLORS[i % VISITOR_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-gray-500 text-sm py-8 text-center">No visitors for this date</div>
              )}
            </div>

            {/* By purpose bar chart */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-semibold mb-3">By Purpose</h3>
              {purposeChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={purposeChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} width={140} />
                    <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-gray-500 text-sm py-8 text-center">No visitors for this date</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
