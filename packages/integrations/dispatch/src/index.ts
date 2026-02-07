// ---------------------------------------------------------------------------
// Core interfaces
// ---------------------------------------------------------------------------

export interface DispatchAdapter {
  name: string;
  dispatch(alert: DispatchPayload): Promise<DispatchResult>;
  getStatus(dispatchId: string): Promise<string>;
}

export interface DispatchPayload {
  alertId: string;
  siteId: string;
  level: string;
  buildingName: string;
  roomName?: string;
  floor?: number;
  latitude?: number;
  longitude?: number;
  callerInfo?: string;
}

export interface DispatchResult {
  success: boolean;
  dispatchId: string;
  method: string;
  responseTimeMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Adapter exports
// ---------------------------------------------------------------------------

export { ConsoleDispatchAdapter } from './adapters/console.js';
export { RapidSOSAdapter } from './adapters/rapidsos.js';
export type { RapidSOSConfig } from './adapters/rapidsos.js';
export { Rave911Adapter } from './adapters/rave-911.js';
export type { Rave911Config } from './adapters/rave-911.js';
export { SipDirectAdapter, buildSipInvite, parseSipResponse } from './adapters/sip-direct.js';
export type { SipDirectConfig, SipSocket } from './adapters/sip-direct.js';
export { CellularFailoverAdapter } from './adapters/cellular-failover.js';
export type { CellularFailoverConfig, SerialPortInterface } from './adapters/cellular-failover.js';

// ---------------------------------------------------------------------------
// NENA i3 exports
// ---------------------------------------------------------------------------

export { generatePidfLo, parseAddress } from './nena-i3.js';
export type { CivicAddress, GeoCoordinates, CallerInfo } from './nena-i3.js';

// ---------------------------------------------------------------------------
// DispatchChain exports
// ---------------------------------------------------------------------------

export { DispatchChain, createDispatchChain } from './dispatch-chain.js';
export type {
  DispatchChainResult,
  DispatchChainConfig,
  DispatchAttempt,
} from './dispatch-chain.js';

// ---------------------------------------------------------------------------
// Factory — creates a single adapter by name.
// For chained failover dispatch use createDispatchChain() instead.
// ---------------------------------------------------------------------------

import { ConsoleDispatchAdapter } from './adapters/console.js';

export function createDispatchAdapter(
  type: string,
  config?: Record<string, any>,
): DispatchAdapter {
  switch (type.toLowerCase()) {
    case 'console':
      return new ConsoleDispatchAdapter();

    case 'rapidsos': {
      // Lazy import to avoid pulling in all adapter deps unless needed
      const { RapidSOSAdapter } = require('./adapters/rapidsos.js');
      return new RapidSOSAdapter(config ?? {});
    }

    case 'rave-911':
    case 'rave911': {
      const { Rave911Adapter } = require('./adapters/rave-911.js');
      return new Rave911Adapter(config ?? {});
    }

    case 'sip-direct':
    case 'sip': {
      const { SipDirectAdapter } = require('./adapters/sip-direct.js');
      return new SipDirectAdapter(config ?? {});
    }

    case 'cellular':
    case 'cellular-failover': {
      const { CellularFailoverAdapter } = require('./adapters/cellular-failover.js');
      return new CellularFailoverAdapter(config ?? {});
    }

    default:
      throw new Error(
        `Unknown dispatch adapter: ${type}. Supported: console, rapidsos, rave-911, sip-direct, cellular`,
      );
  }
}
