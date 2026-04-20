/**
 * Activation Key Validator
 *
 * Offline key verification with decoded field extraction.
 */

import { decode, EPOCH_BASE, type KeyPayload } from './codec.js';
import { resolveProxy } from './proxy-table.js';
import { LICENSE_TIERS, PRODUCT_FLAGS } from '@edgeruntime/core';
import type { ProductFlag, LicenseTier } from '@edgeruntime/core';

/**
 * Result of validating one or more activation keys.
 *
 * On success (`valid: true`), all product/tier/proxy fields are populated.
 * On failure (`valid: false`), only `error` is set.
 *
 * @example Single valid key result:
 * ```
 * {
 *   valid: true,
 *   products: ['safeschool', 'safeschool'],
 *   tier: 'pro',
 *   proxyUrl: 'https://safeschoolos.org',
 *   proxyIndex: 0,
 *   issuedAt: 2026-03-01T00:00:00.000Z,
 *   raw: { productFlags: 12, licenseTier: 2, proxyIndex: 0, issuedEpoch: 18312, reserved: 0 }
 * }
 * ```
 *
 * @example Invalid key result:
 * ```
 * { valid: false, error: 'Invalid key: decode failed or HMAC mismatch' }
 * ```
 */
export interface ValidationResult {
  /** Whether the key(s) passed all validation checks. */
  valid: boolean;
  /** Human-readable error message when `valid` is false. */
  error?: string;
  /** Decoded product flags — which products this key (or merged keys) enables. */
  products?: ProductFlag[];
  /** Resolved license tier (highest tier when multiple keys are merged). */
  tier?: LicenseTier;
  /**
   * Cloud backend URL resolved from the proxy table.
   * Undefined when the proxy index has no configured entry (e.g., a commercial
   * product without the corresponding `EDGERUNTIME_PROXY_*` env var set).
   * The edge device can still operate offline in this case.
   */
  proxyUrl?: string;
  /** Raw proxy table index encoded in the key (0-1023). */
  proxyIndex?: number;
  /** Timestamp when the key was issued (hour-level precision). */
  issuedAt?: Date;
  /** Raw decoded payload from the codec for advanced inspection. */
  raw?: KeyPayload;
}

/**
 * Validate multiple activation keys and merge their results.
 *
 * This supports the "one Mini PC, multiple license keys" deployment model where
 * a single device can run multiple products (e.g., SafeSchool + SafeSchool + SafeSchool).
 *
 * **Merge rules:**
 * - **Products**: Union of all product flags across all keys. If key A enables
 *   `safeschool` and key B enables `safeschool`, the merged result enables both.
 * - **Tier**: Highest tier wins. A `pro` key combined with an `enterprise` key
 *   yields `enterprise` for the entire device.
 * - **Proxy**: The first key's proxy index and URL become the "primary" — used for
 *   heartbeat registration and cloud sync. Other keys' proxy info is discarded.
 * - **Issued date**: Uses the first key's timestamp.
 * - **Raw payload**: Only the first key's raw payload is included.
 *
 * If any single key fails validation, the entire batch fails with the first error.
 *
 * @param keys - Array of formatted activation key strings.
 * @returns Merged validation result, or error if any key is invalid.
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
 * Validate a single activation key and extract its fields.
 *
 * Performs a fully offline check — no network call is needed. The key is decoded
 * from Crockford Base32, the bit permutation is reversed, and the embedded
 * HMAC-SHA256 (31-bit truncation) is verified against the data portion.
 *
 * **Proxy URL resolution fallback:**
 * The decoded `proxyIndex` is looked up in the proxy table. If the index has no
 * configured entry (returns `null`), `proxyUrl` will be `undefined`. This is
 * expected for commercial products that load proxy URLs from environment variables
 * at runtime — the key is still valid, the device just cannot reach the cloud
 * until the proxy is configured.
 *
 * **Validation failure cases:**
 * - Key format is wrong (not 16 Crockford Base32 chars after stripping dashes)
 * - HMAC verification fails (key was tampered with or wrong HMAC secret)
 * - No product bits are set (productFlags = 0)
 * - License tier value is out of the known range
 *
 * @param key - Formatted activation key string (e.g., `A1B2-C3D4-E5F6-G7H8`).
 * @returns Validation result with decoded fields on success, or error message on failure.
 */
export function validateKey(key: string): ValidationResult {
  const payload = decode(key);

  if (!payload) {
    return { valid: false, error: 'Invalid key: decode failed or HMAC mismatch' };
  }

  // Extract product flags
  const products: ProductFlag[] = [];
  for (let bit = 0; bit < 16; bit++) {
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
  const issuedAt = new Date(EPOCH_BASE + payload.issuedEpoch * 3600000);

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
