'use client';

import React, { createContext, useContext, useSyncExternalStore } from 'react';

const AUTH_STORAGE_KEY = 'frammer-authenticated';
const AUTH_EVENT = 'frammer-auth-change';
const FALLBACK_USERNAME = 'admin';
const FALLBACK_PASSWORD = 'admin';
const FIXED_USERNAME = process.env.NEXT_PUBLIC_LOGIN_USERNAME || FALLBACK_USERNAME;
const FIXED_PASSWORD = process.env.NEXT_PUBLIC_LOGIN_PASSWORD || FALLBACK_PASSWORD;

type LoginResult = {
  ok: boolean;
  error?: string;
};

interface AuthContextType {
  isAuthenticated: boolean;
  isReady: boolean;
  login: (username: string, password: string) => LoginResult;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const subscribe = (callback: () => void) => {
    window.addEventListener('storage', callback);
    window.addEventListener(AUTH_EVENT, callback);

    return () => {
      window.removeEventListener('storage', callback);
      window.removeEventListener(AUTH_EVENT, callback);
    };
  };

  const isAuthenticated = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(AUTH_STORAGE_KEY) === 'true',
    () => false,
  );
  const isReady = typeof window !== 'undefined';

  const login = (username: string, password: string): LoginResult => {
    const isValid = username === FIXED_USERNAME && password === FIXED_PASSWORD;

    if (!isValid) {
      return {
        ok: false,
        error: 'Access denied.',
      };
    }

    localStorage.setItem(AUTH_STORAGE_KEY, 'true');
    window.dispatchEvent(new Event(AUTH_EVENT));

    return { ok: true };
  };

  const logout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    window.dispatchEvent(new Event(AUTH_EVENT));
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isReady, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return ctx;
}
