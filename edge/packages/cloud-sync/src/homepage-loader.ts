/**
 * Homepage HTML loader.
 *
 * Loads product homepage HTML from the ui/homepages/ directory
 * relative to this package, avoiding absolute path issues in
 * different deployment environments (Docker vs Railpack).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a product homepage HTML file by name.
 * Looks in ui/homepages/ relative to this package.
 *
 * @param name - Homepage file name without extension (e.g. 'safeschool')
 * @returns HTML string or undefined if not found
 */
export function loadHomepageHtml(name: string): string | undefined {
  const paths = [
    join(__dirname, 'ui', 'homepages', `${name}.html`),
    join(__dirname, '..', 'ui', 'homepages', `${name}.html`),
  ];

  for (const p of paths) {
    try {
      return readFileSync(p, 'utf-8');
    } catch {
      // try next path
    }
  }

  return undefined;
}
