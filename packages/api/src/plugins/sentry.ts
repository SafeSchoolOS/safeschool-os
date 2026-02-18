import fp from 'fastify-plugin';

export default fp(async (fastify) => {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    fastify.log.info('SENTRY_DSN not set — Sentry error tracking disabled');
    return;
  }

  let Sentry: any;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sentry = await (Function('return import("@sentry/node")')() as Promise<any>);
  } catch {
    fastify.log.warn('@sentry/node not installed — Sentry error tracking disabled');
    return;
  }

  const tracesSampleRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1');

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: isNaN(tracesSampleRate) ? 0.1 : tracesSampleRate,
    integrations: [
      Sentry.httpIntegration(),
    ],
  });

  fastify.log.info('Sentry error tracking initialized');

  // Capture the reference for hooks
  const sentryRef = Sentry;

  // Performance tracing — start a transaction for each request
  fastify.addHook('onRequest', async (request) => {
    sentryRef.startInactiveSpan({
      name: `${request.method} ${request.routeOptions?.url || request.url}`,
      op: 'http.server',
      forceTransaction: true,
    });
  });

  // Capture exceptions with user and request context
  fastify.addHook('onError', async (request, _reply, error) => {
    sentryRef.withScope((scope: any) => {
      scope.setContext('request', {
        method: request.method,
        url: request.url,
        headers: {
          'user-agent': request.headers['user-agent'],
          'content-type': request.headers['content-type'],
        },
        ip: request.ip,
      });

      const user = (request as any).jwtUser;
      if (user) {
        scope.setUser({
          id: user.id,
          email: user.email,
          username: user.name,
        });
      }

      scope.setTag('http.method', request.method);
      scope.setTag('http.url', request.routeOptions?.url || request.url);

      sentryRef.captureException(error);
    });
  });

  // Flush events on server shutdown
  fastify.addHook('onClose', async () => {
    await sentryRef.close(2000);
  });
}, { name: 'sentry' });
