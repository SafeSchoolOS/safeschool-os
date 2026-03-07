/**
 * Activation Key Validator
 *
 * Offline key verification with decoded field extraction.
 */

import { decode, EPOCH_BASE, type KeyPayload } from './codec.js';
import { resolveProxy } from './proxy-table.js';
import { LICENSE_TIERS, PRODUCT_FLAGS } from '@edgeruntime/core';
import type { ProductFlag, LicenseTier } from '@edgeruntime/core';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  products?: ProductFlag[];
  tier?: LicenseTier;
  /** Proxy URL, or undefined if the proxy index is not configured (commercial product without env var) */
  proxyUrl?: string;
  proxyIndex?: number;
  issuedAt?: Date;
  raw?: KeyPayload;
}

/**
 * Validate multiple activation keys and merge their results.
 * Union of product_flags, highest tier wins, first key's proxyIndex is primary.
 */
export function validateKeys(keys: string[]): ValidationResult {
  if (keys.length === 0) {
    return { valid: false, error: 'No keys provided' };
  }

  if (keys.length === 1) {
    return validateKey(keys[0]!);
  }

  const results = keys.map((k) => validateKey(k));

  // All keys must be individually valid
  const firstInvalid = results.find((r) => !r.valid);
  if (firstInvalid) {
    return { valid: false, error: `One or more keys invalid: ${firstInvalid.error}` };
  }

  // Union all product flags
  const allProducts = new Set<ProductFlag>();
  for (const r of results) {
    for (const p of r.products ?? []) {
      allProducts.add(p);
    }
  }

  // Highest tier wins
  const tierOrder: LicenseTier[] = ['trial', 'starter', 'pro', 'enterprise'];
  let highestTier: LicenseTier = 'trial';
  for (const r of results) {
    if (r.tier && tierOrder.indexOf(r.tier) > tierOrder.indexOf(highestTier)) {
      highestTier = r.tier;
    }
  }

  // First key's proxy info is the "primary" (used for heartbeat)
  const primary = results[0]!;

  return {
    valid: true,
    products: [...allProducts],
    tier: highestTier,
    proxyUrl: primary.proxyUrl,
    proxyIndex: primary.proxyIndex,
    issuedAt: primary.issuedAt,
    raw: primary.raw,
  };
}

/**
 * Validate an activation key and extract its fields.
 * This is an offline check (HMAC verification, no network needed).
 */
export function validateKey(key: string): ValidationResult {
  const payload = decode(key);

  if (!payload) {
    return { valid: false, error: 'Invalid key: decode failed or HMAC mismatch' };
  }

  // Extract product flags
  const products: ProductFlag[] = [];
  for (let bit = 0; bit < 6; bit++) {
    if (payload.productFlags & (1 << bit)) {
      const product = PRODUCT_FLAGS[bit];
      if (product) {
        products.push(product);
      }
    }
  }

  if (products.length === 0) {
    return { valid: false, error: 'Invalid key: no products enabled' };
  }

  // Extract license tier
  const tier = LICENSE_TIERS[payload.licenseTier];
  if (!tier) {
    return { valid: false, error: `Invalid key: unknown license tier ${payload.licenseTier}` };
  }

  // Resolve proxy URL (may be null if not configured for commercial products)
  const proxyUrl = resolveProxy(payload.proxyIndex);

  // Decode issued timestamp
  const issuedAt = new Date(EPOCH_BASE + payload.issuedEpoch * 60000);

  return {
    valid: true,
    products,
    tier,
    proxyUrl: proxyUrl ?? undefined,
    proxyIndex: payload.proxyIndex,
    issuedAt,
    raw: payload,
  };
}
