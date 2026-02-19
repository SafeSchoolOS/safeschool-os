export interface VisitorScreeningAdapter {
  name: string;
  screen(input: ScreeningInput): Promise<ScreeningAdapterResult>;
}

export interface ScreeningInput {
  firstName: string;
  lastName: string;
  idType?: string;
  idNumber?: string;
  dateOfBirth?: string;
  state?: string;
}

export interface ScreeningAdapterResult {
  sexOffenderCheck: 'CLEAR' | 'FLAGGED' | 'ERROR';
  watchlistCheck: 'CLEAR' | 'FLAGGED' | 'ERROR';
  customCheck?: 'CLEAR' | 'FLAGGED' | 'ERROR';
  checkedAt: Date;
}

export { ConsoleScreeningAdapter } from './adapters/console.js';
export { InformDataSorAdapter } from './adapters/informdata-sor.js';
export { VisitorService } from './visitor-service.js';
export { BadgeKioskClient } from './adapters/badgekiosk.js';
export type { BadgeKioskConfig, BKCardholder, BKTemplate, BKPrintServer, BKPrintJob, BKFeatureFlags, BKCheckpoint, BKValidationResult, BKSessionStats } from './adapters/badgekiosk.js';
