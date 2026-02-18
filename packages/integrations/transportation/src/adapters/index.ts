/**
 * Bus Fleet Adapter Factory
 *
 * Creates the appropriate adapter based on the vendor name.
 * All adapters implement the BusFleetAdapter interface from types.ts.
 */

export type { BusFleetAdapter, BusFleetAdapterConfig, GpsUpdate, RfidScanEvent, DriverEvent, VehicleHealth } from './types.js';

export { ZonarAdapter } from './zonar.js';
export { SamsaraAdapter } from './samsara.js';
export { SynoviaAdapter } from './synovia.js';
export { VersatransAdapter } from './versatrans.js';
export { SeonAdapter } from './seon.js';
export { BusPatrolAdapter } from './buspatrol.js';
export { ConsoleBusFleetAdapter } from './console.js';

import type { BusFleetAdapter } from './types.js';
import { ZonarAdapter } from './zonar.js';
import { SamsaraAdapter } from './samsara.js';
import { SynoviaAdapter } from './synovia.js';
import { VersatransAdapter } from './versatrans.js';
import { SeonAdapter } from './seon.js';
import { BusPatrolAdapter } from './buspatrol.js';
import { ConsoleBusFleetAdapter } from './console.js';

export type BusFleetVendor =
  | 'zonar'
  | 'samsara'
  | 'synovia'
  | 'here-comes-the-bus'
  | 'versatrans'
  | 'tyler'
  | 'seon'
  | 'buspatrol'
  | 'console';

/**
 * Factory function to create a bus fleet adapter by vendor name.
 */
export function createBusFleetAdapter(vendor: BusFleetVendor): BusFleetAdapter {
  switch (vendor) {
    case 'zonar':
      return new ZonarAdapter();
    case 'samsara':
      return new SamsaraAdapter();
    case 'synovia':
    case 'here-comes-the-bus':
      return new SynoviaAdapter();
    case 'versatrans':
    case 'tyler':
      return new VersatransAdapter();
    case 'seon':
      return new SeonAdapter();
    case 'buspatrol':
      return new BusPatrolAdapter();
    case 'console':
      return new ConsoleBusFleetAdapter();
    default:
      throw new Error(`Unknown bus fleet vendor: ${vendor}`);
  }
}

/** All supported vendor names */
export const SUPPORTED_BUS_FLEET_VENDORS: BusFleetVendor[] = [
  'zonar', 'samsara', 'synovia', 'versatrans', 'seon', 'buspatrol', 'console',
];
