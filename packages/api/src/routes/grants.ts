import type { FastifyPluginAsync } from 'fastify';
import { GrantService } from '@safeschool/grants';
import { requireMinRole } from '../middleware/rbac.js';

const grantRoutes: FastifyPluginAsync = async (fastify) => {
  const grantService = new GrantService();

  // GET /api/v1/grants/search — Search grants by criteria
  fastify.get<{
    Querystring: {
      schoolType?: string;
      state?: string;
      source?: string;
      modules?: string; // comma-separated list
    };
  }>('/search', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request) => {
    const { schoolType, state, source, modules } = request.query;

    const results = grantService.searchGrants({
      schoolType: schoolType as any,
      state,
      source: source as any,
      modules: modules ? modules.split(',').map((m) => m.trim()) : undefined,
    });

    return { grants: results, total: results.length };
  });

  // GET /api/v1/grants/estimate — Estimate potential funding for modules
  fastify.get<{
    Querystring: { modules: string }; // comma-separated list
  }>('/estimate', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { modules } = request.query;

    if (!modules) {
      return reply.code(400).send({ error: 'modules query parameter is required (comma-separated)' });
    }

    const moduleList = modules.split(',').map((m) => m.trim());
    const estimate = grantService.estimateFunding(moduleList);

    return estimate;
  });

  // GET /api/v1/grants/budget-template — Generate budget template for grant applications
  fastify.get<{
    Querystring: { modules: string }; // comma-separated list
  }>('/budget-template', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { modules } = request.query;

    if (!modules) {
      return reply.code(400).send({ error: 'modules query parameter is required (comma-separated)' });
    }

    const moduleList = modules.split(',').map((m) => m.trim());
    const template = grantService.generateBudgetTemplate(moduleList);

    return { modules: moduleList, budgetItems: template };
  });
};

export default grantRoutes;
