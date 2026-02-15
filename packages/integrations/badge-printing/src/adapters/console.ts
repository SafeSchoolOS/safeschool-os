import type { BadgePrinterAdapter, BadgePrintRequest, BadgePrintResult } from '../types.js';

export class ConsoleBadgePrinterAdapter implements BadgePrinterAdapter {
  async print(request: BadgePrintRequest): Promise<BadgePrintResult> {
    console.log('[BadgePrinter:Console] Printing ID card:', {
      name: request.studentName,
      number: request.studentNumber,
      grade: request.grade,
      school: request.schoolName,
      hasPhoto: !!request.photoUrl,
    });
    return { success: true, jobId: `console-${Date.now()}` };
  }

  async getStatus(): Promise<{ online: boolean; queueLength: number }> {
    return { online: true, queueLength: 0 };
  }
}
