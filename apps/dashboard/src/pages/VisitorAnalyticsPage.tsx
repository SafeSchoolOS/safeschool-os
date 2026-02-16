import { useState } from 'react';
import {
  useVisitorAnalyticsSummary,
  useVisitorAnalyticsPeakTimes,
  useVisitorAnalyticsFrequent,
} from '../api/visitors';

type DateRange = 7 | 30 | 90;

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-gray-800 dark:bg-gray-900 rounded-xl border border-gray-700 dark:border-gray-800 p-5">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export function VisitorAnalyticsPage() {
  const [days, setDays] = useState<DateRange>(30);

  const { data: summary, isLoading: summaryLoading, error: summaryError } = useVisitorAnalyticsSummary();
  const { data: peakTimes, isLoading: peakLoading } = useVisitorAnalyticsPeakTimes(days);
  const { data: frequent, isLoading: frequentLoading } = useVisitorAnalyticsFrequent(20);

  const summaryData = summary || {};
  const peakData: { hour: number; count: number }[] = peakTimes?.hours || peakTimes || [];
  const frequentData: { name: string; count: number }[] = frequent?.visitors || frequent || [];

  const maxPeak = peakData.length > 0 ? Math.max(...peakData.map((d) => d.count), 1) : 1;

  // Derive visitor type distribution from summary if available
  const typeDistribution: { type: string; count: number; color: string }[] =
    summaryData.typeDistribution || [];
  const totalTypeCount = typeDistribution.reduce((sum: number, t: any) => sum + t.count, 0) || 1;

  const TYPE_COLORS: Record<string, string> = {
    VISITOR: 'bg-blue-500',
    CONTRACTOR: 'bg-orange-500',
    PARENT: 'bg-green-500',
    VENDOR: 'bg-purple-500',
    OTHER: 'bg-gray-500',
  };

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-6 sm:space-y-8">
      {/* Header with date range selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Visitor Analytics</h1>
          <p className="text-sm text-gray-400 mt-1">Insights into visitor traffic and patterns.</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-800 dark:bg-gray-900 rounded-lg border border-gray-700 dark:border-gray-800 p-1">
          {([7, 30, 90] as DateRange[]).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                days === d
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      {summaryLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-gray-400 text-sm">Loading analytics...</span>
        </div>
      )}

      {summaryError && (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-sm text-red-400">
          Failed to load visitor analytics. Please try again.
        </div>
      )}

      {!summaryLoading && !summaryError && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Total Today" value={summaryData.totalToday ?? 0} />
          <KpiCard label="Currently In Building" value={summaryData.currentlyInBuilding ?? 0} />
          <KpiCard
            label="Avg Duration"
            value={summaryData.avgDurationMinutes != null ? `${Math.round(summaryData.avgDurationMinutes)}m` : '--'}
            sub="minutes per visit"
          />
          <KpiCard label="This Month" value={summaryData.totalThisMonth ?? 0} />
        </div>
      )}

      {/* Peak Hours Chart */}
      <section className="bg-gray-800 dark:bg-gray-900 rounded-xl border border-gray-700 dark:border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Peak Hours (Last {days} Days)</h2>

        {peakLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-gray-400 text-sm">Loading peak times...</span>
          </div>
        )}

        {!peakLoading && peakData.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">No peak time data available.</div>
        )}

        {!peakLoading && peakData.length > 0 && (
          <div className="flex items-end gap-1 h-48">
            {peakData.map((item) => {
              const height = (item.count / maxPeak) * 100;
              const hourLabel = item.hour < 12 ? `${item.hour || 12}a` : `${item.hour === 12 ? 12 : item.hour - 12}p`;
              return (
                <div key={item.hour} className="flex flex-col items-center flex-1 h-full justify-end group">
                  <span className="text-xs text-gray-400 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.count}
                  </span>
                  <div
                    className="w-full bg-blue-600 hover:bg-blue-500 rounded-t transition-colors min-h-[2px]"
                    style={{ height: `${Math.max(height, 1)}%` }}
                  />
                  <span className="text-[10px] text-gray-500 mt-1">{hourLabel}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Visitor Types Distribution */}
      {typeDistribution.length > 0 && (
        <section className="bg-gray-800 dark:bg-gray-900 rounded-xl border border-gray-700 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Visitor Types</h2>
          <div className="space-y-3">
            {typeDistribution.map((item: any) => {
              const pct = ((item.count / totalTypeCount) * 100).toFixed(1);
              const color = TYPE_COLORS[item.type] || TYPE_COLORS.OTHER;
              return (
                <div key={item.type}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-300">{item.type}</span>
                    <span className="text-sm text-gray-400">
                      {item.count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${color} rounded-full transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Frequent Visitors Table */}
      <section className="bg-gray-800 dark:bg-gray-900 rounded-xl border border-gray-700 dark:border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Frequent Visitors</h2>

        {frequentLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-gray-400 text-sm">Loading frequent visitors...</span>
          </div>
        )}

        {!frequentLoading && frequentData.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">No frequent visitor data available.</div>
        )}

        {!frequentLoading && frequentData.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="py-3 px-4 text-left text-sm font-medium text-gray-400">#</th>
                  <th className="py-3 px-4 text-left text-sm font-medium text-gray-400">Visitor</th>
                  <th className="py-3 px-4 text-right text-sm font-medium text-gray-400">Visits</th>
                </tr>
              </thead>
              <tbody>
                {frequentData.map((visitor: any, idx: number) => (
                  <tr
                    key={visitor.name + idx}
                    className="border-b border-gray-700/50 hover:bg-gray-700/20 transition-colors"
                  >
                    <td className="py-3 px-4 text-sm text-gray-500">{idx + 1}</td>
                    <td className="py-3 px-4 text-sm text-white">{visitor.name}</td>
                    <td className="py-3 px-4 text-sm text-gray-300 text-right">{visitor.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
