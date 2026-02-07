/**
 * Access Control Integration Module
 *
 * Provides a unified interface for controlling door locks and managing
 * building lockdowns across multiple access control vendors.
 *
 * Sicunet is the PRIMARY adapter with the deepest native integration.
 * Additional adapters follow the same interface for vendor-agnostic operation.
 */

export { SicunetAdapter } from './adapters/sicunet';

// Future adapters:
// export { GenetecAdapter } from './adapters/genetec';
// export { BrivoAdapter } from './adapters/brivo';
// export { VerkadaAdapter } from './adapters/verkada';
// export { LenelS2Adapter } from './adapters/lenels2';
// export { OpenpathAdapter } from './adapters/openpath';
// export { HidMercuryAdapter } from './adapters/hid-mercury';
// export { AllegionAdapter } from './adapters/allegion';
// export { AssaAbloyAdapter } from './adapters/assa-abloy';

import type { AccessControlAdapter, AccessControlConfig } from '@safeschool/core';
import { SicunetAdapter } from './adapters/sicunet';

const adapterRegistry: Record<string, new () => AccessControlAdapter> = {
  sicunet: SicunetAdapter,
  // genetec: GenetecAdapter,
  // brivo: BrivoAdapter,
  // verkada: VerkadaAdapter,
};

/**
 * Create an access control adapter by vendor name.
 */
export function createAdapter(vendor: string): AccessControlAdapter {
  const AdapterClass = adapterRegistry[vendor.toLowerCase()];
  if (!AdapterClass) {
    throw new Error(`Unknown access control vendor: ${vendor}. Supported: ${Object.keys(adapterRegistry).join(', ')}`);
  }
  return new AdapterClass();
}
