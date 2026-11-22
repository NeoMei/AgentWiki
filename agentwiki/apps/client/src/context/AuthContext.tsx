import React, { createContext, useContext, useState, useCallback, useLayoutEffect } from 'react';
import api, { authSessionKey, readAuthSession, setRenderedAuthToken, writeAuthSession } from '../api/client';
import { resetWorkspacePositions } from '../features/space-workspace/workspaceNavigation';

interface AuthContextType {
  token: string | null;
  user: any | null;
  login: (token: string, user: any) => boolean;
  logout: () => Promise<void>;
  logoutFailed: boolean;
  fromAnotherTab: boolean;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  login: () => false,
  logout: async () => {},
  logoutFailed: false,
  fromAnotherTab: false,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [{ token, user, fromAnotherTab }, setSession] = useState(() => {
    resetWorkspacePositions();
    return { ...readAuthSession(), fromAnotherTab: false };
  });
  const userId = user?.id;
  const [logoutFailed, setLogoutFailed] = useState(false);

  useLayoutEffect(() => {
    setRenderedAuthToken(token);
    const sync = (event?: StorageEvent) => {
      if (event && (event.storageArea !== localStorage || (event.key !== authSessionKey && event.key !== null))) return;
      const session = readAuthSession();
      if (session.user?.id !== userId) resetWorkspacePositions();
      if (session.token) setLogoutFailed(false);
      setSession((previous) => ({
        ...session,
        fromAnotherTab: Boolean(session.token) && (previous.fromAnotherTab || previous.token !== session.token),
      }));
    };
    window.addEventListener('storage', sync);
    if (readAuthSession().token !== token) sync();
    return () => {
      window.removeEventListener('storage', sync);
      setRenderedAuthToken();
    };
  }, [token, userId]);

  const login = useCallback((newToken: string, newUser: any) => {
    if (readAuthSession().token !== token) return false;
    if (userId !== newUser?.id) resetWorkspacePositions();
    writeAuthSession(newToken, newUser);
    setLogoutFailed(false);
    setSession({ token: newToken, user: newUser, fromAnotherTab: false });
    return true;
  }, [token, userId]);

  const logout = useCallback(async () => {
    if (readAuthSession().token !== token) return;
    // Retire the current scroll recorders before awaiting local revocation.
    resetWorkspacePositions();
    let failed = false;
    if (token) {
      const headers = { Authorization: 'Bearer ' + token };
      try {
        await api.post('/auth/unihub/logout', {}, { headers, timeout: 5000 });
      } catch {
        failed = true;
      }
      if (readAuthSession().token !== token) return;
      // A view can mount new recorders while revocation is pending.
      resetWorkspacePositions();
    }
    writeAuthSession(null, null);
    setSession({ token: null, user: null, fromAnotherTab: false });
    setLogoutFailed(failed);
  }, [token]);

  return (
    <AuthContext.Provider value={{ token, user, login, logout, logoutFailed, fromAnotherTab }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
