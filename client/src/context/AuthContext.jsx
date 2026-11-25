import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/api/auth.js';
import { setAccessToken } from '../services/api/client.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    authApi.refresh().then((data) => {
      if (!active) return;
      setAccessToken(data.accessToken);
      setUser(data.user);
    }).catch(() => {
      setAccessToken(null);
      setUser(null);
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  const value = useMemo(() => ({
    user,
    ready,
    async login(credentials) {
      const data = await authApi.login(credentials);
      setAccessToken(data.accessToken);
      setUser(data.user);
    },
    async logout() {
      try { await authApi.logout(); } catch { /* Clear local credentials even when the API is unreachable. */ }
      finally { setAccessToken(null); setUser(null); }
    },
  }), [user, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
