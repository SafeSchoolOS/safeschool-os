import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export function useKioskMode(timeoutMs = 60000) {
  const navigate = useNavigate();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // Auto-return to welcome screen on inactivity
    const reset = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => navigate('/'), timeoutMs);
    };

    const events = ['touchstart', 'mousedown', 'keydown'];
    events.forEach(e => document.addEventListener(e, reset));
    reset();

    // Request fullscreen
    document.documentElement.requestFullscreen?.().catch(() => {});

    return () => {
      clearTimeout(timer.current);
      events.forEach(e => document.removeEventListener(e, reset));
    };
  }, [navigate, timeoutMs]);
}
