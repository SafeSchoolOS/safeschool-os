import type { PrismaClient } from '@safeschool/db';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
    alertQueue: Queue;
    wsManager: WebSocketManager;
  }

  interface FastifyRequest {
    jwtUser: {
      id: string;
      email: string;
      role: string;
      siteIds: string[];
    };
  }
}

export interface WebSocketManager {
  broadcast(event: string, data: unknown): void;
  broadcastToSite(siteId: string, event: string, data: unknown): void;
  addConnection(siteId: string, ws: import('ws').WebSocket): void;
  removeConnection(ws: import('ws').WebSocket): void;
}
