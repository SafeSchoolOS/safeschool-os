import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';

interface AnalyticsSummary {
  totalEvents: number;
  anomaliesDetected: number;
  activeAlerts: number;
  complianceScore: number;
}

interface Alert {
  id: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  doorName?: string;
  timestamp: string;
}

interface Analytics {
  summary: AnalyticsSummary;
  trends: Array<{ period: string; events: number; anomalies: number }>;
  heatmap: Array<{ doorId: string; doorName: string; hourlyActivity: number[] }>;
  topAnomalies: Array<{ type: string; count: number; lastSeen: string }>;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
  HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  LOW: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

export function AccessAnalyticsPage() {
  const [timeRange, setTimeRange] = useState('7d');

  const getDateRange = () => {
    const end = new Date().toISOString();
    const start = new Date();
    if (timeRange === '24h') start.setHours(start.getHours() - 24);
    else if (timeRange === '7d') start.setDate(start.getDate() - 7);
    else if (timeRange === '30d') start.setDate(start.getDate() - 30);
    return { start: start.toISOString(), end };
  };

  const { data: config } = useQuery({
    queryKey: ['badgeguard', 'config'],
    queryFn: () => apiClient.get('/api/v1/badgeguard/config'),
  });

  const { start, end } = getDateRange();

  const { data: analytics, isLoading: analyticsLoading } = useQuery<Analytics>({
    queryKey: ['badgeguard', 'analytics', timeRange],
    queryFn: () =>
      apiClient.get(`/api/v1/badgeguard/analytics?start=${start}&end=${end}`),
    enabled: config?.configured && config?.enabled,
  });

  const { data: alertsData, isLoading: alertsLoading } = useQuery<{ alerts: Alert[]; total: number }>({
    queryKey: ['badgeguard', 'alerts'],
    queryFn: () =>
      apiClient.get('/api/v1/badgeguard/alerts?limit=20'),
    enabled: config?.configured && config?.enabled,
  });

  // Not configured state
  if (config && !config.configured) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="dark:bg-gray-800 bg-white rounded-xl p-8 text-center dark:border-gray-700 border-gray-200 border">
          <svg className="w-16 h-16 mx-auto dark:text-gray-600 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h2 className="text-xl font-semibold mb-2">Access Control Analytics</h2>
          <p className="dark:text-gray-400 text-gray-500 mb-6">
            Connect to BadgeGuard to get AI-powered anomaly detection for your access control system.
            Detect impossible travel, reader attacks, after-hours access, and more.
          </p>
          <Link
            to="/access-analytics/settings"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Configure Integration
          </Link>
        </div>
      </div>
    );
  }

  const summary = analytics?.summary;
  const alerts = alertsData?.alerts || [];
  const isLoading = analyticsLoading || alertsLoading;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Access Control Analytics</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500">
            Powered by BadgeGuard — anomaly detection for badge access events
          </p>
        </div>
        <div className="flex items-center gap-2">
          {['24h', '7d', '30d'].map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'dark:bg-gray-700 bg-gray-200 dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'
              }`}
            >
              {range}
            </button>
          ))}
          <Link
            to="/access-analytics/settings"
            className="p-2 dark:hover:bg-gray-700 hover:bg-gray-200 rounded-lg transition-colors dark:text-gray-400 text-gray-500"
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard label="Total Events" value={summary?.totalEvents ?? 0} color="blue" />
            <SummaryCard label="Anomalies" value={summary?.anomaliesDetected ?? 0} color="orange" />
            <SummaryCard label="Active Alerts" value={summary?.activeAlerts ?? 0} color="red" />
            <SummaryCard
              label="Compliance"
              value={summary?.complianceScore != null ? `${summary.complianceScore}%` : '--'}
              color="green"
            />
          </div>

          {/* Alerts */}
          <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border">
            <div className="px-4 py-3 dark:border-gray-700 border-gray-200 border-b flex items-center justify-between">
              <h3 className="font-semibold">Anomaly Alerts</h3>
              <span className="text-sm dark:text-gray-400 text-gray-500">{alertsData?.total ?? 0} total</span>
            </div>
            {alerts.length === 0 ? (
              <div className="p-8 text-center dark:text-gray-500 text-gray-400">
                No anomaly alerts detected. Your access control system is operating normally.
              </div>
            ) : (
              <div className="divide-y dark:divide-gray-700 divide-gray-200">
                {alerts.map((alert) => (
                  <div key={alert.id} className="px-4 py-3 flex items-start gap-3">
                    <span
                      className={`mt-0.5 px-2 py-0.5 text-xs font-medium rounded border ${
                        SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.LOW
                      }`}
                    >
                      {alert.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{alert.title}</div>
                      <div className="text-sm dark:text-gray-400 text-gray-500 truncate">
                        {alert.description}
                      </div>
                      {alert.doorName && (
                        <div className="text-xs dark:text-gray-500 text-gray-400 mt-1">
                          Door: {alert.doorName}
                        </div>
                      )}
                    </div>
                    <div className="text-xs dark:text-gray-500 text-gray-400 whitespace-nowrap">
                      {new Date(alert.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Trends + Top Anomalies */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Usage Trends */}
            <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border">
              <div className="px-4 py-3 dark:border-gray-700 border-gray-200 border-b">
                <h3 className="font-semibold">Usage Trends</h3>
              </div>
              {analytics?.trends && analytics.trends.length > 0 ? (
                <div className="p-4">
                  <div className="space-y-2">
                    {analytics.trends.slice(-10).map((t) => {
                      const maxEvents = Math.max(...analytics.trends.map((x) => x.events), 1);
                      const pct = (t.events / maxEvents) * 100;
                      return (
                        <div key={t.period} className="flex items-center gap-3 text-sm">
                          <span className="w-20 dark:text-gray-400 text-gray-500 text-xs truncate">
                            {t.period}
                          </span>
                          <div className="flex-1 dark:bg-gray-700 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-500 h-2 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-12 text-right text-xs">{t.events}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center dark:text-gray-500 text-gray-400 text-sm">
                  No trend data available yet
                </div>
              )}
            </div>

            {/* Top Anomaly Types */}
            <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border">
              <div className="px-4 py-3 dark:border-gray-700 border-gray-200 border-b">
                <h3 className="font-semibold">Top Anomaly Types</h3>
              </div>
              {analytics?.topAnomalies && analytics.topAnomalies.length > 0 ? (
                <div className="divide-y dark:divide-gray-700 divide-gray-200">
                  {analytics.topAnomalies.map((a) => (
                    <div key={a.type} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{formatAnomalyType(a.type)}</div>
                        <div className="text-xs dark:text-gray-500 text-gray-400">
                          Last seen: {new Date(a.lastSeen).toLocaleDateString()}
                        </div>
                      </div>
                      <span className="text-lg font-semibold dark:text-gray-300 text-gray-700">
                        {a.count}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center dark:text-gray-500 text-gray-400 text-sm">
                  No anomalies detected yet
                </div>
              )}
            </div>
          </div>

          {/* Door Activity Heatmap */}
          {analytics?.heatmap && analytics.heatmap.length > 0 && (
            <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border">
              <div className="px-4 py-3 dark:border-gray-700 border-gray-200 border-b">
                <h3 className="font-semibold">Door Activity Heatmap</h3>
              </div>
              <div className="p-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left py-1 pr-3 dark:text-gray-400 text-gray-500 font-medium">Door</th>
                      {Array.from({ length: 24 }, (_, i) => (
                        <th key={i} className="px-0.5 py-1 dark:text-gray-500 text-gray-400 font-normal">
                          {i}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.heatmap.map((row) => {
                      const max = Math.max(...row.hourlyActivity, 1);
                      return (
                        <tr key={row.doorId}>
                          <td className="py-1 pr-3 truncate max-w-[120px]">{row.doorName}</td>
                          {row.hourlyActivity.map((val, i) => {
                            const intensity = val / max;
                            return (
                              <td key={i} className="px-0.5 py-1">
                                <div
                                  className="w-4 h-4 rounded-sm"
                                  style={{
                                    backgroundColor: intensity > 0
                                      ? `rgba(59, 130, 246, ${Math.max(0.1, intensity)})`
                                      : 'transparent',
                                  }}
                                  title={`${row.doorName} @ ${i}:00 — ${val} events`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'dark:border-blue-500/30 border-blue-300',
    orange: 'dark:border-orange-500/30 border-orange-300',
    red: 'dark:border-red-500/30 border-red-300',
    green: 'dark:border-green-500/30 border-green-300',
  };

  return (
    <div
      className={`dark:bg-gray-800 bg-white rounded-xl p-4 border ${colorMap[color] || colorMap.blue}`}
    >
      <div className="text-sm dark:text-gray-400 text-gray-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function formatAnomalyType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default AccessAnalyticsPage;
