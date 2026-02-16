import type { FastifyPluginAsync } from 'fastify';
import { verifyResponderToken } from '../middleware/responder-auth.js';

interface ConnectionInfo {
  type: 'admin' | 'responder';
  email: string;
  role: string;
  agencyId?: string;
}

const wsHandler: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    // Authenticate WebSocket connection via JWT token in query param
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const connectionType = url.searchParams.get('type') === 'responder' ? 'responder' : 'admin';

    if (!token) {
      socket.send(JSON.stringify({ event: 'error', data: { message: 'Authentication required. Pass ?token=JWT' } }));
      socket.close(4401, 'Unauthorized');
      return;
    }

    let jwtPayload: any;
    let connInfo: ConnectionInfo;

    if (connectionType === 'responder') {
      const responderPayload = verifyResponderToken(token);
      if (!responderPayload) {
        socket.send(JSON.stringify({ event: 'error', data: { message: 'Invalid or expired responder token' } }));
        socket.close(4401, 'Unauthorized');
        return;
      }
      jwtPayload = responderPayload;
      connInfo = {
        type: 'responder',
        email: responderPayload.email,
        role: responderPayload.role,
        agencyId: responderPayload.agencyId,
      };
    } else {
      try {
        jwtPayload = fastify.jwt.verify(token);
      } catch {
        socket.send(JSON.stringify({ event: 'error', data: { message: 'Invalid or expired token' } }));
        socket.close(4401, 'Unauthorized');
        return;
      }
      connInfo = {
        type: 'admin',
        email: jwtPayload.email,
        role: jwtPayload.role,
      };
    }

    fastify.log.info(`WebSocket authenticated: ${connInfo.email} (${connInfo.role}) [${connInfo.type}]`);

    let siteId: string | null = null;

    socket.on('message', (raw: Buffer) => {
      (async () => {
        try {
          const data = JSON.parse(raw.toString());

          // Client subscribes to a site's events
          if (data.type === 'subscribe' && data.siteId) {
            if (connInfo.type === 'responder') {
              // Responder: verify agency has ACTIVE_LINK to the site
              const link = await fastify.prisma.schoolAgencyLink.findFirst({
                where: {
                  agencyId: connInfo.agencyId,
                  siteId: data.siteId,
                  status: 'ACTIVE_LINK',
                },
              });
              if (!link) {
                socket.send(JSON.stringify({
                  event: 'error',
                  data: { message: 'Agency does not have an active link to this site' },
                }));
                return;
              }
            } else {
              // Admin: verify user has access via siteIds in JWT
              if (!jwtPayload.siteIds?.includes(data.siteId)) {
                socket.send(JSON.stringify({
                  event: 'error',
                  data: { message: 'Not authorized for this site' },
                }));
                return;
              }
            }

            siteId = data.siteId;
            fastify.wsManager.addConnection(siteId!, socket);
            socket.send(JSON.stringify({
              event: 'subscribed',
              data: { siteId },
              timestamp: new Date().toISOString(),
            }));
            fastify.log.info(`WebSocket subscribed to site: ${siteId} by ${connInfo.email} [${connInfo.type}]`);
          }

          // Client subscribes to an incident's events
          if (data.type === 'subscribe_incident' && data.incidentId) {
            const incident = await fastify.prisma.incident.findUnique({
              where: { id: data.incidentId },
              select: { id: true, siteId: true },
            });

            if (!incident) {
              socket.send(JSON.stringify({
                event: 'error',
                data: { message: 'Incident not found' },
              }));
              return;
            }

            // Verify user/responder has access to the incident's site
            if (connInfo.type === 'responder') {
              const link = await fastify.prisma.schoolAgencyLink.findFirst({
                where: {
                  agencyId: connInfo.agencyId,
                  siteId: incident.siteId,
                  status: 'ACTIVE_LINK',
                },
              });
              if (!link) {
                socket.send(JSON.stringify({
                  event: 'error',
                  data: { message: 'Agency does not have access to this incident\'s site' },
                }));
                return;
              }
            } else {
              if (!jwtPayload.siteIds?.includes(incident.siteId)) {
                socket.send(JSON.stringify({
                  event: 'error',
                  data: { message: 'Not authorized for this incident\'s site' },
                }));
                return;
              }
            }

            // Subscribe to the site the incident belongs to
            siteId = incident.siteId;
            fastify.wsManager.addConnection(siteId, socket);
            socket.send(JSON.stringify({
              event: 'subscribed_incident',
              data: { incidentId: data.incidentId, siteId: incident.siteId },
              timestamp: new Date().toISOString(),
            }));
            fastify.log.info(`WebSocket subscribed to incident: ${data.incidentId} (site: ${incident.siteId}) by ${connInfo.email} [${connInfo.type}]`);
          }

          // Ping/pong keepalive
          if (data.type === 'ping') {
            socket.send(JSON.stringify({ event: 'pong', timestamp: new Date().toISOString() }));
          }
        } catch {
          fastify.log.warn('Invalid WebSocket message');
        }
      })();
    });

    socket.on('close', () => {
      fastify.wsManager.removeConnection(socket);
      fastify.log.info(`WebSocket client disconnected: ${connInfo.email} [${connInfo.type}]`);
    });
  });
};

export default wsHandler;
