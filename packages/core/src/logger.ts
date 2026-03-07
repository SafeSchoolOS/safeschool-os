/**
 * Shared logger (pino) for EdgeRuntime
 */

import pino from 'pino';

export const logger = pino({
  name: 'edgeruntime',
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
});

export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}
