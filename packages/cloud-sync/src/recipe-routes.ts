/**
 * Recipe routes — stubbed in public release.
 *
 * Recipes encode multi-product demo configurations (healthcare, datacenter,
 * enterprise, etc.) that reference private vendor adapters. Public builds
 * get a no-op stub.
 */
import type { FastifyInstance } from 'fastify';

export interface RecipeUIDef {
  id: string;
  name: string;
  description?: string;
}

export interface RecipeRoutesOptions {
  [key: string]: unknown;
}

export async function recipeRoutes(_fastify: FastifyInstance, _options: RecipeRoutesOptions): Promise<void> {
  // No-op stub in public build
}
