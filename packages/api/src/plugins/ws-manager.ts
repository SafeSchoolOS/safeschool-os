import fp from 'fastify-plugin';
import type { WebSocket } from 'ws';
import type { WebSocketManager } from '../types.js';

class WsManager implements WebSocketManager {
  private connections = new Map<string, Set<WebSocket>>(); // siteId → connections
  private wsToSite = new Map<WebSocket, string>();

  addConnection(siteId: string, ws: WebSocket): void {
    if (!this.connections.has(siteId)) {
      this.connections.set(siteId, new Set());
    }
    this.connections.get(siteId)!.add(ws);
    this.wsToSite.set(ws, siteId);
  }

  removeConnection(ws: WebSocket): void {
    const siteId = this.wsToSite.get(ws);
    if (siteId) {
      this.connections.get(siteId)?.delete(ws);
      if (this.connections.get(siteId)?.size === 0) {
        this.connections.delete(siteId);
      }
    }
    this.wsToSite.delete(ws);
  }

  broadcast(event: string, data: unknown): void {
    const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    for (const siteConns of this.connections.values()) {
      for (const ws of siteConns) {
        if (ws.readyState === ws.OPEN) {
          ws.send(message);
        }
      }
    }
  }

  broadcastToSite(siteId: string, event: string, data: unknown): void {
    const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    const siteConns = this.connections.get(siteId);
    if (!siteConns) return;
    for (const ws of siteConns) {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    }
  }
}

export default fp(async (fastify) => {
  fastify.decorate('wsManager', new WsManager());
}, { name: 'ws-manager' });
