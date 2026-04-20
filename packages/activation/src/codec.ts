/**
 * Activation Key Codec
 *
 * Encodes/decodes 80-bit payloads into XXXX-XXXX-XXXX-XXXX Crockford Base32 keys.
 * Uses a fixed bit permutation table to scatter proxy_index bits across all 4 segments.
 *
 * Binary Payload Layout v2 (80 bits):
 * | Field          | Bits | Range       | Purpose                                   |
 * |----------------|------|-------------|-------------------------------------------|
 * | product_flags  | 16   | 0-65535     | Bitmask: supports up to 16 products       |
 * | license_tier   | 3    | 0-7         | 0=trial, 1=starter, 2=pro, 3=enterprise   |
 * | proxy_index    | 10   | 0-1023      | Index into proxy lookup table              |
 * | issued_epoch   | 20   | 0-1048575   | Hours since 2024-01-01 (~119 years)       |
 * | hmac_check     | 31   | -           | Truncated HMAC-SHA256                      |
 */

import crypto from 'node:crypto';

// Crockford Base32 alphabet (excludes I, L, O, U)
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_DECODE: Record<string, number> = {};
for (let i = 0; i < CROCKFORD.length; i++) {
  CROCKFORD_DECODE[CROCKFORD[i]!] = i;
}
// Allow lowercase
for (let i = 0; i < CROCKFORD.length; i++) {
  CROCKFORD_DECODE[CROCKFORD[i]!.toLowerCase()] = i;
}

// Epoch base: 2024-01-01T00:00:00Z
export const EPOCH_BASE = new Date('2024-01-01T00:00:00Z').getTime();

// HMAC secret for offline verification — lazy-loaded to avoid crash at import time.
// Production MUST set EDGERUNTIME_HMAC_SECRET; without it, anyone can forge license
// keys for any product/tier. Dev/test fall back to a well-known string so local
// runs still work, but we throw in CI/prod.
const DEV_DEFAULT_HMAC = 'edgeruntime-default-hmac-key-change-in-production';
function getHmacSecret(): string {
  const configured = process.env.EDGERUNTIME_HMAC_SECRET;
  if (configured) return configured;
  const env = (process.env.NODE_ENV || '').toLowerCase();
  const isProd = env === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  if (isProd) {
    throw new Error(
      'EDGERUNTIME_HMAC_SECRET is required in production — refusing to use the dev fallback.'
    );
  }
  return DEV_DEFAULT_HMAC;
}

/**
 * Fixed bit permutation table (80 entries).
 * Maps logical bit position -> physical bit position in the encoded key.
 * This scatters the proxy_index bits (logical positions 9-18) across all 4 segments.
 */
const PERMUTATION_TABLE: number[] = [
  72, 15, 41, 3, 58, 27, 66, 9, 34, 50,
  78, 21, 47, 6, 63, 30, 0, 55, 12, 39,
  70, 24, 48, 7, 60, 33, 1, 54, 16, 42,
  74, 19, 45, 4, 57, 28, 68, 11, 37, 52,
  76, 23, 49, 8, 61, 31, 2, 56, 14, 40,
  71, 18, 44, 5, 59, 29, 67, 10, 36, 53,
  77, 22, 46, 13, 64, 32, 69, 17, 43, 51,
  75, 20, 38, 62, 26, 73, 35, 65, 79, 25,
];

// Inverse permutation for decoding
const INVERSE_PERMUTATION: number[] = new Array(80);
for (let i = 0; i < 80; i++) {
  INVERSE_PERMUTATION[PERMUTATION_TABLE[i]!] = i;
}

export interface KeyPayload {
  productFlags: number;
  licenseTier: number;
  proxyIndex: number;
  issuedEpoch: number;
  reserved: number;
}

/**
 * Pack a KeyPayload into 80 bits (as a 10-byte Buffer).
 * Layout v2: [productFlags:16][licenseTier:3][proxyIndex:10][issuedEpoch:20][hmac:31]
 */
function packBits(payload: KeyPayload): Buffer {
  const bits = new Uint8Array(80);

  let offset = 0;

  // product_flags: 16 bits
  for (let i = 15; i >= 0; i--) {
    bits[offset++] = (payload.productFlags >> i) & 1;
  }

  // license_tier: 3 bits
  for (let i = 2; i >= 0; i--) {
    bits[offset++] = (payload.licenseTier >> i) & 1;
  }

  // proxy_index: 10 bits
  for (let i = 9; i >= 0; i--) {
    bits[offset++] = (payload.proxyIndex >> i) & 1;
  }

  // issued_epoch: 20 bits (hours since epoch)
  for (let i = 19; i >= 0; i--) {
    bits[offset++] = (payload.issuedEpoch >> i) & 1;
  }

  // First 49 bits are the data portion. Compute HMAC over them.
  const dataBytes = bitsToBuffer(bits.slice(0, 49));
  const hmac = crypto.createHmac('sha256', getHmacSecret()).update(dataBytes).digest();

  // Take first 31 bits of HMAC
  for (let i = 0; i < 31; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    bits[offset++] = (hmac[byteIdx]! >> bitIdx) & 1;
  }

  return bitsToBuffer(bits);
}

/**
 * Unpack 80 bits (10-byte Buffer) into a KeyPayload.
 */
function unpackBits(buf: Buffer): KeyPayload & { hmacCheck: number[] } {
  const bits = bufferToBits(buf, 80);

  let offset = 0;

  let productFlags = 0;
  for (let i = 0; i < 16; i++) {
    productFlags = (productFlags << 1) | bits[offset++]!;
  }

  let licenseTier = 0;
  for (let i = 0; i < 3; i++) {
    licenseTier = (licenseTier << 1) | bits[offset++]!;
  }

  let proxyIndex = 0;
  for (let i = 0; i < 10; i++) {
    proxyIndex = (proxyIndex << 1) | bits[offset++]!;
  }

  let issuedEpoch = 0;
  for (let i = 0; i < 20; i++) {
    issuedEpoch = (issuedEpoch << 1) | bits[offset++]!;
  }

  let reserved = 0;

  const hmacCheck: number[] = [];
  for (let i = 0; i < 31; i++) {
    hmacCheck.push(bits[offset++]!);
  }

  return { productFlags, licenseTier, proxyIndex, issuedEpoch, reserved, hmacCheck };
}

/**
 * Apply the bit permutation to scatter bits across the key.
 */
function applyPermutation(bits: Uint8Array): Uint8Array {
  const permuted = new Uint8Array(80);
  for (let i = 0; i < 80; i++) {
    permuted[PERMUTATION_TABLE[i]!] = bits[i]!;
  }
  return permuted;
}

/**
 * Apply the inverse permutation to recover the original bit order.
 */
function applyInversePermutation(permuted: Uint8Array): Uint8Array {
  const bits = new Uint8Array(80);
  for (let i = 0; i < 80; i++) {
    bits[INVERSE_PERMUTATION[i]!] = permuted[i]!;
  }
  return bits;
}

/**
 * Encode bits to Crockford Base32 string (16 characters for 80 bits).
 */
function bitsToBase32(bits: Uint8Array): string {
  let result = '';
  for (let i = 0; i < 80; i += 5) {
    const val =
      ((bits[i]! << 4) |
        (bits[i + 1]! << 3) |
        (bits[i + 2]! << 2) |
        (bits[i + 3]! << 1) |
        bits[i + 4]!) &
      0x1f;
    result += CROCKFORD[val]!;
  }
  return result;
}

/**
 * Decode Crockford Base32 string to bits.
 */
function base32ToBits(str: string): Uint8Array {
  const bits = new Uint8Array(str.length * 5);
  for (let i = 0; i < str.length; i++) {
    const val = CROCKFORD_DECODE[str[i]!];
    if (val === undefined) {
      throw new Error(`Invalid Crockford Base32 character: ${str[i]}`);
    }
    const offset = i * 5;
    bits[offset] = (val >> 4) & 1;
    bits[offset + 1] = (val >> 3) & 1;
    bits[offset + 2] = (val >> 2) & 1;
    bits[offset + 3] = (val >> 1) & 1;
    bits[offset + 4] = val & 1;
  }
  return bits;
}

// Helper: convert bit array to buffer
function bitsToBuffer(bits: Uint8Array | number[]): Buffer {
  const byteLen = Math.ceil(bits.length / 8);
  const buf = Buffer.alloc(byteLen);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = 7 - (i % 8);
      buf[byteIdx] = buf[byteIdx]! | (1 << bitIdx);
    }
  }
  return buf;
}

// Helper: convert buffer to bit array
function bufferToBits(buf: Buffer, totalBits: number): number[] {
  const bits: number[] = [];
  for (let i = 0; i < totalBits; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    bits.push((buf[byteIdx]! >> bitIdx) & 1);
  }
  return bits;
}

/**
 * Encode a KeyPayload into a formatted activation key: XXXX-XXXX-XXXX-XXXX
 */
export function encode(payload: KeyPayload): string {
  // Pack payload into 80 bits
  const packed = packBits(payload);
  const bits = bufferToBits(packed, 80);

  // Apply bit permutation
  const permuted = applyPermutation(new Uint8Array(bits));

  // Encode to Crockford Base32
  const raw = bitsToBase32(permuted);

  // Format as XXXX-XXXX-XXXX-XXXX
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

/**
 * Decode a formatted activation key back into a KeyPayload.
 * Returns null if the key is malformed or HMAC verification fails.
 */
export function decode(key: string): KeyPayload | null {
  // Strip dashes and whitespace
  const raw = key.replace(/[-\s]/g, '').toUpperCase();

  if (raw.length !== 16) {
    return null;
  }

  // Validate characters
  for (const ch of raw) {
    if (CROCKFORD_DECODE[ch] === undefined) {
      return null;
    }
  }

  try {
    // Decode Base32 to bits
    const permutedBits = base32ToBits(raw);

    // Undo permutation
    const bits = applyInversePermutation(permutedBits);

    // Convert bits to buffer
    const buf = bitsToBuffer(bits);

    // Unpack fields
    const unpacked = unpackBits(buf);

    // Verify HMAC using a constant-time comparison so an attacker cannot forge
    // keys bit-at-a-time by measuring timing (classic early-return side channel).
    const dataBits = Array.from(bits.slice(0, 49));
    const dataBytes = bitsToBuffer(dataBits);
    const expectedHmac = crypto.createHmac('sha256', getHmacSecret()).update(dataBytes).digest();

    const expected = Buffer.alloc(4);
    const actual = Buffer.alloc(4);
    for (let i = 0; i < 31; i++) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = 7 - (i % 8);
      const expectedBit = (expectedHmac[byteIdx]! >> bitIdx) & 1;
      const actualBit = unpacked.hmacCheck[i] & 1;
      if (expectedBit) expected[byteIdx] |= 1 << bitIdx;
      if (actualBit) actual[byteIdx] |= 1 << bitIdx;
    }
    if (!crypto.timingSafeEqual(expected, actual)) {
      return null; // HMAC mismatch
    }

    return {
      productFlags: unpacked.productFlags,
      licenseTier: unpacked.licenseTier,
      proxyIndex: unpacked.proxyIndex,
      issuedEpoch: unpacked.issuedEpoch,
      reserved: unpacked.reserved,
    };
  } catch {
    return null;
  }
}
