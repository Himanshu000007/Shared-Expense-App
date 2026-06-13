// Auth/session context. Restores the session from a stored token on load and
// exposes login/register/logout to the whole app.
import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => setToken(''))
      .finally(() => setLoading(false));
  }, []);

  const finish = ({ user, token }) => { setToken(token); setUser(user); };
  const login = async (creds) => finish(await api.login(creds));
  const register = async (creds) => finish(await api.register(creds));
  const logout = () => { setToken(''); setUser(null); };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
