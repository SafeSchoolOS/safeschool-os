/**
 * EdgeRuntime Entry Point
 */

import { createLogger } from '@edgeruntime/core';
import { loadConfig } from './config.js';
import { EdgeRuntime } from './runtime.js';

export { EdgeRuntime } from './runtime.js';
export { loadConfig } from './config.js';

const log = createLogger('main');

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = new EdgeRuntime(config);

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Received shutdown signal');
    await runtime.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => { shutdown().catch(() => process.exit(1)); });
  process.on('SIGTERM', () => { shutdown().catch(() => process.exit(1)); });

  try {
    await runtime.boot();
  } catch (err) {
    log.fatal({ err }, 'Failed to boot EdgeRuntime');
    process.exit(1);
  }
}

// Run if executed directly (supports tsc output, ts-node, and esbuild bundle)
const isMainModule =
  process.argv[1]?.endsWith('index.js') ||
  process.argv[1]?.endsWith('index.ts') ||
  process.argv[1]?.endsWith('edgeruntime.bundle.mjs');

if (isMainModule) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
