import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

export function useWebSocket(siteId: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { token } = useAuth();

  const connect = useCallback(() => {
    if (!siteId || !token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', siteId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event?.startsWith('alert:')) {
          queryClient.invalidateQueries({ queryKey: ['alerts'] });
        }
        if (msg.event?.startsWith('door:')) {
          queryClient.invalidateQueries({ queryKey: ['doors'] });
        }
        if (msg.event?.startsWith('lockdown:')) {
          queryClient.invalidateQueries({ queryKey: ['lockdowns'] });
          queryClient.invalidateQueries({ queryKey: ['doors'] });
        }
        if (msg.event?.startsWith('visitor:')) {
          queryClient.invalidateQueries({ queryKey: ['visitors'] });
        }
        if (msg.event?.startsWith('bus:')) {
          queryClient.invalidateQueries({ queryKey: ['buses'] });
        }
        if (msg.event?.startsWith('notification:')) {
          queryClient.invalidateQueries({ queryKey: ['notification-log'] });
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [siteId, token, queryClient]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
