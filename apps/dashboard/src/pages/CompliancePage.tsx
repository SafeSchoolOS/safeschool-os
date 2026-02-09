import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { useSites } from '../api/sites';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface EvidenceItem {
  type: string;
  description: string;
  timestamp?: string;
  id?: string;
}

interface ComplianceSection {
  name: string;
  requirement: string;
  status: 'COMPLIANT' | 'NON_COMPLIANT' | 'PARTIAL';
  details: string;
  evidence: EvidenceItem[];
}

interface ComplianceReport {
  siteId: string;
  siteName: string;
  state: string;
  stateName: string;
  statute: string;
  year: number;
  generatedAt: string;
  overallStatus: 'COMPLIANT' | 'NON_COMPLIANT' | 'PARTIAL';
  sections: ComplianceSection[];
}

interface SupportedState {
  code: string;
  name: string;
  statute: string;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: string }> = {
  COMPLIANT: {
    label: 'Compliant',
    bg: 'bg-green-600/20',
    text: 'text-green-400',
    icon: 'M5 13l4 4L19 7',
  },
  NON_COMPLIANT: {
    label: 'Non-Compliant',
    bg: 'bg-red-600/20',
    text: 'text-red-400',
    icon: 'M6 18L18 6M6 6l12 12',
  },
  PARTIAL: {
    label: 'Partial',
    bg: 'bg-yellow-600/20',
    text: 'text-yellow-400',
    icon: 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.NON_COMPLIANT;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${config.bg} ${config.text}`}>
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d={config.icon} />
      </svg>
      {config.label}
    </span>
  );
}

function EvidenceList({ evidence }: { evidence: EvidenceItem[] }) {
  if (evidence.length === 0) {
    return <div className="text-sm text-gray-500 italic">No evidence records available.</div>;
  }
  return (
    <div className="space-y-1.5">
      {evidence.map((item, idx) => (
        <div key={idx} className="flex items-start gap-2 text-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-500 mt-1.5 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-gray-300">{item.description}</span>
            {item.timestamp && (
              <span className="text-gray-500 ml-2">
                {new Date(item.timestamp).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CompliancePage() {
  const { token, user } = useAuth();
  const { data: sites } = useSites();
  const reportRef = useRef<HTMLDivElement>(null);

  const siteId = user?.siteIds[0] || '';
  const currentYear = new Date().getFullYear();

  const [selectedState, setSelectedState] = useState('NJ');
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [reportRequested, setReportRequested] = useState(false);

  // Fetch supported states
  const { data: states = [] } = useQuery<SupportedState[]>({
    queryKey: ['compliance-states'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/compliance/states`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load states');
      return res.json();
    },
  });

  // Fetch compliance report (only when requested)
  const { data: report, isLoading, error, refetch } = useQuery<ComplianceReport>({
    queryKey: ['compliance-report', siteId, selectedState, selectedYear],
    queryFn: async () => {
      const params = new URLSearchParams({
        state: selectedState,
        year: selectedYear.toString(),
      });
      const res = await fetch(`${API_URL}/api/v1/compliance/${siteId}/report?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to generate report (${res.status})`);
      }
      return res.json();
    },
    enabled: reportRequested && !!siteId,
  });

  const handleGenerate = () => {
    setReportRequested(true);
    setExpandedSections({});
    refetch();
  };

  const toggleSection = (name: string) => {
    setExpandedSections((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handlePdfExport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow || !report) return;

    const sectionHtml = report.sections
      .map(
        (section) => `
        <div style="margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
            <span style="font-size: 20px; color: ${
              section.status === 'COMPLIANT' ? '#16a34a' : section.status === 'PARTIAL' ? '#ca8a04' : '#dc2626'
            };">
              ${section.status === 'COMPLIANT' ? '\u2713' : section.status === 'PARTIAL' ? '\u26A0' : '\u2717'}
            </span>
            <h3 style="margin: 0; font-size: 16px;">${section.name}</h3>
            <span style="font-size: 12px; padding: 2px 8px; border-radius: 4px; background: ${
              section.status === 'COMPLIANT' ? '#dcfce7' : section.status === 'PARTIAL' ? '#fef9c3' : '#fee2e2'
            }; color: ${
              section.status === 'COMPLIANT' ? '#166534' : section.status === 'PARTIAL' ? '#854d0e' : '#991b1b'
            };">${section.status.replace('_', ' ')}</span>
          </div>
          <p style="font-size: 13px; color: #6b7280; margin: 4px 0 12px;"><em>Requirement:</em> ${section.requirement}</p>
          <p style="font-size: 14px; margin: 0 0 12px;">${section.details}</p>
          ${
            section.evidence.length > 0
              ? `<div style="border-top: 1px solid #e5e7eb; padding-top: 8px;">
              <div style="font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 6px;">Evidence</div>
              <ul style="list-style: disc; padding-left: 20px; margin: 0;">
                ${section.evidence
                  .map(
                    (e) =>
                      `<li style="font-size: 13px; margin-bottom: 4px;">${e.description}${
                        e.timestamp ? ` <span style="color: #9ca3af;">(${new Date(e.timestamp).toLocaleDateString()})</span>` : ''
                      }</li>`
                  )
                  .join('')}
              </ul>
            </div>`
              : ''
          }
        </div>
      `
      )
      .join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Alyssa's Law Compliance Report - ${report.siteName}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #1f2937; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="margin: 0 0 4px; font-size: 22px;">Alyssa's Law Compliance Report</h1>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">${report.siteName} | ${report.stateName} (${report.state}) | ${report.year}</p>
          <p style="margin: 4px 0 0; color: #9ca3af; font-size: 12px;">${report.statute}</p>
        </div>

        <div style="text-align: center; margin-bottom: 24px; padding: 16px; background: ${
          report.overallStatus === 'COMPLIANT' ? '#dcfce7' : report.overallStatus === 'PARTIAL' ? '#fef9c3' : '#fee2e2'
        }; border-radius: 8px;">
          <div style="font-size: 14px; color: #6b7280;">Overall Status</div>
          <div style="font-size: 24px; font-weight: bold; color: ${
            report.overallStatus === 'COMPLIANT' ? '#166534' : report.overallStatus === 'PARTIAL' ? '#854d0e' : '#991b1b'
          };">${report.overallStatus.replace('_', ' ')}</div>
        </div>

        ${sectionHtml}

        <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 11px; text-align: center;">
          Generated by SafeSchool OS on ${new Date(report.generatedAt).toLocaleString()} | This report is for internal compliance tracking purposes.
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  // Generate year options: current year and previous 4 years
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const siteName = sites?.[0]?.name || 'Site';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-1">Alyssa's Law Compliance Report</h2>
        <p className="text-sm text-gray-400">
          Generate a comprehensive compliance report evaluating your site against state-specific Alyssa's Law requirements.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-gray-800 rounded-lg p-4 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Site</label>
            <div className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm min-w-[180px]">
              {siteName}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">State</label>
            <select
              value={selectedState}
              onChange={(e) => {
                setSelectedState(e.target.value);
                setReportRequested(false);
              }}
              className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm min-w-[160px]"
            >
              {states.length > 0
                ? states.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name} ({s.code})
                    </option>
                  ))
                : ['NJ', 'FL', 'NY', 'TX', 'OK'].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Year</label>
            <select
              value={selectedYear}
              onChange={(e) => {
                setSelectedYear(parseInt(e.target.value));
                setReportRequested(false);
              }}
              className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm min-w-[100px]"
            >
              {yearOptions.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isLoading || !siteId}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Generate Report
              </>
            )}
          </button>

          {report && (
            <button
              onClick={handlePdfExport}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print / PDF
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-red-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium">{(error as Error).message}</span>
          </div>
        </div>
      )}

      {/* Report Content */}
      {report && (
        <div ref={reportRef}>
          {/* Overall Status Banner */}
          <div
            className={`rounded-lg p-5 mb-6 border ${
              report.overallStatus === 'COMPLIANT'
                ? 'bg-green-900/20 border-green-700'
                : report.overallStatus === 'PARTIAL'
                  ? 'bg-yellow-900/20 border-yellow-700'
                  : 'bg-red-900/20 border-red-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-400 mb-1">
                  {report.siteName} &mdash; {report.stateName} ({report.state})
                </div>
                <div className="text-lg font-bold mb-1">
                  {report.year} Alyssa's Law Compliance
                </div>
                <div className="text-xs text-gray-500">{report.statute}</div>
              </div>
              <div className="text-right">
                <StatusBadge status={report.overallStatus} />
                <div className="text-xs text-gray-500 mt-2">
                  {report.sections.filter((s) => s.status === 'COMPLIANT').length}/{report.sections.length} sections compliant
                </div>
              </div>
            </div>
          </div>

          {/* Section Summary Cards */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            {report.sections.map((section) => {
              const cfg = STATUS_CONFIG[section.status];
              return (
                <button
                  key={section.name}
                  onClick={() => toggleSection(section.name)}
                  className={`${cfg.bg} rounded-lg p-3 text-left transition-all hover:ring-1 hover:ring-gray-600`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <svg className={`w-4 h-4 ${cfg.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={cfg.icon} />
                    </svg>
                    <span className={`text-xs font-bold ${cfg.text}`}>{cfg.label}</span>
                  </div>
                  <div className="text-xs text-gray-300 truncate">{section.name}</div>
                </button>
              );
            })}
          </div>

          {/* Detailed Sections */}
          <div className="space-y-3">
            {report.sections.map((section) => {
              const isExpanded = expandedSections[section.name] ?? false;
              return (
                <div key={section.name} className="bg-gray-800 rounded-lg overflow-hidden">
                  {/* Section Header */}
                  <button
                    onClick={() => toggleSection(section.name)}
                    className="w-full flex items-center justify-between p-4 hover:bg-gray-750 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <StatusBadge status={section.status} />
                      <span className="font-semibold">{section.name}</span>
                    </div>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-700">
                      {/* Requirement */}
                      <div className="mt-3 mb-3">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                          State Requirement
                        </div>
                        <p className="text-sm text-gray-400">{section.requirement}</p>
                      </div>

                      {/* Assessment */}
                      <div className="mb-4">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                          Assessment
                        </div>
                        <p className="text-sm text-gray-300">{section.details}</p>
                      </div>

                      {/* Evidence */}
                      <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Evidence ({section.evidence.length} record{section.evidence.length !== 1 ? 's' : ''})
                        </div>
                        <div className="bg-gray-900/50 rounded-lg p-3">
                          <EvidenceList evidence={section.evidence} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-6 text-center text-xs text-gray-600">
            Report generated on {new Date(report.generatedAt).toLocaleString()} by SafeSchool OS.
            This report is for internal compliance tracking purposes and does not constitute legal certification.
          </div>
        </div>
      )}

      {/* Empty State */}
      {!report && !isLoading && !error && (
        <div className="text-center py-16">
          <svg className="w-16 h-16 mx-auto text-gray-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-lg font-semibold text-gray-400 mb-2">No Report Generated</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Select a state and year, then click "Generate Report" to evaluate your site's compliance
            with Alyssa's Law requirements.
          </p>
        </div>
      )}
    </div>
  );
}
