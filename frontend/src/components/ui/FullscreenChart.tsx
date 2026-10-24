'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

interface FullscreenChartProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

const ZOOM_LEVELS = [100, 125, 150, 200];

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Recursively clone React children, replacing fixed pixel heights
 * with "100%" and stripping maxHeight constraints so charts fill the
 * full available space inside the fullscreen panel.
 */
function expandToFill(node: React.ReactNode): React.ReactNode {
  return React.Children.map(node, (child) => {
    if (!React.isValidElement(child)) return child;

    const props = { ...(child.props as Record<string, any>) };

    // Replace fixed pixel height with 99% to prevent Recharts ResizeObserver loops
    if (typeof props.height === 'number' || props.height === '100%') {
      props.height = '99%';
    }
    
    if (props.width === '100%') {
      props.width = '99%';
    }

    // Strip maxHeight from inline style
    if (props.style && (props.style.maxHeight != null || typeof props.style.height === 'number')) {
      props.style = { ...props.style };
      delete props.style.maxHeight;
      if (typeof props.style.height === 'number') {
        props.style.height = '99%';
      }
    }

    // Recurse into children
    if (props.children) {
      props.children = expandToFill(props.children);
    }

    return React.cloneElement(child, props);
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export default function FullscreenChart({
  open,
  onClose,
  title,
  description,
  children,
}: FullscreenChartProps) {
  const [zoom, setZoom] = useState(100);

  const handleClose = useCallback(() => {
    setZoom(100);
    onClose();
  }, [onClose]);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    },
    [handleClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = '';
      };
    }
    }, [handleEscape, open]);

  if (!open) return null;

  const zoomFactor = zoom / 100;

  return (
    <div className="fullscreen-overlay" onClick={handleClose}>
      <div className="fullscreen-panel" onClick={(e) => e.stopPropagation()}>
        <div className="fullscreen-header">
          <div>
            <h3 className="section-title" style={{ fontSize: '1.1rem' }}>{title}</h3>
            {description && (
              <p style={{
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                marginTop: 4,
                lineHeight: 1.5,
              }}>
                {description}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-elevated)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                <Search size={13} />
                Zoom X
              </span>
              {ZOOM_LEVELS.map((level) => (
                <button
                  key={level}
                  className={level === zoom ? 'btn-primary' : 'btn-ghost'}
                  style={{ padding: '4px 10px', fontSize: '0.72rem', minWidth: 48 }}
                  onClick={() => setZoom(level)}
                >
                  {level}%
                </button>
              ))}
            </div>
            <button className="btn-icon fullscreen-close" onClick={handleClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="fullscreen-body">
          <div className="fullscreen-chart-scroll">
            <div className="fullscreen-chart-zoom" style={{ width: `${zoom}%`, minWidth: '100%' }}>
              <div
                className="fullscreen-chart-canvas"
                style={{
                  width: `${100 / zoomFactor}%`,
                  height: '100%',
                  transform: `scaleX(${zoomFactor})`,
                  transformOrigin: 'top left',
                }}
              >
                {expandToFill(children)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
