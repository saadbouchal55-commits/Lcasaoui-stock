// Auth context — holds the current user and login/logout.
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .get('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const login = async (username, password) => {
    const d = await api.post('/api/auth/login', { username, password });
    setUser(d.user);
    return d.user;
  };

  const logout = async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  };

  const changePassword = async (currentPassword, newPassword) => {
    await api.post('/api/auth/change-password', { currentPassword, newPassword });
    setUser((u) => ({ ...u, mustChangePassword: false }));
  };

  const role = user?.role;
  const isDirection = role === 'DIRECTION';
  const isOrderManager = role === 'ORDER_MANAGER';
  const canOrders = isDirection || isOrderManager; // order lifecycle access
  const isFloor = isDirection || role === 'MANAGER'; // stock/count/reconcile access

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, changePassword, isDirection, isOrderManager, canOrders, isFloor }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
