'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T, rowIndex: number) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string | number;
}

interface DataTableProps<T extends object> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  maxHeight?: number;
  onRowClick?: (row: T) => void;
  pageSize?: number;
}

export default function DataTable<T extends object>({
  columns,
  data,
  loading,
  emptyMessage = 'No data available',
  maxHeight,
  onRowClick,
  pageSize,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('desc');
  };

  const sorted = useMemo(() => {
    const rows = [...data];
    if (!sortKey) return rows;
    rows.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey] as number | string;
      const bv = (b as Record<string, unknown>)[sortKey] as number | string;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return rows;
  }, [data, sortDir, sortKey]);

  const totalPages = pageSize ? Math.ceil(sorted.length / pageSize) : 1;
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const displayed = pageSize ? sorted.slice((safePage - 1) * pageSize, safePage * pageSize) : sorted;
  const pageWindowStart = Math.max(1, safePage - 2);
  const pageWindowEnd = Math.min(totalPages, pageWindowStart + 4);

  if (loading) {
    return (
      <div style={{ padding: 20 }}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 40, marginBottom: 8, borderRadius: 8 }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div style={{ overflowX: 'auto', overflowY: maxHeight ? 'auto' : undefined, maxHeight }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    textAlign: col.align || 'left',
                    width: col.width,
                    cursor: col.sortable ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              displayed.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => onRowClick?.(row)}
                  style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                >
                  {columns.map((col) => (
                    <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                      {col.render
                        ? col.render(row, (safePage - 1) * (pageSize || displayed.length) + i)
                        : ((row as Record<string, unknown>)[col.key] as React.ReactNode) ?? '-'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageSize && totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span>
            Showing {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="btn-ghost"
              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
              disabled={safePage === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Prev
            </button>
            {Array.from({ length: Math.max(pageWindowEnd - pageWindowStart + 1, 0) }, (_, i) => {
              const currentPage = pageWindowStart + i;
              return (
                <button
                  key={currentPage}
                  className={currentPage === safePage ? 'btn-primary' : 'btn-ghost'}
                  style={{ padding: '4px 10px', fontSize: '0.75rem', minWidth: 32 }}
                  onClick={() => setPage(currentPage)}
                >
                  {currentPage}
                </button>
              );
            })}
            <button
              className="btn-ghost"
              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
              disabled={safePage === totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export type { Column };
