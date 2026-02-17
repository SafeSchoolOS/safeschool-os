import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL || '';

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

export interface WebSocketEvent {
  event: string;
  data?: unknown;
  timestamp: number;
}

export interface UseWebSocketReturn {
  connectionState: ConnectionState;
  lastEvent: WebSocketEvent | null;
  subscribe: (siteId: string) => void;
}

/**
 * Derives the WebSocket URL from the API base URL.
 * - https://api.example.com -> wss://api.example.com/ws
 * - http://localhost:3000 -> ws://localhost:3000/ws
 * - '' (empty, same-origin) -> ws(s)://current-host/ws
 */
function getWsUrl(token: string): string {
  if (API_BASE) {
    const url = new URL(API_BASE);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/ws?token=${encodeURIComponent(token)}`;
  }
  // Same-origin fallback
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const PING_INTERVAL_MS = 30_000;

export function useWebSocket(siteId: string | undefined): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const { token } = useAuth();

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);

  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pingTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const backoffMs = useRef(INITIAL_BACKOFF_MS);
  const intentionalClose = useRef(false);
  const currentSiteId = useRef<string | undefined>(siteId);

  // Keep the ref in sync so the subscribe callback and reconnect can use latest value
  useEffect(() => {
    currentSiteId.current = siteId;
  }, [siteId]);

  const stopPing = useCallback(() => {
    if (pingTimer.current !== undefined) {
      clearInterval(pingTimer.current);
      pingTimer.current = undefined;
    }
  }, []);

  const startPing = useCallback((ws: WebSocket) => {
    stopPing();
    pingTimer.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, PING_INTERVAL_MS);
  }, [stopPing]);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data);

      // Ignore pong responses
      if (msg.type === 'pong' || msg.event === 'pong') return;

      const wsEvent: WebSocketEvent = {
        event: msg.event || msg.type || 'unknown',
        data: msg.data ?? msg,
        timestamp: Date.now(),
      };
      setLastEvent(wsEvent);

      const eventName: string = wsEvent.event;

      // Invalidate relevant React Query caches based on event type
      if (eventName === 'alert:created' || eventName === 'alert:updated' || eventName.startsWith('fire-alarm:')) {
        queryClient.invalidateQueries({ queryKey: ['alerts'] });
        queryClient.invalidateQueries({ queryKey: ['fire-alarm-events'] });
      }

      if (eventName.startsWith('lockdown:')) {
        queryClient.invalidateQueries({ queryKey: ['alerts'] });
        queryClient.invalidateQueries({ queryKey: ['site'] });
      }

      if (eventName === 'door:status') {
        queryClient.invalidateQueries({ queryKey: ['doors'] });
        queryClient.invalidateQueries({ queryKey: ['site'] });
      }

      if (eventName.startsWith('visitor:')) {
        queryClient.invalidateQueries({ queryKey: ['visitors'] });
      }

      if (eventName.startsWith('bus:')) {
        queryClient.invalidateQueries({ queryKey: ['transportation'] });
      }

      if (eventName === 'notification:sent') {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }
    } catch {
      // Ignore malformed messages
    }
  }, [queryClient]);

  const connect = useCallback(() => {
    if (!token) return;

    // Clean up any existing connection
    if (wsRef.current) {
      intentionalClose.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }

    intentionalClose.current = false;
    setConnectionState('reconnecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(getWsUrl(token));
    } catch {
      // Invalid URL or browser issue — schedule retry
      setConnectionState('disconnected');
      reconnectTimer.current = setTimeout(() => {
        backoffMs.current = Math.min(backoffMs.current * 2, MAX_BACKOFF_MS);
        connect();
      }, backoffMs.current);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState('connected');
      backoffMs.current = INITIAL_BACKOFF_MS;
      startPing(ws);

      // Auto-subscribe to current site
      if (currentSiteId.current) {
        ws.send(JSON.stringify({ type: 'subscribe', siteId: currentSiteId.current }));
      }
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      stopPing();
      wsRef.current = null;

      if (!intentionalClose.current) {
        setConnectionState('reconnecting');
        reconnectTimer.current = setTimeout(() => {
          const nextBackoff = backoffMs.current;
          backoffMs.current = Math.min(backoffMs.current * 2, MAX_BACKOFF_MS);
          connect();
        }, backoffMs.current);
      } else {
        setConnectionState('disconnected');
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose, so we just close here
      ws.close();
    };
  }, [token, handleMessage, startPing, stopPing]);

  // Subscribe to a different site at runtime
  const subscribe = useCallback((newSiteId: string) => {
    currentSiteId.current = newSiteId;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', siteId: newSiteId }));
    }
  }, []);

  // Connect when token is available, reconnect when token or siteId changes
  useEffect(() => {
    if (!token) {
      setConnectionState('disconnected');
      return;
    }

    connect();

    return () => {
      intentionalClose.current = true;
      clearTimeout(reconnectTimer.current);
      stopPing();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, siteId, connect, stopPing]);

  return { connectionState, lastEvent, subscribe };
}
