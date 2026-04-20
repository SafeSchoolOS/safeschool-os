import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { AdapterDownloader } from '../adapter-downloader.js';

describe('AdapterDownloader', () => {
  let dataDir: string;
  let server: ReturnType<typeof createServer>;
  let serverPort: number;
  let downloader: AdapterDownloader;

  const bundleContent = 'export default class TestAdapter {}';
  const bundleHash = createHash('sha256').update(bundleContent).digest('hex');

  beforeEach(async () => {
    dataDir = join(tmpdir(), `dl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dataDir, { recursive: true });

    // Create a test HTTP server that serves adapter bundles
    server = createServer((req, res) => {
      if (req.url?.includes('/bundle') && req.headers.authorization) {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(bundleContent);
      } else if (req.url?.includes('/bad-hash')) {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('corrupted content');
      } else if (req.url?.includes('/error')) {
        res.writeHead(500);
        res.end('Internal Server Error');
      } else {
        res.writeHead(401);
        res.end('Unauthorized');
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });

    downloader = new AdapterDownloader(`http://localhost:${serverPort}`, dataDir, 'test-sync-key');
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('download', () => {
    it('should download and verify a bundle', async () => {
      const localPath = await downloader.download({
        adapterId: 'test-category/test-adapter',
        targetVersion: '1.0.0',
        bundleUrl: `http://localhost:${serverPort}/api/v1/adapters/test-category/test-adapter/bundle`,
        bundleHash,
        bundleSize: Buffer.byteLength(bundleContent),
        priority: 'normal',
      });

      expect(existsSync(localPath)).toBe(true);
      expect(readFileSync(localPath, 'utf-8')).toBe(bundleContent);
      expect(localPath).toContain('test-adapter-1.0.0.mjs');
    });

    it('should skip download if file already exists with correct hash', async () => {
      // Download once
      const path1 = await downloader.download({
        adapterId: 'test-category/test-adapter',
        targetVersion: '1.0.0',
        bundleUrl: `http://localhost:${serverPort}/api/v1/adapters/test-category/test-adapter/bundle`,
        bundleHash,
        bundleSize: Buffer.byteLength(bundleContent),
        priority: 'normal',
      });

      // Download again — should skip
      const path2 = await downloader.download({
        adapterId: 'test-category/test-adapter',
        targetVersion: '1.0.0',
        bundleUrl: `http://localhost:${serverPort}/api/v1/adapters/test-category/test-adapter/bundle`,
        bundleHash,
        bundleSize: Buffer.byteLength(bundleContent),
        priority: 'normal',
      });

      expect(path1).toBe(path2);
    });

    it('should reject bundles with hash mismatch', async () => {
      await expect(downloader.download({
        adapterId: 'test-category/bad',
        targetVersion: '1.0.0',
        bundleUrl: `http://localhost:${serverPort}/bad-hash`,
        bundleHash: 'expected-hash-that-wont-match',
        bundleSize: 0,
        priority: 'normal',
      })).rejects.toThrow(/Hash mismatch|Failed to download/);
    }, 30000);

    it('should throw after retries on server error', async () => {
      await expect(downloader.download({
        adapterId: 'test-category/failing',
        targetVersion: '1.0.0',
        bundleUrl: `http://localhost:${serverPort}/error`,
        bundleHash: '',
        bundleSize: 0,
        priority: 'normal',
      })).rejects.toThrow(/Failed to download.*3 attempts/);
    }, 30000);

    it('should create category subdirectory', async () => {
      await downloader.download({
        adapterId: 'weapons-detection/omnilert',
        targetVersion: '1.0.0',
        bundleUrl: `http://localhost:${serverPort}/api/v1/adapters/weapons-detection/omnilert/bundle`,
        bundleHash,
        bundleSize: Buffer.byteLength(bundleContent),
        priority: 'normal',
      });

      expect(existsSync(join(dataDir, 'adapters', 'weapons-detection'))).toBe(true);
    });
  });

  describe('downloadBatch', () => {
    it('should download multiple bundles and continue on individual failures', async () => {
      const results = await downloader.downloadBatch([
        {
          adapterId: 'test-category/good',
          targetVersion: '1.0.0',
          bundleUrl: `http://localhost:${serverPort}/api/v1/adapters/test-category/good/bundle`,
          bundleHash,
          bundleSize: Buffer.byteLength(bundleContent),
          priority: 'normal',
        },
        {
          adapterId: 'test-category/bad',
          targetVersion: '1.0.0',
          bundleUrl: `http://localhost:${serverPort}/error`,
          bundleHash: '',
          bundleSize: 0,
          priority: 'normal',
        },
      ]);

      expect(results.size).toBe(1);
      expect(results.has('test-category/good')).toBe(true);
      expect(results.has('test-category/bad')).toBe(false);
    }, 30000);
  });
});
