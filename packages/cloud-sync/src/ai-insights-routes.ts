/**
 * AI Insights routes — stubbed in public release.
 *
 * The full implementation uses private AI adapters for visitor risk
 * scoring, anomaly detection, and incident report generation.
 * Schools can implement their own models or subscribe to the commercial
 * AI tier.
 */
import type { FastifyInstance } from 'fastify';

export interface AiInsightsRoutesOptions {
  [key: string]: unknown;
}

export async function aiInsightsRoutes(_fastify: FastifyInstance, _opts: AiInsightsRoutesOptions): Promise<void> {
  // No-op stub in public build
}
