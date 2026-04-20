/**
 * Configurator routes — stubbed in public release.
 *
 * The configurator is a commercial sales tool for multi-product SKU
 * configuration. Not applicable to the public SafeSchoolOS tier.
 */
import type { FastifyInstance } from 'fastify';

export interface ConfiguratorRoutesOptions {
  [key: string]: unknown;
}

export async function configuratorRoutes(_fastify: FastifyInstance, _opts: ConfiguratorRoutesOptions): Promise<void> {
  // No-op stub in public build
}
