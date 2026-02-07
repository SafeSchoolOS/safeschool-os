import type { FastifyPluginAsync } from 'fastify';

const wsHandler: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    // Authenticate WebSocket connection via JWT token in query param
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.send(JSON.stringify({ event: 'error', data: { message: 'Authentication required. Pass ?token=JWT' } }));
      socket.close(4401, 'Unauthorized');
      return;
    }

    let jwtPayload: any;
    try {
      jwtPayload = fastify.jwt.verify(token);
    } catch {
      socket.send(JSON.stringify({ event: 'error', data: { message: 'Invalid or expired token' } }));
      socket.close(4401, 'Unauthorized');
      return;
    }

    fastify.log.info(`WebSocket authenticated: ${jwtPayload.email} (${jwtPayload.role})`);

    let siteId: string | null = null;

    socket.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString());

        // Client subscribes to a site's events
        if (data.type === 'subscribe' && data.siteId) {
          // Verify user has access to this site
          if (!jwtPayload.siteIds?.includes(data.siteId)) {
            socket.send(JSON.stringify({
              event: 'error',
              data: { message: 'Not authorized for this site' },
            }));
            return;
          }

          siteId = data.siteId;
          fastify.wsManager.addConnection(siteId!, socket);
          socket.send(JSON.stringify({
            event: 'subscribed',
            data: { siteId },
            timestamp: new Date().toISOString(),
          }));
          fastify.log.info(`WebSocket subscribed to site: ${siteId} by ${jwtPayload.email}`);
        }

        // Ping/pong keepalive
        if (data.type === 'ping') {
          socket.send(JSON.stringify({ event: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch {
        fastify.log.warn('Invalid WebSocket message');
      }
    });

    socket.on('close', () => {
      fastify.wsManager.removeConnection(socket);
      fastify.log.info('WebSocket client disconnected');
    });
  });
};

export default wsHandler;
