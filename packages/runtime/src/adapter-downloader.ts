/**
 * Adapter Downloader
 *
 * Downloads adapter bundles from the cloud registry, verifies integrity
 * via SHA-256 hash, and stores them locally for the hot-loader.
 * Handles retries and offline resilience.
 */

import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createLogger } from '@edgeruntime/core';
import type { AdapterUpdateDirective } from '@edgeruntime/sync-engine';

const log = createLogger('runtime:adapter-downloader');

export class AdapterDownloader {
  private readonly adapterDir: string;
  private readonly maxRetries = 3;

  constructor(
    private readonly registryBaseUrl: string,
    dataDir: string,
    private readonly syncKey: string,
  ) {
    this.adapterDir = join(dataDir, 'adapters');
    if (!existsSync(this.adapterDir)) {
      mkdirSync(this.adapterDir, { recursive: true });
    }
  }

  /**
   * Download and verify a single adapter bundle.
   * Returns the local file path on success.
   */
  async download(directive: AdapterUpdateDirective): Promise<string> {
    const [category, name] = directive.adapterId.split('/');
    const localDir = join(this.adapterDir, category);
    if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

    const fileName = `${name}-${directive.targetVersion}.mjs`;
    const localPath = join(localDir, fileName);

    // Skip if already downloaded and verified
    if (existsSync(localPath)) {
      const existingHash = this.hashFile(localPath);
      if (existingHash === directive.bundleHash) {
        log.info({ id: directive.adapterId, version: directive.targetVersion }, 'Adapter already downloaded and verified');
        return localPath;
      }
    }

    // Download with retries
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        log.info({ id: directive.adapterId, version: directive.targetVersion, attempt }, 'Downloading adapter bundle');

        const url = directive.bundleUrl.startsWith('http')
          ? directive.bundleUrl
          : `${this.registryBaseUrl}${directive.bundleUrl}`;

        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${this.syncKey}`,
            'Accept': 'application/javascript',
          },
          signal: AbortSignal.timeout(60_000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        // Verify size
        if (directive.bundleSize && buffer.length !== directive.bundleSize) {
          throw new Error(`Size mismatch: expected ${directive.bundleSize}, got ${buffer.length}`);
        }

        // Write to temp file first, then rename (atomic-ish on most systems)
        const tmpPath = localPath + '.tmp';
        writeFileSync(tmpPath, buffer);

        // Verify hash
        const downloadHash = this.hashFile(tmpPath);
        if (directive.bundleHash && downloadHash !== directive.bundleHash) {
          const { unlinkSync } = require('node:fs');
          unlinkSync(tmpPath);
          throw new Error(`Hash mismatch: expected ${directive.bundleHash}, got ${downloadHash}`);
        }

        // Rename to final path
        const { renameSync } = require('node:fs');
        renameSync(tmpPath, localPath);

        log.info({ id: directive.adapterId, version: directive.targetVersion, size: buffer.length }, 'Adapter bundle downloaded and verified');
        return localPath;
      } catch (err) {
        lastError = err as Error;
        log.warn({ id: directive.adapterId, attempt, err: (err as Error).message }, 'Download attempt failed');
        if (attempt < this.maxRetries) {
          // Exponential backoff: 2s, 4s, 8s
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
        }
      }
    }

    throw new Error(`Failed to download adapter ${directive.adapterId} after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Download multiple adapter bundles. Returns a map of adapterId -> localPath.
   * Continues on individual failures — returns only successful downloads.
   */
  async downloadBatch(directives: AdapterUpdateDirective[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    for (const directive of directives) {
      try {
        const localPath = await this.download(directive);
        results.set(directive.adapterId, localPath);
      } catch (err) {
        log.error({ id: directive.adapterId, err: (err as Error).message }, 'Failed to download adapter');
      }
    }
    return results;
  }

  /** Compute SHA-256 hash of a local file */
  private hashFile(filePath: string): string {
    const data = readFileSync(filePath);
    return createHash('sha256').update(data).digest('hex');
  }
}
