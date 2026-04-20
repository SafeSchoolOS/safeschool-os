import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { globSync } from 'node:fs';

/**
 * Validates that all adapter .meta.ts files include required versioning fields.
 * This is a structural test — ensures no adapter ships without version info.
 */
describe('Adapter Versioning Compliance', () => {
  const adaptersRoot = resolve(__dirname, '../../../../adapters/src');
  const metaFiles: string[] = [];

  // Collect all .meta.ts files
  function findMetaFiles(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          findMetaFiles(fullPath);
        } else if (entry.name.endsWith('.meta.ts')) {
          metaFiles.push(fullPath);
        }
      }
    } catch { /* skip */ }
  }

  findMetaFiles(adaptersRoot);

  it('should find at least 80 adapter meta files', () => {
    expect(metaFiles.length).toBeGreaterThanOrEqual(80);
  });

  for (const filePath of metaFiles) {
    const relativePath = filePath.replace(adaptersRoot, '').replace(/\\/g, '/');

    it(`${relativePath} should have version field`, () => {
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain("version:");
    });

    it(`${relativePath} should have minRuntimeVersion field`, () => {
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain("minRuntimeVersion:");
    });

    it(`${relativePath} should have changelog array`, () => {
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain("changelog:");
    });

    it(`${relativePath} should have valid semver version`, () => {
      const content = readFileSync(filePath, 'utf-8');
      const versionMatch = content.match(/version:\s*['"](\d+\.\d+\.\d+)['"]/);
      expect(versionMatch).not.toBeNull();
    });
  }
});
