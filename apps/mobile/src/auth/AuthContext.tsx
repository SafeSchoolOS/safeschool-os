import { createContext, useContext, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { saveToken, clearToken } from './storage';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  siteIds: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(false);

  const login = async (email: string) => {
    setLoading(true);
    try {
      const data = await api.post('/auth/login', { email });
      await saveToken(data.token);
      setUser(data.user);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
