/**
 * Shared error classes for EdgeRuntime
 */

export class EdgeRuntimeError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'EdgeRuntimeError';
    this.code = code;
  }
}

export class ActivationError extends EdgeRuntimeError {
  constructor(message: string) {
    super(message, 'ACTIVATION_ERROR');
    this.name = 'ActivationError';
  }
}

export class SyncError extends EdgeRuntimeError {
  public readonly statusCode?: number;
  public readonly isTimeout: boolean;

  constructor(message: string, statusCode?: number, isTimeout = false) {
    super(message, 'SYNC_ERROR');
    this.name = 'SyncError';
    this.statusCode = statusCode;
    this.isTimeout = isTimeout;
  }
}

export class ModuleError extends EdgeRuntimeError {
  public readonly moduleName: string;

  constructor(message: string, moduleName: string) {
    super(message, 'MODULE_ERROR');
    this.name = 'ModuleError';
    this.moduleName = moduleName;
  }
}

export class ConnectorError extends EdgeRuntimeError {
  public readonly connectorName: string;

  constructor(message: string, connectorName: string) {
    super(message, 'CONNECTOR_ERROR');
    this.name = 'ConnectorError';
    this.connectorName = connectorName;
  }
}
