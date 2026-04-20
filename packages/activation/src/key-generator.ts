/**
 * Activation Key Generator (server-side)
 *
 * Creates activation keys from high-level options.
 */

import { encode, EPOCH_BASE, type KeyPayload } from './codec.js';
import type { ProductFlag, LicenseTier } from '@edgeruntime/core';

/**
 * Maps each product flag to its bit position within the 16-bit `productFlags` bitmask.
 *
 * A key can enable multiple products simultaneously by setting multiple bits.
 * For example, a key enabling both `safeschool` (bit 3) and `safeschool` (bit 2)
 * would have `productFlags = 0b00001100 = 12`.
 *
 * Bit positions 7-15 are currently unassigned and reserved for future products.
 * The codec supports up to 16 products total (bits 0-15).
 */
const PRODUCT_BIT: Record<ProductFlag, number> = {
  safeschool: 3,
  healthcare: 6,
};

/**
 * Maps each license tier to its numeric value for encoding into the 3-bit `licenseTier` field.
 *
 * When multiple keys are merged via {@link validateKeys}, the highest tier wins.
 * The 3-bit field supports values 0-7, leaving room for 4 additional tiers (4-7).
 *
 * | Value | Tier       | Description                              |
 * |-------|------------|------------------------------------------|
 * | 0     | trial      | Time-limited evaluation                  |
 * | 1     | starter    | Basic feature set                        |
 * | 2     | pro        | Full feature set                         |
 * | 3     | enterprise | Full features + premium support/SLA      |
 */
const TIER_VALUE: Record<LicenseTier, number> = {
  trial: 0,
  starter: 1,
  pro: 2,
  enterprise: 3,
};

/** Options for generating an activation key. */
export interface KeyGeneratorOptions {
  /** One or more products to enable in this key (OR'd into the product bitmask). */
  products: ProductFlag[];
  /** License tier level (determines feature access). */
  tier: LicenseTier;
  /**
   * Index into the proxy lookup table (0-1023).
   * Routes the edge device to the correct cloud backend.
   * See {@link PRODUCT_PROXY_INDEX} in proxy-table.ts for well-known indices.
   */
  proxyIndex: number;
  /**
   * Timestamp for the issued_epoch field. Defaults to `new Date()`.
   * Must fall between 2024-01-01T00:00:00Z and approximately 2143
   * (the 20-bit hour counter overflows at 1,048,575 hours from epoch).
   */
  issuedAt?: Date;
}

/**
 * Generate an activation key from high-level options.
 *
 * Converts human-readable options into a binary {@link KeyPayload}, then encodes it
 * as a Crockford Base32 string in `XXXX-XXXX-XXXX-XXXX` format via the codec.
 *
 * The issued timestamp is stored as whole hours since the epoch (2024-01-01T00:00:00Z),
 * giving ~119 years of range in the 20-bit field. Sub-hour precision is discarded.
 *
 * @param options - Key generation parameters (products, tier, proxy index, optional date).
 * @returns Formatted activation key string (e.g., `A1B2-C3D4-E5F6-G7H8`).
 *
 * @throws {Error} If any product name is not in the PRODUCT_BIT map.
 * @throws {Error} If the tier is not in the TIER_VALUE map.
 * @throws {Error} If proxyIndex is outside the 0-1023 range (10-bit field).
 * @throws {Error} If issuedAt is before 2024-01-01 or after ~2143 (20-bit hour overflow).
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
  const hoursSinceEpoch = Math.floor((issuedAt.getTime() - EPOCH_BASE) / 3600000);

  if (hoursSinceEpoch < 0 || hoursSinceEpoch > 1048575) {
    throw new Error(
      `Issued date out of range. Must be between 2024-01-01 and ~2143. Got: ${issuedAt.toISOString()}`,
    );
  }

  const payload: KeyPayload = {
    productFlags,
    licenseTier: tier,
    proxyIndex: options.proxyIndex,
    issuedEpoch: hoursSinceEpoch,
    reserved: 0,
  };

  return encode(payload);
}
