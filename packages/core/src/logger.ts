/**
 * Shared logger (pino) for EdgeRuntime
 */

import pino from 'pino';

// Pino transports use worker threads which don't work in esbuild bundles.
// Disable transports in production or when running as a single-file bundle.
declare const __BUNDLE_MODE__: boolean | undefined;
const useTransport =
  process.env.NODE_ENV !== 'production' &&
  (typeof __BUNDLE_MODE__ === 'undefined' || !__BUNDLE_MODE__);

export const logger = pino({
  name: 'edgeruntime',
  level: process.env.LOG_LEVEL ?? 'info',
  transport: useTransport
    ? { target: 'pino/file', options: { destination: 1 } }
    : undefined,
});

export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}
