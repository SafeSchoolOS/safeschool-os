import { createContext, useContext, type ReactNode } from 'react';
import { useNetworkStatus } from './useNetworkStatus';

interface NetworkContextType {
  isOnline: boolean;
  lastChecked: number;
}

const NetworkContext = createContext<NetworkContextType>({
  isOnline: true,
  lastChecked: Date.now(),
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const status = useNetworkStatus();
  return (
    <NetworkContext.Provider value={status}>{children}</NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextType {
  return useContext(NetworkContext);
}
