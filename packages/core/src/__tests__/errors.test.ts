import { describe, it, expect } from 'vitest';
import {
  EdgeRuntimeError,
  ActivationError,
  SyncError,
  ModuleError,
  ConnectorError,
} from '../errors.js';

describe('EdgeRuntimeError', () => {
  it('should set message and code', () => {
    const err = new EdgeRuntimeError('something broke', 'GENERIC');
    expect(err.message).toBe('something broke');
    expect(err.code).toBe('GENERIC');
    expect(err.name).toBe('EdgeRuntimeError');
  });

  it('should be an instance of Error', () => {
    const err = new EdgeRuntimeError('test', 'TEST');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EdgeRuntimeError);
  });
});

describe('ActivationError', () => {
  it('should set code to ACTIVATION_ERROR', () => {
    const err = new ActivationError('invalid key');
    expect(err.code).toBe('ACTIVATION_ERROR');
    expect(err.name).toBe('ActivationError');
    expect(err.message).toBe('invalid key');
  });

  it('should be an instance of EdgeRuntimeError', () => {
    const err = new ActivationError('bad key');
    expect(err).toBeInstanceOf(EdgeRuntimeError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('SyncError', () => {
  it('should set code to SYNC_ERROR', () => {
    const err = new SyncError('sync failed');
    expect(err.code).toBe('SYNC_ERROR');
    expect(err.name).toBe('SyncError');
  });

  it('should store statusCode', () => {
    const err = new SyncError('unauthorized', 401);
    expect(err.statusCode).toBe(401);
    expect(err.isTimeout).toBe(false);
  });

  it('should store isTimeout flag', () => {
    const err = new SyncError('timed out', 504, true);
    expect(err.isTimeout).toBe(true);
    expect(err.statusCode).toBe(504);
  });

  it('should default isTimeout to false', () => {
    const err = new SyncError('fail', 500);
    expect(err.isTimeout).toBe(false);
  });

  it('should allow undefined statusCode', () => {
    const err = new SyncError('network error');
    expect(err.statusCode).toBeUndefined();
  });
});

describe('ModuleError', () => {
  it('should set code to MODULE_ERROR and store moduleName', () => {
    const err = new ModuleError('load failed', 'safeschool');
    expect(err.code).toBe('MODULE_ERROR');
    expect(err.name).toBe('ModuleError');
    expect(err.moduleName).toBe('safeschool');
  });

  it('should be an instance of EdgeRuntimeError', () => {
    const err = new ModuleError('err', 'mod');
    expect(err).toBeInstanceOf(EdgeRuntimeError);
  });
});

describe('ConnectorError', () => {
  it('should set code to CONNECTOR_ERROR and store connectorName', () => {
    const err = new ConnectorError('poll failed', 'lenel-pacs');
    expect(err.code).toBe('CONNECTOR_ERROR');
    expect(err.name).toBe('ConnectorError');
    expect(err.connectorName).toBe('lenel-pacs');
  });

  it('should be an instance of EdgeRuntimeError', () => {
    const err = new ConnectorError('err', 'conn');
    expect(err).toBeInstanceOf(EdgeRuntimeError);
  });
});
