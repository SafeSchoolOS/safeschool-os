import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterInventory } from '../adapter-inventory.js';
import { AdapterHotLoader } from '../adapter-hot-loader.js';

// Mock ConnectorRegistry
function createMockRegistry() {
  const types = new Map<string, any>();
  const connectors = new Map<string, any>();

  return {
    registerType: vi.fn((name: string, cls: any) => { types.set(name, cls); }),
    getConnector: vi.fn((name: string) => connectors.get(name)),
    getAllConnectors: vi.fn(() => Array.from(connectors.values())),
    createConnector: vi.fn((name: string, type: string, config: any) => {
      const instance = {
        name,
        config,
        connect: vi.fn(),
        disconnect: vi.fn(),
        onEvents: vi.fn(),
        getStatus: vi.fn(() => ({ name, connected: true, errors: 0 })),
      };
      connectors.set(name, instance);
      return instance;
    }),
    removeConnector: vi.fn((name: string) => { connectors.delete(name); }),
    startAll: vi.fn(),
    stopAll: vi.fn(),
    _types: types,
    _connectors: connectors,
  };
}

describe('AdapterHotLoader', () => {
  let dataDir: string;
  let inventory: AdapterInventory;
  let registry: ReturnType<typeof createMockRegistry>;
  let loader: AdapterHotLoader;

  beforeEach(() => {
    dataDir = join(tmpdir(), `hot-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dataDir, { recursive: true });
    inventory = new AdapterInventory(dataDir);
    registry = createMockRegistry();
    loader = new AdapterHotLoader(registry as any, inventory);
  });

  afterEach(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('loadAdapter', () => {
    it('should load a valid adapter bundle and register its type', async () => {
      // Create a minimal adapter bundle
      const bundleDir = join(dataDir, 'bundles');
      mkdirSync(bundleDir, { recursive: true });
      const bundlePath = join(bundleDir, 'test-adapter-1.0.0.mjs');
      writeFileSync(bundlePath, `
        export default class TestConnector {
          constructor(name, config) { this.name = name; }
          async connect() { return true; }
          async disconnect() {}
        }
      `);

      await loader.loadAdapter(bundlePath, 'test-category/test-adapter');
      expect(registry.registerType).toHaveBeenCalledWith('test-adapter', expect.any(Function));
    });

    it('should throw if bundle file does not exist', async () => {
      await expect(loader.loadAdapter('/nonexistent/path.mjs', 'a/b')).rejects.toThrow('not found');
    });
  });

  describe('rollbackAdapter', () => {
    it('should return false if no previous version exists', async () => {
      inventory.install({ id: 'a/b', version: '1.0.0', bundlePath: '/tmp/v1.mjs', bundleHash: 'h', installedAt: '', status: 'active' });
      const result = await loader.rollbackAdapter('a/b');
      expect(result).toBe(false);
    });
  });

  describe('loadAllFromInventory', () => {
    it('should skip adapters with missing bundle files', async () => {
      inventory.install({ id: 'a/b', version: '1.0.0', bundlePath: '/nonexistent/bundle.mjs', bundleHash: 'h', installedAt: '', status: 'active' });

      await loader.loadAllFromInventory();

      // Should mark as failed
      const adapter = inventory.get('a/b');
      expect(adapter!.status).toBe('failed');
      expect(adapter!.lastError).toBe('Bundle file missing');
    });

    it('should skip failed adapters', async () => {
      inventory.install({ id: 'a/b', version: '1.0.0', bundlePath: '/tmp/v1.mjs', bundleHash: 'h', installedAt: '', status: 'failed', lastError: 'previous error' });

      await loader.loadAllFromInventory();

      // registerType should NOT have been called
      expect(registry.registerType).not.toHaveBeenCalled();
    });

    it('should load valid bundles from inventory', async () => {
      const bundlePath = join(dataDir, 'test-1.0.0.mjs');
      writeFileSync(bundlePath, `export default class C { constructor() {} }`);

      inventory.install({ id: 'cat/test', version: '1.0.0', bundlePath, bundleHash: 'h', installedAt: '', status: 'active' });

      await loader.loadAllFromInventory();

      expect(registry.registerType).toHaveBeenCalledWith('test', expect.any(Function));
    });
  });
});
