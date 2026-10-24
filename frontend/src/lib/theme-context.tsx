'use client';

import React, { createContext, useContext, useEffect, useCallback, useSyncExternalStore } from 'react';

type Theme = 'dark' | 'light';
const THEME_STORAGE_KEY = 'frammer-theme';
const THEME_EVENT = 'frammer-theme-change';

function readStoredTheme(): Theme {
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  return v === 'dark' || v === 'light' ? v : 'light';
}

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const subscribe = (callback: () => void) => {
    window.addEventListener('storage', callback);
    window.addEventListener(THEME_EVENT, callback);

    return () => {
      window.removeEventListener('storage', callback);
      window.removeEventListener(THEME_EVENT, callback);
    };
  };

  const theme = useSyncExternalStore(
    subscribe,
    readStoredTheme,
    (): Theme => 'light',
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event(THEME_EVENT));
  }, [theme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be within ThemeProvider');
  return ctx;
}
