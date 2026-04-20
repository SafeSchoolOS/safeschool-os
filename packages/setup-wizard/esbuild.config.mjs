import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the HTML file and embed it as a string constant
const html = readFileSync(join(__dirname, 'ui', 'index.html'), 'utf-8');

await build({
  entryPoints: [join(__dirname, 'src', 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(__dirname, 'dist', 'setup-wizard.bundle.cjs'),
  // Embed the HTML as a define constant
  define: {
    '__WIZARD_HTML__': JSON.stringify(html),
  },
  // Node.js stdlib modules are external
  external: ['node:*'],
  // Replace pino with a no-op shim — the wizard never uses logging,
  // but @edgeruntime/core's barrel export initializes pino at import time
  alias: {
    'pino': join(__dirname, 'src', 'pino-shim.mjs'),
  },
  // Single-file bundle — inline all workspace deps
  packages: 'bundle',
  banner: {
    js: '// EdgeRuntime Setup Wizard — bundled by esbuild\n',
  },
  minify: false,
  sourcemap: false,
});

console.log('Built dist/setup-wizard.bundle.cjs');
