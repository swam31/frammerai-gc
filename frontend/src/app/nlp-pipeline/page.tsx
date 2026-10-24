'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Database,
  GitBranch,
  Info,
  MessageSquare,
  Play,
  Sparkles,
  Terminal,
  Wand2,
} from 'lucide-react';
import { format } from 'sql-formatter';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import DataTable from '@/components/ui/DataTable';
import ChartCard from '@/components/ui/ChartCard';
import { CodeBlock } from '@/components/ui/code-block';
import { CHART_COLORS, customTooltipStyle } from '@/lib/chart-utils';

type PipelineResult = {
  response_type?: 'query' | 'information';
  route?: 'SQL' | 'KPI';
  route_reason?: string;
  question?: string;
  answer_nl?: string;
  kpi_matches?: { name: string; definition: string }[];
  plan_ms?: number;
  plan?: {
    complexity?: string;
    plan?: { step: number; description: string; tables?: string[] }[];
  } | null;
  retrieved_examples?: { question: string }[];
  attempts?: {
    attempt: number;
    verdict?: string;
    reason?: string;
    fix_hint?: string;
    sql?: string | null;
    gen_ms?: number;
    ver_ms?: number;
  }[];
  sql?: string | null;
  verification?: { verdict?: string; reason?: string } | null;
  sanity?: { passed?: boolean; warning?: string | null } | null;
  error?: string | null;
  df_records?: Record<string, unknown>[];
  columns?: string[];
};

const promptModes = [
  {
    icon: Database,
    badge: 'Query Route',
    badgeClass: 'badge-neutral',
    title: 'Ask for data, rankings, filters, and breakdowns',
    copy:
      'These prompts go through planner, retrieval, SQL generation, verification, and sanity checks before returning the existing table and chart response.',
    prompt: 'Which team uploaded the most Hindi videos this month?',
  },
  {
    icon: BookOpen,
    badge: 'KPI Route',
    badgeClass: 'badge-info',
    title: 'Ask what a KPI means or how it should be interpreted',
    copy:
      'These prompts bypass SQL output and return a definition-style explanation with matched KPI concepts and guidance for business users.',
    prompt: 'What is Clip Multiplication?',
  },
];

export default function NlpPipelinePage() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isInfoResult = result?.response_type === 'information' || result?.route === 'KPI';

  useEffect(() => {
    const prompt = searchParams.get('prompt');
    if (!prompt) return;

    setQuery(prompt);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const length = prompt.length;
      inputRef.current?.setSelectionRange(length, length);
    });
  }, [searchParams]);

  const handleGenerate = async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    setResult(null);
    setShowPlan(false);
    setShowExamples(false);
    setShowTrace(false);
    setShowSql(true);

    try {
      const endpoint = process.env.NEXT_PUBLIC_API_URL
        ? `${process.env.NEXT_PUBLIC_API_URL}/nlp-pipeline/query`
        : 'http://localhost:8000/api/v1/nlp-pipeline/query';

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        setResult({ error: data?.detail || 'Failed to process the request.' });
      } else {
        setResult(data);
      }
    } catch (err) {
      console.error(err);
      setResult({ error: 'Failed to connect to the NLP API.' });
    } finally {
      setIsLoading(false);
    }
  };

  const renderSmartChart = (records: Record<string, unknown>[], cols: string[]) => {
    if (records.length === 0 || cols.length < 2) return null;

    const numericCols = cols.filter((col) => typeof records[0]?.[col] === 'number');
    if (numericCols.length === 0) return null;

    return (
      <ChartCard title="Visualization" loading={false} minHeight={300}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={records} margin={{ top: 8, right: 12, left: -8, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={cols[0]} tick={{ fontSize: 9 }} angle={-25} textAnchor="end" />
            <YAxis tick={{ fontSize: 10 }} width={36} />
            <RechartsTooltip contentStyle={customTooltipStyle()} />
            <Legend wrapperStyle={{ fontSize: '0.72rem', paddingTop: 8 }} />
            {numericCols.map((metric, idx) => (
              <Bar
                key={metric}
                dataKey={metric}
                fill={CHART_COLORS[idx % CHART_COLORS.length]}
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    );
  };

  const renderInformationResult = () => {
    if (!result) return null;

    return (
      <div className="section-gap" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="nlp-info-hero card-static">
          <div className="nlp-info-hero__glow" />
          <div className="nlp-info-hero__layout">
            <div className="nlp-info-hero__main">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="badge badge-info">
                  <BookOpen size={14} /> KPI Information Route
                </span>
                {result.route_reason && <span className="badge badge-neutral">{result.route_reason}</span>}
              </div>

              <div>
                <div className="label" style={{ marginBottom: 12 }}>Explanation Response</div>
                <h2 className="nlp-info-hero__title">
                  {result.answer_nl || 'No KPI explanation was generated.'}
                </h2>
              </div>

              <div className="nlp-info-hero__note">
                <Sparkles size={18} style={{ marginTop: 2, flexShrink: 0, color: 'var(--text-accent)' }} />
                <div>
                  Definition-style prompts stay in this guide format. Data retrieval prompts still use the existing SQL result layout.
                </div>
              </div>
            </div>

            <div className="nlp-info-hero__panel">
              <div className="nlp-info-hero__panel-head">
                <Info size={18} />
                <div>Routed question</div>
              </div>
              <div className="nlp-info-hero__question">{result.question || query}</div>
              <div className="nlp-info-hero__stats">
                <div className="nlp-info-stat">
                  <div className="label">Response Type</div>
                  <div className="kpi-number-sm">Info</div>
                </div>
                <div className="nlp-info-stat">
                  <div className="label">Matched KPIs</div>
                  <div className="kpi-number-sm">{result.kpi_matches?.length || 0}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {result.error && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--red-muted)',
              color: 'var(--red)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: '0.85rem',
            }}
          >
            <AlertTriangle size={18} />
            <span>
              <strong>Error:</strong> {result.error}
            </span>
          </div>
        )}

        <div className="grid-2 stagger">
          <div className="card-static nlp-info-answer-card">
            <div className="nlp-info-answer-card__head">
              <Wand2 size={18} />
              <div>
                <div className="section-title">KPI Summary</div>
                <div className="section-description">A compact business explanation for the question asked.</div>
              </div>
            </div>
            <div className="nlp-info-answer-card__body">
              {result.answer_nl || 'No KPI explanation was generated.'}
            </div>
          </div>

          <div className="card-static nlp-info-answer-card">
            <div className="nlp-info-answer-card__head">
              <GitBranch size={18} />
              <div>
                <div className="section-title">How To Use This Route</div>
                <div className="section-description">Use this when you need meaning, not rows.</div>
              </div>
            </div>
            <div className="nlp-info-route-list">
              <div className="nlp-info-route-item">
                <span className="accent-dot" />
                Ask what a KPI represents, how it is interpreted, or why it matters.
              </div>
              <div className="nlp-info-route-item">
                <span className="accent-dot" />
                Ask a query route question when you need rankings, counts, comparisons, or filtered tables.
              </div>
              <div className="nlp-info-route-item">
                <span className="accent-dot" />
                The query output format remains unchanged and separate from this KPI explanation surface.
              </div>
            </div>
          </div>
        </div>

        <div className="grid-3 stagger">
          {(result.kpi_matches || []).map((match, idx) => (
            <div
              key={`${match.name}-${idx}`}
              className={`card-static nlp-kpi-match-card ${idx === 0 ? 'is-primary' : ''}`}
            >
              <div className="nlp-kpi-match-card__tag">
                <span className="nlp-kpi-match-card__dot" />
                {idx === 0 ? 'Closest Match' : `Related KPI ${idx + 1}`}
              </div>
              <div className="nlp-kpi-match-card__title">{match.name}</div>
              <div className="nlp-kpi-match-card__body">{match.definition}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderQueryResult = () => {
    if (!result) return null;

    return (
      <div className="section-gap" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="grid-3 stagger">
          <div className="card-static" style={{ padding: '16px', cursor: 'pointer' }} onClick={() => setShowPlan(!showPlan)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600 }}>
                <Database size={16} /> Query Plan <span className="badge badge-neutral">{result.plan_ms}ms</span>
              </div>
              {showPlan ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
            {showPlan && (
              <div style={{ marginTop: 12, padding: '12px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Complexity: {result.plan?.complexity || 'SIMPLE'}</div>
                {result.plan?.plan?.map((step, idx) => (
                  <div key={idx} style={{ marginBottom: 4 }}>
                    <strong>Step {step.step}:</strong> {step.description} <br />
                    <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>Tables: {step.tables?.join(', ') || 'None'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card-static" style={{ padding: '16px', cursor: 'pointer' }} onClick={() => setShowExamples(!showExamples)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600 }}>
                <MessageSquare size={16} /> Retrieved Examples (BM25)
              </div>
              {showExamples ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
            {showExamples && (
              <div style={{ marginTop: 12, padding: '12px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <ul style={{ paddingLeft: 16, margin: 0 }}>
                  {result.retrieved_examples?.map((ex, idx) => (
                    <li key={idx} style={{ marginBottom: 8 }}>
                      {ex.question}
                    </li>
                  ))}
                </ul>
                {(!result.retrieved_examples || result.retrieved_examples.length === 0) && 'No examples retrieved.'}
              </div>
            )}
          </div>

          <div className="card-static" style={{ padding: '16px', cursor: 'pointer' }} onClick={() => setShowTrace(!showTrace)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600 }}>
                <Terminal size={16} /> Pipeline Trace
              </div>
              {showTrace ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
            {showTrace && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.attempts?.map((attempt, idx) => (
                  <div key={idx} style={{ padding: '12px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>
                        Attempt {attempt.attempt} - {attempt.verdict}
                      </strong>
                      <span style={{ color: 'var(--text-muted)' }}>
                        Gen: {attempt.gen_ms}ms | Vfy: {attempt.ver_ms}ms
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>
                      <strong>Reason:</strong> {attempt.reason || '-'}
                    </div>
                    {attempt.fix_hint && (
                      <div style={{ color: 'var(--amber)', marginBottom: 4 }}>
                        <strong>Fix Hint:</strong> {attempt.fix_hint}
                      </div>
                    )}
                    {attempt.sql && (
                      <pre
                        style={{
                          background: '#1e1e1e',
                          color: '#d4d4d4',
                          padding: '8px',
                          borderRadius: '4px',
                          overflowX: 'auto',
                          fontSize: '0.75rem',
                          marginTop: 8,
                        }}
                      >
                        {attempt.sql}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            className="card-static"
            style={{ padding: '16px', cursor: 'pointer', gridColumn: '1 / -1', width: '100%', maxWidth: 'none', boxSizing: 'border-box' }}
            onClick={() => setShowSql(!showSql)}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600 }}>
                <Database size={16} /> Generated SQL
              </div>
              {showSql ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
            {showSql && (
              <div style={{ marginTop: 12 }}>
                {result.sql ? (
                  <CodeBlock
                    language="sql"
                    filename="generated_query.sql"
                    code={format(result.sql, { language: 'sqlite', keywordCase: 'upper' })}
                  />
                ) : (
                  <div style={{ padding: '12px', color: 'var(--text-muted)', background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
                    No SQL was generated.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {(result.verification?.verdict === 'PASS' || result.sanity?.warning || result.error) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {result.error && (
              <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', background: 'var(--red-muted)', color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.85rem' }}>
                <AlertTriangle size={18} />
                <span>
                  <strong>Error:</strong> {result.error}
                </span>
              </div>
            )}
            {result.verification?.verdict === 'PASS' && !result.error && (
              <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', background: 'var(--green-muted)', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.85rem' }}>
                <CheckCircle size={18} />
                <span>
                  <strong>Verification passed:</strong> {result.verification.reason}
                </span>
              </div>
            )}
            {result.sanity && !result.sanity.passed && (
              <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', background: 'var(--amber-muted)', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.85rem' }}>
                <AlertTriangle size={18} />
                <span>
                  <strong>Sanity Check Warning:</strong> {result.sanity.warning}
                </span>
              </div>
            )}
            {result.verification?.verdict !== 'PASS' && (result.attempts?.length || 0) >= 3 && !result.error && (
              <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', background: 'var(--amber-muted)', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.85rem' }}>
                <AlertTriangle size={18} />
                <span>
                  <strong>Verification failed after retries:</strong> {result.verification?.reason}
                </span>
              </div>
            )}
          </div>
        )}

        {result.df_records && result.df_records.length > 0 && result.columns && (
          <div className="stagger" style={{ animationDelay: '0.1s' }}>
            {result.answer_nl && (
              <div style={{ marginBottom: 20, padding: '16px', background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', display: 'flex', gap: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <MessageSquare size={12} color="#fff" />
                </div>
                <div style={{ color: 'var(--text-primary)', fontSize: '1rem', lineHeight: 1.5, fontWeight: 500 }}>{result.answer_nl}</div>
              </div>
            )}

            <div className="card-static" style={{ overflow: 'hidden', marginBottom: 24 }}>
              <DataTable
                columns={result.columns.map((col) => ({
                  key: col,
                  label: col.replace(/_/g, ' '),
                  sortable: true,
                  align:
                    typeof result.df_records?.[0]?.[col] === 'number'
                      ? 'right'
                      : 'left',
                }))}
                data={result.df_records}
                pageSize={10}
              />
            </div>

            {renderSmartChart(result.df_records, result.columns)}
          </div>
        )}

        {result.df_records && result.df_records.length === 0 && !result.error && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }}>
            Query returned no results.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="nlp-hero">
          <div className="nlp-hero__glow" />
          <div className="nlp-hero__content">
            <div className="nlp-hero__copy">
              <div className="nlp-hero__eyebrow">
                <Sparkles size={14} /> Dual-route analytics assistant
              </div>
              <h1 className="page-title" style={{ marginBottom: 10 }}>NLP Analytics Pipeline</h1>
              <p className="page-subtitle" style={{ maxWidth: 780 }}>
                One input box, two response modes. Ask for data and the app stays on the SQL pipeline. Ask what a KPI means and the app switches to a cleaner explanation format for metric guidance.
              </p>
              <div className="nlp-hero__chips">
                <span className="badge badge-neutral">
                  <Database size={13} /> Query route keeps the current result format
                </span>
                <span className="badge badge-info">
                  <BookOpen size={13} /> KPI route returns structured explanation cards
                </span>
              </div>
            </div>

            <div className="nlp-hero__flow card-static">
              <div className="label" style={{ marginBottom: 12 }}>Our Pipeline</div>
              <div style={{ width: '100%', overflowX: 'auto' }}>
                <svg
                  width="100%"
                  viewBox="0 0 850 188"
                  xmlns="http://www.w3.org/2000/svg"
                  className="nlp-page-header__diagram"
                  preserveAspectRatio="xMidYMid meet"
                  style={{ minWidth: 700 }}
                >
                  <defs>
                    <marker id="ph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                      <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </marker>
                    <style>{`
                      @keyframes ph-flow { 0%{stroke-dashoffset:26} 100%{stroke-dashoffset:0} }
                      @keyframes ph-pop  { 0%{opacity:0;transform:translateY(8px) scale(0.96)} 100%{opacity:1;transform:translateY(0) scale(1)} }
                      .ph-pipe  { stroke-dasharray:6 4; animation:ph-flow 1.15s linear infinite; fill:none; stroke-width:1.4; }
                      .ph-step  { animation:ph-pop 0.42s ease-out both; }
                      .ph-s1{animation-delay:0s} .ph-s2{animation-delay:.08s} .ph-s3{animation-delay:.16s}
                      .ph-s4{animation-delay:.24s} .ph-s5{animation-delay:.32s} .ph-s6{animation-delay:.4s} .ph-s7{animation-delay:.48s}
                      .ph-box { fill: var(--bg-surface-solid); stroke: var(--border-default); }
                      .ph-query { fill: rgba(220,38,38,0.10); stroke: var(--border-strong); }
                      .ph-kpi { fill: rgba(59,130,246,0.10); stroke: rgba(59,130,246,0.28); }
                      .ph-title { fill: var(--text-primary); }
                      .ph-sub { fill: var(--text-secondary); opacity: 0.96; }
                      .ph-connector { stroke: var(--border-strong); }
                      .ph-connector-kpi { stroke: rgba(59,130,246,0.45); }
                      @media(prefers-reduced-motion:reduce){
                        .ph-pipe{animation:none;stroke-dasharray:none} .ph-step{animation:none}
                      }
                    `}</style>
                  </defs>

                  <g className="ph-step ph-s1">
                    <rect x="22" y="70" width="126" height="48" rx="12" className="ph-box" strokeWidth="1" />
                    <text x="85" y="88" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" fontFamily="inherit" className="ph-title">User Prompt</text>
                    <text x="85" y="104" textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="inherit" className="ph-sub">Natural language input</text>
                  </g>
                  <line x1="148" y1="94" x2="188" y2="94" className="ph-pipe ph-connector" markerEnd="url(#ph-arrow)" />

                  <g className="ph-step ph-s2">
                    <rect x="190" y="70" width="136" height="48" rx="12" className="ph-box" strokeWidth="1" />
                    <text x="258" y="88" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" fontFamily="inherit" className="ph-title">Intent Router</text>
                    <text x="258" y="104" textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="inherit" className="ph-sub">Query vs KPI</text>
                  </g>

                  <path d="M326 86 C360 86 362 54 396 54" className="ph-pipe ph-connector-kpi" markerEnd="url(#ph-arrow)" />
                  <path d="M326 102 C360 102 362 134 396 134" className="ph-pipe ph-connector" markerEnd="url(#ph-arrow)" />

                  <g className="ph-step ph-s3">
                    <rect x="398" y="30" width="146" height="48" rx="12" className="ph-kpi" strokeWidth="1" />
                    <text x="471" y="48" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" fontFamily="inherit" className="ph-title">KPI Guide</text>
                    <text x="471" y="64" textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="inherit" className="ph-sub">Definitions and meaning</text>
                  </g>
                  <line x1="544" y1="54" x2="590" y2="54" className="ph-pipe ph-connector-kpi" markerEnd="url(#ph-arrow)" />
                  <g className="ph-step ph-s4">
                    <rect x="592" y="30" width="144" height="48" rx="12" className="ph-kpi" strokeWidth="1" />
                    <text x="664" y="48" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" fontFamily="inherit" className="ph-title">Explanation Cards</text>
                    <text x="664" y="64" textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="inherit" className="ph-sub">Formatted KPI output</text>
                  </g>

                  <g className="ph-step ph-s5">
                    <rect x="398" y="110" width="126" height="48" rx="12" className="ph-query" strokeWidth="1" />
                    <text x="461" y="128" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" fontFamily="inherit" className="ph-title">BM25</text>
                    <text x="461" y="144" textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="inherit" className="ph-sub">Example retrieval</text>
                  </g>
                  <line x1="524" y1="134" x2="548" y2="134" className="ph-pipe ph-connector" markerEnd="url(#ph-arrow)" />
                  <g className="ph-step ph-s6">
                    <rect x="550" y="110" width="126" height="48" rx="12" className="ph-query" strokeWidth="1" />
                    <text x="613" y="128" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" fontFamily="inherit" className="ph-title">SQL + Verify</text>
                    <text x="613" y="144" textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="inherit" className="ph-sub">Generation pipeline</text>
                  </g>
                  <line x1="676" y1="134" x2="690" y2="134" className="ph-pipe ph-connector" markerEnd="url(#ph-arrow)" />
                  <g className="ph-step ph-s7">
                    <rect x="692" y="110" width="138" height="48" rx="12" className="ph-query" strokeWidth="1" />
                    <text x="761" y="128" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" fontFamily="inherit" className="ph-title">Table + Chart</text>
                    <text x="761" y="144" textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="inherit" className="ph-sub">Existing query view</text>
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="nlp-mode-grid">
          {promptModes.map((mode) => {
            const Icon = mode.icon;
            return (
              <div key={mode.title} className="card-static nlp-mode-card">
                <div className="nlp-mode-card__top">
                  <span className={`badge ${mode.badgeClass}`}>
                    <Icon size={13} /> {mode.badge}
                  </span>
                </div>
                <div className="nlp-mode-card__title">{mode.title}</div>
                <div className="nlp-mode-card__copy">{mode.copy}</div>
                <div className="nlp-mode-card__prompt">
                  <span className="label">Example Prompt</span>
                  <div>{mode.prompt}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="section-gap">
        <div className="card-static nlp-input-shell">
          <div style={{ flex: 1, position: 'relative' }}>
            <MessageSquare size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleGenerate()}
              placeholder="e.g. Which team uploaded the most Hindi videos? or What is Clip Multiplication?"
              className="nlp-input-shell__field"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={isLoading || !query.trim()}
            className="btn-primary nlp-input-shell__button"
          >
            {isLoading ? (
              <>
                <div style={{ width: 16, height: 16, border: '2px solid #ccc', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                Processing...
              </>
            ) : (
              <>
                <Play size={16} /> Generate
              </>
            )}
          </button>
        </div>
      </div>

      {result && (isInfoResult ? renderInformationResult() : renderQueryResult())}

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes spin { 100% { transform: rotate(360deg); } }
            @media (max-width: 980px) {
              .nlp-hero__content,
              .nlp-info-hero > div {
                grid-template-columns: 1fr !important;
              }
            }
          `,
        }}
      />
    </div>
  );
}
