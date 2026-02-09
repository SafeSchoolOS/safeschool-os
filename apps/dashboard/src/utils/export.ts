/**
 * CSV/JSON export utilities for SafeSchool dashboard.
 */

/**
 * Escape a CSV field value. Wraps the value in double quotes if it contains
 * commas, double quotes, or newlines. Internal double quotes are doubled.
 */
function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Build a CSV string from headers and rows, triggering a browser download.
 */
export function exportToCsv(filename: string, headers: string[], rows: string[][]): void {
  const headerLine = headers.map(escapeCsvField).join(',');
  const bodyLines = rows.map((row) => row.map(escapeCsvField).join(','));
  const csvContent = [headerLine, ...bodyLines].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

/**
 * Export arbitrary data as a JSON file download.
 */
export function exportToJson(filename: string, data: unknown): void {
  const jsonContent = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.json') ? filename : `${filename}.json`);
}

/**
 * Format an ISO date string to a human-readable format for export.
 * Returns "N/A" for falsy input.
 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return 'N/A';
  try {
    const d = new Date(date);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return date;
  }
}

/**
 * Create a temporary anchor element and trigger a file download.
 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
