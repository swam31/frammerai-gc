'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import Sidebar from './Sidebar';
import FilterBar from './FilterBar';
import { FilterProvider } from '@/lib/filters-context';
import { ThemeProvider } from '@/lib/theme-context';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import LoginScreen from '@/components/auth/LoginScreen';

function ClientLayoutInner({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const isPreview = searchParams.get('preview') === '1';
  const { isAuthenticated, isReady } = useAuth();

  if (!isReady) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-page)' }} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <FilterProvider>
      <div style={{ minHeight: '100vh', background: 'var(--bg-page)', overflowX: 'clip' }}>
        {!isPreview && <Sidebar />}
        <main
          style={{
            marginLeft: isPreview ? 0 : 'var(--sidebar-width)',
            width: isPreview ? '100%' : 'calc(100% - var(--sidebar-width))',
            maxWidth: isPreview ? '100%' : 'calc(100% - var(--sidebar-width))',
            transition: 'margin-left var(--transition-base)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh',
            minWidth: 0,
            background: 'var(--bg-page)',
            overflowX: 'hidden',
          }}
        >
          {!isPreview && <FilterBar />}
          <div style={{ flex: 1, minWidth: 0, width: '100%', overflowX: 'hidden' }}>{children}</div>
        </main>
      </div>
    </FilterProvider>
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ClientLayoutInner>{children}</ClientLayoutInner>
      </AuthProvider>
    </ThemeProvider>
  );
}
