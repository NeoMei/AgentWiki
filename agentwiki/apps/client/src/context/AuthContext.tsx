import React, { createContext, useContext, useState, useCallback } from 'react';
import api from '../api/client';
import { resetWorkspacePositions } from '../features/space-workspace/workspaceNavigation';

interface AuthContextType {
  token: string | null;
  user: any | null;
  login: (token: string, user: any) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  login: () => {},
  logout: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<any | null>(() => {
    resetWorkspacePositions();
    const saved = localStorage.getItem('user');
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  });

  const login = useCallback((newToken: string, newUser: any) => {
    if (user?.id !== newUser?.id) resetWorkspacePositions();
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, [user?.id]);

  const authSource = user?.authSource;
  const logout = useCallback(async () => {
    if (token && authSource === 'unihub') {
      try {
        await api.post('/auth/unihub/logout', {}, {
          headers: { Authorization: 'Bearer ' + token },
          timeout: 5000,
        });
      } catch {
        // Local sign-out remains available when UniHub cannot be reached.
      }
      const currentToken = localStorage.getItem('token');
      if (currentToken && currentToken !== token) return;
    }
    resetWorkspacePositions();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, [token, authSource]);

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
