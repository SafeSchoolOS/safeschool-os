/**
 * Activation Key Generator (server-side)
 *
 * Creates activation keys from high-level options.
 */

import { encode, EPOCH_BASE, type KeyPayload } from './codec.js';
import type { ProductFlag, LicenseTier } from '@edgeruntime/core';

const PRODUCT_BIT: Record<ProductFlag, number> = {
  safeschool: 3,
};

const TIER_VALUE: Record<LicenseTier, number> = {
  trial: 0,
  starter: 1,
  pro: 2,
  enterprise: 3,
};

export interface KeyGeneratorOptions {
  products: ProductFlag[];
  tier: LicenseTier;
  proxyIndex: number;
  issuedAt?: Date;
}

/**
 * Generate an activation key from high-level options.
 */
export function generateKey(options: KeyGeneratorOptions): string {
  let productFlags = 0;
  for (const product of options.products) {
    const bit = PRODUCT_BIT[product];
    if (bit === undefined) {
      throw new Error(`Unknown product: ${product}`);
    }
    productFlags |= 1 << bit;
  }

  const tier = TIER_VALUE[options.tier];
  if (tier === undefined) {
    throw new Error(`Unknown tier: ${options.tier}`);
  }

  if (options.proxyIndex < 0 || options.proxyIndex > 1023) {
    throw new Error(`Proxy index must be 0-1023, got: ${options.proxyIndex}`);
  }

  const issuedAt = options.issuedAt ?? new Date();
  const minutesSinceEpoch = Math.floor((issuedAt.getTime() - EPOCH_BASE) / 60000);

  if (minutesSinceEpoch < 0 || minutesSinceEpoch > 4194303) {
    throw new Error(
      `Issued date out of range. Must be between 2024-01-01 and ~2031-12-31. Got: ${issuedAt.toISOString()}`,
    );
  }

  const payload: KeyPayload = {
    productFlags,
    licenseTier: tier,
    proxyIndex: options.proxyIndex,
    issuedEpoch: minutesSinceEpoch,
    reserved: 0,
  };

  return encode(payload);
}
