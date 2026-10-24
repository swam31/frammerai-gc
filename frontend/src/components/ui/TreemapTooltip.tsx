'use client';

import React from 'react';
import { formatNumber } from '@/lib/chart-utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function TreemapTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;

  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div
      style={{
        background: 'var(--bg-surface-solid)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-lg)',
        padding: '12px 14px',
        minWidth: 220,
      }}
    >
      {item.group && (
        <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
          {item.group}
        </div>
      )}
      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
        {item.label || item.name}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 10, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
        <span>Volume</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{formatNumber(item.value)}</span>
      </div>
      {typeof item.share_pct === 'number' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 4, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          <span>Share</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{item.share_pct.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}
