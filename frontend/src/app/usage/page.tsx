'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, LineChart, Line, Cell,
} from 'recharts';
import ChartCard from '@/components/ui/ChartCard';
import { useFilters } from '@/lib/filters-context';
import {
  trendsApi, dimensionsApi,
  TrendPoint, CumulativePoint, GrowthPoint, HeatmapCell,
  buildTrendRequest, buildAnalyticsRequest,
} from '@/lib/api';
import { customTooltipStyle, shortDate } from '@/lib/chart-utils';

type Granularity = 'daily' | 'weekly' | 'monthly' | 'quarterly';
const DIMENSIONS = ['channel', 'client', 'user', 'team', 'language', 'input_type', 'output_type', 'platform'];

export default function UsageTrendsPage() {
  const { dateRange, filters, loading: fl } = useFilters();
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [uploadTrend, setUploadTrend] = useState<TrendPoint[]>([]);
  const [processedTrend, setProcessedTrend] = useState<TrendPoint[]>([]);
  const [publishedTrend, setPublishedTrend] = useState<TrendPoint[]>([]);
  const [cumulative, setCumulative] = useState<CumulativePoint[]>([]);
  const [growth, setGrowth] = useState<GrowthPoint[]>([]);
  const [dim1, setDim1] = useState('channel');
  const [dim2, setDim2] = useState('output_type');
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (fl) return;
    setLoading(true);
    try {
      const tReq = buildTrendRequest(dateRange, filters, granularity);
      const [u, p, pb, cu, gr] = await Promise.all([
        trendsApi.timeseries(tReq).catch(() => []),
        trendsApi.processedTimeseries(tReq).catch(() => []),
        trendsApi.publishedTimeseries(tReq).catch(() => []),
        trendsApi.cumulative(tReq).catch(() => []),
        trendsApi.growthRate(tReq).catch(() => []),
      ]);
      setUploadTrend(u as TrendPoint[]);
      setProcessedTrend(p as TrendPoint[]);
      setPublishedTrend(pb as TrendPoint[]);
      setCumulative(cu as CumulativePoint[]);
      setGrowth(gr as GrowthPoint[]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [dateRange, filters, fl, granularity]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (fl) return;
    const req = { ...buildAnalyticsRequest(dateRange, filters), dimension1: dim1, dimension2: dim2 };
    dimensionsApi.heatmap(req).then(d => setHeatmap(d as HeatmapCell[])).catch(() => setHeatmap([]));
  }, [dateRange, filters, fl, dim1, dim2]);

  const merged = (() => {
    const map = new Map<string, { period: string; Uploaded: number; Processed: number; Published: number }>();
    for (const u of uploadTrend) {
      const key = u.period;
      const label = granularity === 'daily' ? shortDate(key) : key;
      map.set(key, { period: label, Uploaded: u.count, Processed: 0, Published: 0 });
    }
    for (const p of processedTrend) {
      const entry = map.get(p.period);
      if (entry) entry.Processed = p.count;
      else map.set(p.period, { period: granularity === 'daily' ? shortDate(p.period) : p.period, Uploaded: 0, Processed: p.count, Published: 0 });
    }
    for (const p of publishedTrend) {
      const entry = map.get(p.period);
      if (entry) entry.Published = p.count;
      else map.set(p.period, { period: granularity === 'daily' ? shortDate(p.period) : p.period, Uploaded: 0, Processed: 0, Published: p.count });
    }
    return Array.from(map.values());
  })();

  const hxLabels = [...new Set(heatmap.map(h => h.x))];
  const hyLabels = [...new Set(heatmap.map(h => h.y))];
  const maxVal = Math.max(...heatmap.map(h => h.value), 1);
  const isLoading = loading || fl;

  return (
    <div className="page-container">
      {/* ─── Page Header ─── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Usage & Trends</h1>
          <p className="page-subtitle">
            Analyze how your content production volume changes over time. Switch between daily, weekly, or monthly granularity to spot patterns, track cumulative growth, and measure period-over-period momentum.
          </p>
        </div>
        <div className="tab-group" style={{ flexShrink: 0, marginTop: 8 }}>
          {(['daily', 'weekly', 'monthly', 'quarterly'] as Granularity[]).map(g => (
            <button key={g} className={`tab-item ${granularity === g ? 'active' : ''}`} onClick={() => setGranularity(g)}>
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Pipeline Volume ─── */}
      <div className="section-gap">
        <ChartCard
          title="Pipeline Volume Over Time"
          description="How many videos were uploaded, processed, and published during each period. The shaded areas help visualize the volume gap between stages — a growing gap may indicate bottlenecks."
          loading={isLoading}
          minHeight={320}
          isEmpty={merged.length === 0}
          emptyMessage="No pipeline volume data for this period"
        >
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={merged} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={customTooltipStyle()} />
              <Legend wrapperStyle={{ fontSize: '0.75rem', paddingTop: 12 }} />
              <Area type="monotone" dataKey="Uploaded" stroke="#dc2626" fill="url(#g1)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="Processed" stroke="#f87171" fill="url(#g2)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="Published" stroke="#22c55e" fill="url(#g3)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ─── Cumulative + Growth ─── */}
      <div className="section-gap grid-2">
        <ChartCard
          title="Cumulative Growth"
          description="Running total of all uploads since the start of the selected period. An ever-steepening curve indicates accelerating content production."
          loading={isLoading}
          minHeight={280}
          isEmpty={cumulative.length === 0}
          emptyMessage="No cumulative data available"
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={cumulative.map(c => ({ ...c, period: shortDate(c.period) }))} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={customTooltipStyle()} />
              <Line type="monotone" dataKey="cumulative_count" stroke="#dc2626" strokeWidth={2.5} dot={false} name="Total Uploads" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Growth Rate"
          description="Period-over-period percentage change in upload volume. Green bars indicate growth, red bars indicate decline."
          loading={isLoading}
          minHeight={280}
          isEmpty={growth.length === 0}
          emptyMessage="No growth rate data available"
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={growth.map(g => ({ ...g, period: granularity === 'daily' ? shortDate(g.period) : g.period }))} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit="%" />
              <Tooltip contentStyle={customTooltipStyle()} formatter={(v: unknown) => v !== null ? `${Number(v).toFixed(1)}%` : 'N/A'} />
              <Bar dataKey="growth_pct" name="Growth %" radius={[4, 4, 0, 0]} maxBarSize={24}>
                {growth.map((g, i) => (
                  <Cell key={i} fill={g.growth_pct !== null && g.growth_pct >= 0 ? 'var(--green)' : 'var(--red)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ─── Multi-Dim Heatmap ─── */}
      {/* <div className="section-gap">
        <ChartCard
          title="Multi-Dimensional Analysis"
          description={`Compare video counts across two dimensions simultaneously. Select any combination of dimensions to discover patterns — for example, which channels produce the most of each output type.`}
          loading={isLoading}
          minHeight={300}
          actions={
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <select className="input-field" style={{ width: 140, fontSize: '0.78rem', padding: '6px 10px' }} value={dim1} onChange={e => setDim1(e.target.value)}>
                {DIMENSIONS.map(d => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
              </select>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>vs</span>
              <select className="input-field" style={{ width: 140, fontSize: '0.78rem', padding: '6px 10px' }} value={dim2} onChange={e => setDim2(e.target.value)}>
                {DIMENSIONS.map(d => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
              </select>
            </div>
          }
        >
          {heatmap.length === 0 ? (
            <div className="empty-state">
              <p>No data available for this dimension combination. Try selecting different dimensions or adjusting your filters.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', padding: '8px 4px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${hyLabels.length}, minmax(70px, 1fr))`, gap: 4 }}>
                <div />
                {hyLabels.map(y => (
                  <div key={y} style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', textAlign: 'center', padding: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{y}</div>
                ))}
                {hxLabels.map(x => (
                  <React.Fragment key={x}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', padding: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x}</div>
                    {hyLabels.map(y => {
                      const cell = heatmap.find(h => h.x === x && h.y === y);
                      const val = cell?.value ?? 0;
                      const intensity = val / maxVal;
                      return (
                        <div
                          key={`${x}-${y}`}
                          style={{
                            background: `rgba(220, 38, 38, ${0.04 + intensity * 0.55})`,
                            borderRadius: 'var(--radius-sm)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 8,
                            fontSize: '0.72rem',
                            fontFamily: 'var(--font-mono)',
                            color: intensity > 0.45 ? '#fff' : 'var(--text-secondary)',
                            minHeight: 36,
                            transition: 'background var(--transition-fast)',
                          }}
                          title={`${x} × ${y}: ${val}`}
                        >
                          {val > 0 ? val : ''}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </ChartCard>
      </div> */}
    </div>
  );
}
