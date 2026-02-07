import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiClient } from '../api/client';

const authProvider = import.meta.env.VITE_AUTH_PROVIDER || 'dev';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  siteIds: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => void;
  isClerkMode: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);

function DevAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('safeschool_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      apiClient.get('/api/v1/auth/me', token)
        .then((data) => setUser(data))
        .catch(() => {
          localStorage.removeItem('safeschool_token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email: string) => {
    const data = await apiClient.post('/api/v1/auth/login', { email });
    localStorage.setItem('safeschool_token', data.token);
    setToken(data.token);
    setUser(data.user);
  };

  const logout = () => {
    localStorage.removeItem('safeschool_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, isClerkMode: false }}>
      {children}
    </AuthContext.Provider>
  );
}

function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Dynamic import to avoid loading Clerk SDK in dev mode
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const clerk = await import('@clerk/clerk-react');
        // This will be called inside a ClerkProvider context
        // We need to wait for clerk to be ready
        const checkAuth = async () => {
          try {
            const { useAuth: useClerkAuth, useUser: useClerkUser } = clerk;
            // Since we can't use hooks outside components, we use the window.__clerk_frontend_api
            // Instead, we'll use the Clerk client directly
            const clerkInstance = (window as any).__clerk;
            if (!clerkInstance?.session) {
              if (!cancelled) setLoading(false);
              return;
            }

            const clerkToken = await clerkInstance.session.getToken();
            if (!clerkToken || cancelled) {
              setLoading(false);
              return;
            }

            setToken(clerkToken);
            const data = await apiClient.get('/api/v1/auth/me', clerkToken);
            if (!cancelled) setUser(data);
          } catch {
            // Not authenticated
          } finally {
            if (!cancelled) setLoading(false);
          }
        };

        // Small delay to let Clerk initialize
        setTimeout(checkAuth, 500);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const login = async () => {
    // In Clerk mode, login is handled by Clerk's <SignIn /> component
    throw new Error('Use Clerk sign-in component');
  };

  const logout = () => {
    const clerkInstance = (window as any).__clerk;
    clerkInstance?.signOut?.();
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, isClerkMode: true }}>
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (authProvider === 'clerk') {
    return <ClerkAuthProvider>{children}</ClerkAuthProvider>;
  }
  return <DevAuthProvider>{children}</DevAuthProvider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
