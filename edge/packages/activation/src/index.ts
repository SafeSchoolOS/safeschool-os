export { encode, decode, type KeyPayload } from './codec.js';
export { generateKey, type KeyGeneratorOptions } from './key-generator.js';
export { validateKey, validateKeys, type ValidationResult } from './key-validator.js';
export { resolveProxy, getProxyEntry, getProxyWithRegions, setProxyEntry, getProxyTableSize, getConfiguredProxyCount, PRODUCT_PROXY_INDEX, STAGING_PROXY_INDEX, type ProxyEntry } from './proxy-table.js';
