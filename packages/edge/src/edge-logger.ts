/**
 * Lightweight logger for @safeschool/edge
 *
 * Mirrors the createLogger pattern from @edgeruntime/core but uses
 * a simple console-based logger to avoid pulling in pino as a dependency.
 */

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
}

export function createLogger(name: string): Logger {
  const prefix = `[${name}]`;
  return {
    info(objOrMsg: unknown, msg?: string) {
      if (typeof objOrMsg === 'string') {
        console.log(`${prefix} ${objOrMsg}`);
      } else {
        console.log(`${prefix} ${msg ?? ''}`, objOrMsg);
      }
    },
    warn(objOrMsg: unknown, msg?: string) {
      if (typeof objOrMsg === 'string') {
        console.warn(`${prefix} ${objOrMsg}`);
      } else {
        console.warn(`${prefix} ${msg ?? ''}`, objOrMsg);
      }
    },
    error(objOrMsg: unknown, msg?: string) {
      if (typeof objOrMsg === 'string') {
        console.error(`${prefix} ${objOrMsg}`);
      } else {
        console.error(`${prefix} ${msg ?? ''}`, objOrMsg);
      }
    },
    debug(objOrMsg: unknown, msg?: string) {
      if (typeof objOrMsg === 'string') {
        console.debug(`${prefix} ${objOrMsg}`);
      } else {
        console.debug(`${prefix} ${msg ?? ''}`, objOrMsg);
      }
    },
  };
}

export class SyncError extends Error {
  readonly statusCode?: number;
  readonly isTimeout: boolean;

  constructor(message: string, statusCode?: number, isTimeout = false) {
    super(message);
    this.name = 'SyncError';
    this.statusCode = statusCode;
    this.isTimeout = isTimeout;
  }
}

export class ConnectorError extends Error {
  readonly connectorName: string;

  constructor(message: string, connectorName: string) {
    super(message);
    this.name = 'ConnectorError';
    this.connectorName = connectorName;
  }
}
