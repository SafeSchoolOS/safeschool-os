export interface BadgePrintRequest {
  studentName: string;
  studentNumber: string;
  grade?: string;
  photoUrl?: string;
  schoolName: string;
  schoolYear?: string;
  additionalFields?: Record<string, string>;
}

export interface BadgePrintResult {
  success: boolean;
  jobId?: string;
  error?: string;
}

export interface BadgePrinterAdapter {
  print(request: BadgePrintRequest): Promise<BadgePrintResult>;
  getStatus(): Promise<{ online: boolean; queueLength: number }>;
}
