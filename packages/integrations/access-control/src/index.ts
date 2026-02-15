/**
 * Access Control Integration Module
 *
 * Provides a unified interface for controlling door locks and managing
 * building lockdowns across multiple access control vendors.
 *
 * Sicunet is the PRIMARY adapter with the deepest native integration.
 * Additional adapters follow the same interface for vendor-agnostic operation.
 */

export { SicunetAdapter } from './adapters/sicunet.js';
export { MockAccessControlAdapter } from './adapters/mock.js';
export { GenetecAdapter } from './adapters/genetec.js';
export { BrivoAdapter } from './adapters/brivo.js';
export { VerkadaAdapter } from './adapters/verkada.js';
export { S2NetBoxAdapter } from './adapters/s2-netbox.js';
export { AssaAbloyAdapter } from './adapters/assa-abloy.js';

import type { AccessControlAdapter, CredentialManagementAdapter } from '@safeschool/core';
import { SicunetAdapter } from './adapters/sicunet.js';
import { MockAccessControlAdapter } from './adapters/mock.js';
import { GenetecAdapter } from './adapters/genetec.js';
import { BrivoAdapter } from './adapters/brivo.js';
import { VerkadaAdapter } from './adapters/verkada.js';
import { S2NetBoxAdapter } from './adapters/s2-netbox.js';
import { AssaAbloyAdapter } from './adapters/assa-abloy.js';

const adapterRegistry: Record<string, new () => AccessControlAdapter> = {
  sicunet: SicunetAdapter,
  mock: MockAccessControlAdapter,
  genetec: GenetecAdapter,
  brivo: BrivoAdapter,
  verkada: VerkadaAdapter,
  's2-netbox': S2NetBoxAdapter,
  's2netbox': S2NetBoxAdapter,
  'netbox': S2NetBoxAdapter,
  'assa-abloy': AssaAbloyAdapter,
  assaabloy: AssaAbloyAdapter,
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

/**
 * Type guard: check if an AccessControlAdapter also supports credential management.
 */
export function hasCredentialManagement(
  adapter: AccessControlAdapter,
): adapter is AccessControlAdapter & CredentialManagementAdapter {
  return 'supportsCredentialManagement' in adapter && (adapter as any).supportsCredentialManagement === true;
}
