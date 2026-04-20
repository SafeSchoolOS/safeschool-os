import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterInventory } from '../adapter-inventory.js';

describe('AdapterInventory', () => {
  let dataDir: string;
  let inventory: AdapterInventory;

  beforeEach(() => {
    dataDir = join(tmpdir(), `adapter-inv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dataDir, { recursive: true });
    inventory = new AdapterInventory(dataDir);
  });

  afterEach(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('install', () => {
    it('should install an adapter and persist to disk', () => {
      inventory.install({
        id: 'access-control/lenel',
        version: '1.0.0',
        bundlePath: '/tmp/lenel-1.0.0.mjs',
        bundleHash: 'abc123',
        installedAt: '2026-03-28T00:00:00Z',
        status: 'active',
      });

      const adapter = inventory.get('access-control/lenel');
      expect(adapter).toBeDefined();
      expect(adapter!.version).toBe('1.0.0');
      expect(adapter!.status).toBe('active');

      // Verify persisted to disk
      const filePath = join(dataDir, 'adapter-inventory.json');
      expect(existsSync(filePath)).toBe(true);
      const persisted = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(persisted).toHaveLength(1);
      expect(persisted[0].id).toBe('access-control/lenel');
    });

    it('should preserve previous version for rollback on upgrade', () => {
      inventory.install({
        id: 'cameras/milestone',
        version: '1.0.0',
        bundlePath: '/tmp/milestone-1.0.0.mjs',
        bundleHash: 'hash1',
        installedAt: '2026-03-01T00:00:00Z',
        status: 'active',
      });

      inventory.install({
        id: 'cameras/milestone',
        version: '1.1.0',
        bundlePath: '/tmp/milestone-1.1.0.mjs',
        bundleHash: 'hash2',
        installedAt: '2026-03-28T00:00:00Z',
        status: 'active',
      });

      const adapter = inventory.get('cameras/milestone');
      expect(adapter!.version).toBe('1.1.0');
      expect(adapter!.previousVersion).toBe('1.0.0');
      expect(adapter!.previousBundlePath).toBe('/tmp/milestone-1.0.0.mjs');
    });
  });

  describe('getVersionMap', () => {
    it('should return map of active adapter versions', () => {
      inventory.install({ id: 'a/one', version: '1.0.0', bundlePath: '/a', bundleHash: 'h1', installedAt: '', status: 'active' });
      inventory.install({ id: 'b/two', version: '2.0.0', bundlePath: '/b', bundleHash: 'h2', installedAt: '', status: 'active' });
      inventory.install({ id: 'c/three', version: '3.0.0', bundlePath: '/c', bundleHash: 'h3', installedAt: '', status: 'failed', lastError: 'load error' });

      const map = inventory.getVersionMap();
      expect(map).toEqual({ 'a/one': '1.0.0', 'b/two': '2.0.0' });
      // Failed adapters should NOT appear
      expect(map['c/three']).toBeUndefined();
    });
  });

  describe('markFailed', () => {
    it('should mark adapter as failed with error', () => {
      inventory.install({ id: 'x/y', version: '1.0.0', bundlePath: '/x', bundleHash: 'h', installedAt: '', status: 'active' });
      inventory.markFailed('x/y', 'import() failed');

      const adapter = inventory.get('x/y');
      expect(adapter!.status).toBe('failed');
      expect(adapter!.lastError).toBe('import() failed');
    });
  });

  describe('rollback', () => {
    it('should roll back to previous version', () => {
      inventory.install({ id: 'a/b', version: '1.0.0', bundlePath: '/v1.mjs', bundleHash: 'h1', installedAt: '', status: 'active' });
      inventory.install({ id: 'a/b', version: '2.0.0', bundlePath: '/v2.mjs', bundleHash: 'h2', installedAt: '', status: 'active' });

      const rolled = inventory.rollback('a/b');
      expect(rolled).not.toBeNull();
      expect(rolled!.version).toBe('1.0.0');
      expect(rolled!.bundlePath).toBe('/v1.mjs');
      expect(rolled!.status).toBe('active');

      // Verify inventory reflects rollback
      const current = inventory.get('a/b');
      expect(current!.version).toBe('1.0.0');
    });

    it('should return null if no previous version exists', () => {
      inventory.install({ id: 'a/b', version: '1.0.0', bundlePath: '/v1.mjs', bundleHash: 'h1', installedAt: '', status: 'active' });
      const rolled = inventory.rollback('a/b');
      expect(rolled).toBeNull();
    });

    it('should return null for unknown adapter', () => {
      const rolled = inventory.rollback('nonexistent/adapter');
      expect(rolled).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove adapter from inventory', () => {
      inventory.install({ id: 'a/b', version: '1.0.0', bundlePath: '/v1', bundleHash: 'h', installedAt: '', status: 'active' });
      expect(inventory.list()).toHaveLength(1);

      inventory.remove('a/b');
      expect(inventory.list()).toHaveLength(0);
      expect(inventory.get('a/b')).toBeUndefined();
    });
  });

  describe('persistence', () => {
    it('should survive reload from disk', () => {
      inventory.install({ id: 'a/b', version: '1.0.0', bundlePath: '/v1', bundleHash: 'h', installedAt: '2026-01-01', status: 'active' });
      inventory.install({ id: 'c/d', version: '2.0.0', bundlePath: '/v2', bundleHash: 'h2', installedAt: '2026-02-01', status: 'active' });

      // Create new inventory from same directory — should load persisted data
      const inventory2 = new AdapterInventory(dataDir);
      expect(inventory2.list()).toHaveLength(2);
      expect(inventory2.get('a/b')!.version).toBe('1.0.0');
      expect(inventory2.get('c/d')!.version).toBe('2.0.0');
    });
  });

  describe('getAdapterDir', () => {
    it('should create adapters subdirectory', () => {
      const dir = inventory.getAdapterDir();
      expect(dir).toBe(join(dataDir, 'adapters'));
      expect(existsSync(dir)).toBe(true);
    });
  });
});
