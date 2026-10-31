import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => { localStorage.removeItem('bl_token'); setUser(null); }, []);
  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!localStorage.getItem('bl_token')) { setReady(true); return; }
    api('/auth/me').then((r) => setUser(r.user)).catch(logout).finally(() => setReady(true));
  }, [logout]);

  const login = async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem('bl_token', r.token);
    setUser(r.user);
    return r.user;
  };
  const signup = async (body) => {
    const r = await api('/auth/signup', { method: 'POST', body });
    localStorage.setItem('bl_token', r.token);
    setUser(r.user);
  };
  const can = (...roles) => !!user && roles.includes(user.role);

  return <Ctx.Provider value={{ user, ready, login, signup, logout, can, internal: can('admin', 'staff') }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
