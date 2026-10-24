'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Database, MessageSquare, Play, Save, Table2 } from 'lucide-react';
import { format } from 'sql-formatter';
import DataTable from '@/components/ui/DataTable';
import { CodeBlock } from '@/components/ui/code-block';
import {
  customKpiApi,
  type CustomKpiExecutionResult,
  type CustomKpiInputMode,
  type SavedCustomKpi,
} from '@/lib/api';

function inferResultType(result: CustomKpiExecutionResult | null): 'table' | 'value' | 'empty' {
  if (!result) return 'empty';
  if (Array.isArray(result.df_records)) {
    return result.df_records.length > 0 || (result.columns?.length ?? 0) > 0 ? 'table' : 'empty';
  }
  if (result.value !== undefined && result.value !== null) return 'value';
  return 'empty';
}

function formatScalarValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(value);
}

function ResultPanel({ result }: { result: CustomKpiExecutionResult | null }) {
  if (!result) return null;

  const resultType = result.result_type === 'value' || result.result_type === 'table'
    ? result.result_type
    : result.result_type === 'information'
      ? 'information'
    : inferResultType(result);
  const records = Array.isArray(result.df_records) ? result.df_records : [];
  const columns = result.columns ?? (records[0] ? Object.keys(records[0]) : []);

  return (
    <div className="section-gap" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {result.answer_nl && (
        <div className="card-static" style={{ padding: 16, display: 'flex', gap: 12 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <MessageSquare size={14} color="#fff" />
          </div>
          <div style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>{result.answer_nl}</div>
        </div>
      )}

      {result.sql && (
        <div className="card-static" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 0', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Generated SQL
          </div>
          <CodeBlock
            language="sql"
            filename="custom_kpi.sql"
            code={format(result.sql, { language: 'sqlite', keywordCase: 'upper' })}
          />
        </div>
      )}

      {resultType === 'information' && (
        <div className="card-static" style={{ padding: 20, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          This is a built-in KPI definition. It is included alongside saved user-created KPIs for quick access.
        </div>
      )}

      {resultType === 'value' && (
        <div className="card-static" style={{ padding: 20 }}>
          <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10 }}>
            Stored Result
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {formatScalarValue(result.value)}
          </div>
        </div>
      )}

      {resultType === 'table' && (
        <div className="card-static" style={{ overflow: 'hidden' }}>
          <DataTable
            columns={columns.map((column) => ({
              key: column,
              label: column.replace(/_/g, ' '),
              sortable: true,
              align: typeof records[0]?.[column] === 'number' ? 'right' : 'left',
            }))}
            data={records}
            pageSize={10}
            emptyMessage="No rows stored for this KPI"
          />
        </div>
      )}

      {resultType === 'empty' && (
        <div className="card-static" style={{ padding: 20, color: 'var(--text-muted)' }}>
          No stored result is available for this KPI yet.
        </div>
      )}
    </div>
  );
}

export default function CustomKpisPage() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [query, setQuery] = useState('');
  const [inputMode, setInputMode] = useState<CustomKpiInputMode>('natural_language');
  const [preview, setPreview] = useState<CustomKpiExecutionResult | null>(null);
  const [savedKpis, setSavedKpis] = useState<SavedCustomKpi[]>([]);
  const [selectedKpiId, setSelectedKpiId] = useState<string | number | null>(null);
  const [selectedKpi, setSelectedKpi] = useState<SavedCustomKpi | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreateExpanded, setIsCreateExpanded] = useState(true);
  const [hasAppliedInitialCollapse, setHasAppliedInitialCollapse] = useState(false);

  const canSubmit = useMemo(() => name.trim() && query.trim(), [name, query]);

  const loadSavedKpis = useCallback(async (preferredId?: string | number | null) => {
    setLoadingSaved(true);
    try {
      const items = await customKpiApi.list();
      setSavedKpis(items);
      if (items.length > 0) {
        const nextId = preferredId ?? items[0].id;
        setSelectedKpiId(nextId);
      } else {
        setSelectedKpiId(null);
        setSelectedKpi(null);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load saved KPIs.');
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useEffect(() => {
    void loadSavedKpis();
  }, [loadSavedKpis]);

  useEffect(() => {
    if (loadingSaved || hasAppliedInitialCollapse) return;
    setIsCreateExpanded(savedKpis.length === 0);
    setHasAppliedInitialCollapse(true);
  }, [hasAppliedInitialCollapse, loadingSaved, savedKpis.length]);

  useEffect(() => {
    if (selectedKpiId === null) return;

    let cancelled = false;

    const loadDetail = async () => {
      try {
        const detail = await customKpiApi.detail(selectedKpiId);
        if (!cancelled) {
          setSelectedKpi(detail);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError('Failed to load the selected KPI.');
        }
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedKpiId]);

  const handlePreview = async () => {
    if (!query.trim()) return;
    setError(null);
    setPreviewing(true);

    try {
      const result = await customKpiApi.preview({
        query: query.trim(),
        input_mode: inputMode,
      });
      setPreview(result);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Preview failed.');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!canSubmit) return;
    setError(null);
    setSaving(true);

    try {
      const saved = await customKpiApi.create({
        name: name.trim(),
        description: description.trim() || null,
        query: query.trim(),
        input_mode: inputMode,
      });

      setPreview(saved);
      setSelectedKpiId(saved.id);
      setSelectedKpi(saved);
      setIsCreateExpanded(false);
      await loadSavedKpis(saved.id);
    } catch (err) {
      console.error(err);
      setError('Save failed. The backend must persist the KPI and return the stored result.');
    } finally {
      setSaving(false);
    }
  };

  const activeResult = selectedKpi ?? preview;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Custom KPIs</h1>
        <p className="page-subtitle">
          Define a KPI once with natural language or SQL, save it permanently, and render the stored result under its KPI name.
        </p>
      </div>

      <div
        className="section-gap"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
          gap: 24,
          alignItems: 'start',
          width: '100%',
          maxWidth: '100%',
        }}
      >
        <div className="card-static" style={{ padding: 20, minWidth: 0, width: '100%' }}>
          <button
            type="button"
            onClick={() => setIsCreateExpanded((current) => !current)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: 'var(--text-primary)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>Create KPI</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Define a KPI from natural language or exact SQL and store the latest result.
              </div>
            </div>
            {isCreateExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>

          {isCreateExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 18, minWidth: 0 }}>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  KPI Name
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Weekly publish conversion"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-default)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Description
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional context for what this KPI represents"
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-default)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Query Type
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {[
                    { id: 'natural_language' as const, label: 'Natural Language', icon: MessageSquare },
                    { id: 'sql' as const, label: 'SQL', icon: Database },
                  ].map((option) => {
                    const Icon = option.icon;
                    const active = inputMode === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setInputMode(option.id)}
                        className={active ? 'btn-primary' : 'btn-ghost'}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 14px',
                          maxWidth: '100%',
                        }}
                      >
                        <Icon size={15} />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  {inputMode === 'natural_language' ? 'Natural Language Prompt' : 'SQL Query'}
                </div>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    inputMode === 'natural_language'
                      ? 'e.g. Show publish rate by client for the current quarter'
                      : 'SELECT client_name, COUNT(*) AS published_count FROM ...'
                  }
                  rows={7}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-default)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: inputMode === 'sql' ? 'var(--font-mono)' : 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={previewing || !query.trim()}
                  className="btn-ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', maxWidth: '100%' }}
                >
                  <Play size={15} />
                  {previewing ? 'Previewing...' : 'Preview Result'}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !canSubmit}
                  className="btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', maxWidth: '100%' }}
                >
                  <Save size={15} />
                  {saving ? 'Saving...' : 'Save KPI'}
                </button>
              </div>

              {error && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--red-muted)',
                    color: 'var(--red)',
                    fontSize: '0.85rem',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card-static" style={{ padding: 20, minWidth: 0, width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Table2 size={16} color="var(--text-secondary)" />
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Saved KPIs</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 520, overflowY: 'auto' }}>
            {loadingSaved && (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading saved KPIs...</div>
            )}

            {!loadingSaved && savedKpis.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No custom KPIs have been saved yet.
              </div>
            )}

            {savedKpis.map((item) => {
              const active = item.id === selectedKpiId;
              return (
                <button
                  key={String(item.id)}
                  type="button"
                  onClick={() => setSelectedKpiId(item.id)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${active ? 'var(--border-default)' : 'var(--border-subtle)'}`,
                    background: active ? 'var(--accent-muted)' : 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    width: '100%',
                    minWidth: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4, overflowWrap: 'anywhere' }}>{item.name}</div>
                  {item.description && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                      {item.description}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {(preview || selectedKpi) && (
        <div className="section-gap">
          <div className="page-header" style={{ marginBottom: 16 }}>
            <h2 className="page-title" style={{ fontSize: '1.6rem', overflowWrap: 'anywhere' }}>
              {activeResult?.name || 'KPI Result'}
            </h2>
            {activeResult?.description && (
              <p className="page-subtitle">{activeResult.description}</p>
            )}
          </div>
          <ResultPanel result={activeResult} />
        </div>
      )}
    </div>
  );
}
