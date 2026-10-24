'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Tooltip } from './tooltip-card';
import { buildKpiInsightModel } from '@/lib/insight-utils';

interface KpiCardProps {
  title: string;
  value: number;
  suffix?: string;
  subtitle?: string;
  delta?: number | null;
  deltaLabel?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  description?: string;
  hoverContent?: React.ReactNode;
}

function buildKpiPrompt(title: string) {
  return `What does the KPI "${title}" mean? `;
}

function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  const ref = useRef<number | null>(value);

  useEffect(() => {
    const start = ref.current ?? value;
    const diff = value - start;
    if (diff === 0) {
      ref.current = value;
      return;
    }
    const duration = 900;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + diff * eased);
      if (progress < 1) requestAnimationFrame(tick);
      else ref.current = value;
    }

    requestAnimationFrame(tick);
  }, [value]);

  const formatted =
    display >= 1_000_000
      ? `${(display / 1_000_000).toFixed(1)}M`
      : display >= 1_000
        ? `${(display / 1_000).toFixed(1)}K`
        : display % 1 === 0
          ? Math.round(display).toLocaleString()
          : display.toFixed(1);

  return (
    <span className="kpi-number">
      {formatted}
      {suffix && (
        <span style={{ fontSize: '0.45em', marginLeft: 6, color: 'var(--text-secondary)', fontWeight: 400 }}>{suffix}</span>
      )}
    </span>
  );
}

export default function KpiCard({
  title,
  value,
  suffix,
  subtitle,
  delta,
  deltaLabel,
  icon,
  loading,
  description,
  hoverContent,
}: KpiCardProps) {
  if (loading) {
    return (
      <div className="card" style={{ padding: '28px 24px' }}>
        <div className="skeleton" style={{ height: 14, width: '50%', marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 38, width: '60%', marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 12, width: '70%' }} />
      </div>
    );
  }

  const isPositive = delta !== null && delta !== undefined && delta > 0;
  const isNegative = delta !== null && delta !== undefined && delta < 0;
  const insight = buildKpiInsightModel({
    title,
    value,
    suffix,
    description,
    delta,
    deltaLabel,
  });
  const tooltipContent = hoverContent ?? (
    <div className="kpi-hover-card">
      <div className="kpi-hover-card__hero">
        <div className="kpi-hover-card__hero-top">
          <div className="kpi-hover-card__title-block">
            <div className="kpi-hover-card__eyebrow">KPI Briefing</div>
            <div className="kpi-hover-card__title-row">
              {icon ? <div className="kpi-hover-card__icon">{icon}</div> : null}
              <div className="kpi-hover-card__title">{title}</div>
            </div>
          </div>
          <span
            className={`badge ${
              insight.statusTone === 'positive'
                ? 'badge-success'
                : insight.statusTone === 'warning'
                  ? 'badge-warning'
                  : insight.statusTone === 'critical'
                    ? 'badge-danger'
                    : 'badge-info'
            }`}
            style={{ whiteSpace: 'nowrap' }}
          >
            {insight.status}
          </span>
        </div>

        <div className="kpi-hover-card__metric-row">
          <div className="kpi-hover-card__value">
            {value.toLocaleString(undefined, { maximumFractionDigits: value % 1 === 0 ? 0 : 1 })}
            {suffix ? <span className="kpi-hover-card__suffix">{suffix}</span> : null}
          </div>
          {delta !== null && delta !== undefined ? (
            <div
              className={`kpi-hover-card__delta ${
                isPositive ? 'kpi-hover-card__delta--up' : isNegative ? 'kpi-hover-card__delta--down' : 'kpi-hover-card__delta--flat'
              }`}
            >
              {isPositive ? <TrendingUp size={13} /> : isNegative ? <TrendingDown size={13} /> : <Minus size={13} />}
              <span>
                {isPositive ? '+' : ''}
                {typeof delta === 'number' ? delta.toFixed(1) : delta}%
              </span>
            </div>
          ) : null}
        </div>

        {(description || subtitle) && (
          <div className="kpi-hover-card__subcopy">{description || subtitle}</div>
        )}

        <p className="kpi-hover-card__headline">
          {insight.headline}
        </p>
      </div>

      <div className="kpi-hover-card__sections">
        {insight.sections.map((section, index) => (
          <div key={`${title}-section-${index}`} className="kpi-hover-card__section">
            <div className="kpi-hover-card__section-head">
              <span
                className={`kpi-hover-card__dot ${
                  section.tone === 'positive'
                    ? 'kpi-hover-card__dot--positive'
                    : section.tone === 'warning'
                      ? 'kpi-hover-card__dot--warning'
                      : section.tone === 'critical'
                        ? 'kpi-hover-card__dot--critical'
                        : 'kpi-hover-card__dot--neutral'
                }`}
              />
              <span className="kpi-hover-card__section-label">{section.label}</span>
            </div>
            <div className="kpi-hover-card__section-text">{section.text}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const cardContent = (
    <div className="card kpi-card-shell" style={{ padding: '28px 24px', position: 'relative' }}>
      <Link
        href={`/nlp-pipeline?prompt=${encodeURIComponent(buildKpiPrompt(title))}`}
        className="kpi-card-shell__ask"
        aria-label={`Ask about ${title}`}
      >
        Ask
      </Link>
      {/* Top label row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20,
      }}>
        <span className="label">{title}</span>
        {icon && (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
            }}
          >
            {icon}
          </div>
        )}
      </div>

      {/* Number */}
      <AnimatedNumber value={value} suffix={suffix} />

      {/* Description or subtitle */}
      {(description || subtitle) && (
        <p style={{
          fontSize: '0.82rem',
          color: 'var(--text-secondary)',
          marginTop: 12,
          lineHeight: 1.5,
        }}>
          {description || subtitle}
        </p>
      )}

      {/* Delta row */}
      {delta !== null && delta !== undefined && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 14,
          paddingTop: 14,
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.78rem',
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              color: isPositive ? 'var(--green)' : isNegative ? 'var(--red)' : 'var(--text-secondary)',
            }}
          >
            {isPositive ? <TrendingUp size={13} /> : isNegative ? <TrendingDown size={13} /> : <Minus size={13} />}
            {isPositive ? '+' : ''}
            {typeof delta === 'number' ? delta.toFixed(1) : delta}%
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {deltaLabel || 'vs previous period'}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <Tooltip
      content={tooltipContent}
      containerClassName="block w-full"
      panelClassName="kpi-hover-shell"
      contentClassName="kpi-hover-shell__content"
    >
      <div style={{ width: '100%' }}>
        {cardContent}
      </div>
    </Tooltip>
  );
}

export { AnimatedNumber };
