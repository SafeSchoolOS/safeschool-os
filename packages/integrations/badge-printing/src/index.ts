export type { BadgePrinterAdapter, BadgePrintRequest, BadgePrintResult } from './types.js';
export { ConsoleBadgePrinterAdapter } from './adapters/console.js';
export { HttpBadgePrinterAdapter } from './adapters/http.js';

import type { BadgePrinterAdapter } from './types.js';
import { ConsoleBadgePrinterAdapter } from './adapters/console.js';
import { HttpBadgePrinterAdapter } from './adapters/http.js';

export function createBadgePrinter(): BadgePrinterAdapter | null {
  if (process.env.BADGE_PRINTER_ENABLED !== 'true') {
    return null;
  }

  const url = process.env.BADGE_PRINTER_URL;
  if (url) {
    return new HttpBadgePrinterAdapter(url);
  }

  return new ConsoleBadgePrinterAdapter();
}
