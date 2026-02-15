import type { BadgePrinterAdapter, BadgePrintRequest, BadgePrintResult } from '../types.js';

export class HttpBadgePrinterAdapter implements BadgePrinterAdapter {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async print(request: BadgePrintRequest): Promise<BadgePrintResult> {
    const res = await fetch(`${this.baseUrl}/api/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'Unknown error');
      return { success: false, error: `Print service returned ${res.status}: ${err}` };
    }

    const data = await res.json() as { jobId?: string };
    return { success: true, jobId: data.jobId };
  }

  async getStatus(): Promise<{ online: boolean; queueLength: number }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/status`);
      if (!res.ok) return { online: false, queueLength: 0 };
      const data = await res.json() as { queueLength?: number };
      return { online: true, queueLength: data.queueLength ?? 0 };
    } catch {
      return { online: false, queueLength: 0 };
    }
  }
}
