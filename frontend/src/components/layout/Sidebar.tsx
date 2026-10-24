'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Grid3X3,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Moon,
  Radar,
  Search,
  ShieldCheck,
  Sun,
  TableProperties,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';

const navItems = [
  { href: '/executive-summary', label: 'Executive Summary', icon: LayoutDashboard, desc: 'Overview & KPIs' },
  { href: '/usage', label: 'Usage & Trends', icon: TrendingUp, desc: 'Time-series analysis' },
  { href: '/control-tower', label: 'Control Tower', icon: Radar, desc: 'Actions, value & peers' },
  { href: '/entities', label: 'Entity Analysis', icon: Building2, desc: 'Channels, clients & teams' },
  { href: '/explorer', label: 'Explorer', icon: Grid3X3, desc: 'Cross-dimensional drill-down' },
  { href: '/content', label: 'Content & Funnel', icon: Filter, desc: 'Pipeline & content mix' },
  { href: '/videos', label: 'Video Explorer', icon: Search, desc: 'Search & inspect videos' },
  { href: '/quality', label: 'Data Quality', icon: ShieldCheck, desc: 'Completeness & errors' },
  { href: '/nlp-pipeline', label: 'NLP Analytics', icon: MessageSquare, desc: 'Chat with your data' },
  { href: '/custom-kpis', label: 'Custom KPIs', icon: TableProperties, desc: 'Save permanent KPI outputs' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { logout } = useAuth();
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <aside
      style={{
        width: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
        height: '100vh',
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width var(--transition-base)',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 50,
        overflow: 'hidden',
      }}
    >
      <Link href="/">
        <div
          style={{
            padding: collapsed ? '24px 16px' : '24px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            borderBottom: '1px solid var(--border-subtle)',
            minHeight: 'var(--header-height)',
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 20px var(--accent-glow)',
              flexShrink: 0,
            }}
          >
            <Zap size={18} color="#fff" />
          </div>
          {!collapsed && (
            <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 800,
                  fontSize: '1.15rem',
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.03em',
                }}
              >
                Frammer
              </div>
              <div
                style={{
                  fontSize: '0.62rem',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                Analytics Dashboard
              </div>
            </div>
          )}
        </div>
      </Link>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {!collapsed && (
          <div
            style={{
              padding: '20px 28px 8px',
              fontSize: '0.62rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: 'var(--text-muted)',
            }}
          >
            Navigation
          </div>
        )}

        <nav
          style={{
            padding: collapsed ? '8px' : '4px 12px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: collapsed ? '14px' : '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--accent-muted)' : 'transparent',
                  border: isActive ? '1px solid var(--border-default)' : '1px solid transparent',
                  textDecoration: 'none',
                  fontSize: '0.85rem',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'all var(--transition-base)',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                title={item.label}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--accent-glow-soft)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }
                }}
              >
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 3,
                      height: 22,
                      borderRadius: '0 3px 3px 0',
                      background: 'var(--accent)',
                      boxShadow: '0 0 10px var(--accent-glow)',
                    }}
                  />
                )}
                <Icon size={18} style={{ flexShrink: 0 }} />
                {!collapsed && (
                  <div style={{ overflow: 'hidden' }}>
                    <div>{item.label}</div>
                    <div
                      style={{
                        fontSize: '0.68rem',
                        color: 'var(--text-muted)',
                        fontWeight: 400,
                        marginTop: 1,
                      }}
                    >
                      {item.desc}
                    </div>
                  </div>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div
        style={{
          padding: '12px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <button
          onClick={toggleTheme}
          className="btn-icon"
          style={{
            width: collapsed ? '100%' : 'auto',
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 12,
            padding: collapsed ? '10px' : '10px 16px',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
          }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {!collapsed && <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>

        <button
          onClick={logout}
          className="btn-icon"
          style={{
            width: collapsed ? '100%' : 'auto',
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 12,
            padding: collapsed ? '10px' : '10px 16px',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
          }}
          title="Log out"
        >
          <LogOut size={16} />
          {!collapsed && <span>Logout</span>}
        </button>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="btn-icon"
          style={{
            width: collapsed ? '100%' : 'auto',
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 12,
            padding: collapsed ? '10px' : '10px 16px',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
          }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
