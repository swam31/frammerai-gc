'use client';

import React, { useState, useCallback } from 'react';
import { Info, Maximize2, Inbox } from 'lucide-react';
import FullscreenChart from './FullscreenChart';
import InsightPanel, { type InsightItem } from './InsightPanel';
import {
  buildChartInsights,
  extractChartInsightContext,
} from '@/lib/insight-utils';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  loading?: boolean;
  minHeight?: number;
  fullscreenContent?: React.ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  insights?: InsightItem[];
  autoInsights?: boolean;
}

export default function ChartCard({
  title,
  subtitle,
  description,
  actions,
  children,
  loading,
  minHeight = 320,
  fullscreenContent,
  isEmpty,
  emptyMessage,
  insights,
  autoInsights = true,
}: ChartCardProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const openFs = useCallback(() => setFullscreen(true), []);
  const closeFs = useCallback(() => setFullscreen(false), []);
  const extractedContext = extractChartInsightContext(children);
  const derivedInsights =
    autoInsights && !loading && !isEmpty
      ? insights ?? buildChartInsights({ title, description, context: extractedContext })
      : [];

  return (
    <>
      <div className="card-static chart-card-wrapper" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '24px 28px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            gap: 16,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h4 className="section-title" style={{ fontSize: '0.92rem' }}>
                {title}
              </h4>
              {subtitle && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title={subtitle}
                >
                  <Info size={11} />
                  {subtitle}
                </span>
              )}
            </div>
            {description && (
              <p style={{
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                marginTop: 6,
                lineHeight: 1.55,
                maxWidth: 480,
              }}>
                {description}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
            {actions}
            <button
              className="chart-expand-btn"
              onClick={openFs}
              aria-label="Expand chart"
              title="View fullscreen"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 20px 24px', flex: 1, minHeight, display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div
              className="skeleton"
              style={{
                width: '100%',
                height: minHeight - 40,
                borderRadius: 'var(--radius-md)',
              }}
            />
          ) : isEmpty ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: minHeight - 40,
              gap: 14,
              color: 'var(--text-muted)',
              textAlign: 'center',
              padding: '24px',
            }}>
              <div style={{
                width: 52,
                height: 52,
                borderRadius: 'var(--radius-lg)',
                background: 'var(--accent-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'fadeInUp 0.5s ease-out',
              }}>
                <Inbox size={22} style={{ color: 'var(--text-secondary)', opacity: 0.7 }} />
              </div>
              <p style={{
                fontSize: '0.88rem',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                maxWidth: 280,
                lineHeight: 1.5,
              }}>
                {emptyMessage || 'No data available'}
              </p>
              <p style={{
                fontSize: '0.76rem',
                color: 'var(--text-muted)',
                maxWidth: 300,
                lineHeight: 1.5,
              }}>
                Try adjusting your date range or filters to see results here.
              </p>
            </div>
          ) : (
            <>
              {children}
              {derivedInsights.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <InsightPanel insights={derivedInsights} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <FullscreenChart
        open={fullscreen}
        onClose={closeFs}
        title={title}
        description={description}
      >
        {fullscreenContent || children}
      </FullscreenChart>
    </>
  );
}

