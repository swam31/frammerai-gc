"use client";

import React, {
  Suspense,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import { ArrowDown } from "lucide-react";
import ChartCard from "@/components/ui/ChartCard";
import DataTable from "@/components/ui/DataTable";
import KpiCard from "@/components/ui/KpiCard";
import { useFilters } from "@/lib/filters-context";
import {
  funnelApi,
  contentApi,
  languageApi,
  platformApi,
  FunnelStage,
  FunnelDimensionItem,
  BottleneckItem,
  TypeMixItem,
  TypeTrendItem,
  LangDistItem,
  PlatformDistItem,
  buildAnalyticsRequest,
  buildTrendRequest,
} from "@/lib/api";
import {
  CHART_COLORS,
  customTooltipStyle,
  formatNumber,
} from "@/lib/chart-utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

function ContentFunnelPageContent() {
  const { dateRange, filters, loading: fl } = useFilters();
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [funnelDim, setFunnelDim] = useState<FunnelDimensionItem[]>([]);
  const [bottlenecks, setBottlenecks] = useState<BottleneckItem[]>([]);
  const [outputMix, setOutputMix] = useState<TypeMixItem[]>([]);
  const [inputMix, setInputMix] = useState<TypeMixItem[]>([]);
  const [typeTrends, setTypeTrends] = useState<TypeTrendItem[]>([]);
  const [langDist, setLangDist] = useState<LangDistItem[]>([]);
  const [platDist, setPlatDist] = useState<PlatformDistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (fl) return;
    setLoading(true);
    try {
      const req = buildAnalyticsRequest(dateRange, filters);
      const tReq = buildTrendRequest(dateRange, filters, "monthly");
      const topReq = {
        ...req,
        dimension: "channel",
        n: 10,
        sort: "desc" as const,
      };
      const [fu, fd, bn, om, im, tt, ld, pd] = await Promise.all([
        funnelApi.overview(req).catch(() => []),
        funnelApi.byDimension(topReq).catch(() => []),
        funnelApi.bottlenecks(topReq).catch(() => []),
        contentApi.outputTypeMix(req).catch(() => []),
        contentApi.inputTypeMix(req).catch(() => []),
        contentApi.typeTrends(tReq).catch(() => []),
        languageApi.distribution(req).catch(() => []),
        platformApi.distribution(req).catch(() => []),
      ]);
      setFunnel(fu as FunnelStage[]);
      setFunnelDim(fd as FunnelDimensionItem[]);
      setBottlenecks(bn as BottleneckItem[]);
      setOutputMix(om as TypeMixItem[]);
      setInputMix(im as TypeMixItem[]);
      setTypeTrends(tt as TypeTrendItem[]);
      setLangDist(ld as LangDistItem[]);
      setPlatDist(pd as PlatformDistItem[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [dateRange, filters, fl]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);
  const isLoading = loading || fl;

  const funnelMaxCount = Math.max(
    ...funnel.map((stage) => Number(stage.count) || 0),
    1,
  );
  const normalizedOutputMix = useMemo(
    () =>
      outputMix
        .map((item) => ({
          ...item,
          output_type: (item.output_type || "Unknown").trim(),
          count: Number(item.count) || 0,
          share_pct: Number(item.share_pct) || 0,
        }))
        .filter((item) => item.count > 0),
    [outputMix],
  );
  const normalizedInputMix = useMemo(
    () =>
      inputMix
        .map((item) => ({
          ...item,
          input_type: (item.input_type || "Unknown").trim(),
          count: Number(item.count) || 0,
          share_pct: Number(item.share_pct) || 0,
        }))
        .filter((item) => item.count > 0),
    [inputMix],
  );

  const trendSeriesMap = new Map<string, string>();
  typeTrends.forEach((item) => {
    const label = (item.output_type || item.input_type || "").trim();
    if (item.period && label && !trendSeriesMap.has(label)) {
      trendSeriesMap.set(label, `series_${trendSeriesMap.size}`);
    }
  });

  const trendSeries = Array.from(trendSeriesMap.entries()).map(
    ([label, key]) => ({ label, key }),
  );
  const trendPeriods = [
    ...new Set(typeTrends.map((item) => item.period).filter(Boolean)),
  ].sort();
  const stackedRows = new Map<string, Record<string, string | number>>();

  trendPeriods.forEach((period) => {
    const row: Record<string, string | number> = { period };
    trendSeries.forEach((series) => {
      row[series.key] = 0;
    });
    stackedRows.set(period, row);
  });

  typeTrends.forEach((item) => {
    const label = (item.output_type || item.input_type || "").trim();
    const seriesKey = trendSeriesMap.get(label);
    const row = stackedRows.get(item.period);
    if (!seriesKey || !row) return;
    row[seriesKey] = Number(item.count) || 0;
  });

  const stackedData = Array.from(stackedRows.values());
  const hasTrendData = stackedData.some((row) =>
    trendSeries.some((series) => Number(row[series.key]) > 0),
  );

  return (
    <div className="page-container">
      {/* ─── Header ─── */}
      <div className="page-header">
        <h1 className="page-title">Content & Publishing Funnel</h1>
        <p className="page-subtitle">
          This page explains how source videos move from intake to processing to
          publication, and how the final content mix is distributed across
          formats, languages, and platforms. It is meant to be read both as an
          operational page and as an editorial portfolio page, so you can see
          where content volume is concentrated, where conversion breaks down,
          and whether the mix of outputs actually reflects the strategy you
          want.
        </p>
      </div>

      {/* ─── Funnel Visual ─── */}
      <div className="section-gap">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div className="accent-bar" />
          <h3 className="section-title">Publishing Pipeline</h3>
        </div>
        <p className="section-description" style={{ marginBottom: 28 }}>
          Every uploaded video can move through three stages: uploaded,
          processed at least once, and published at least once. The narrowing
          funnel below shows how many source videos reach each stage - and where
          the biggest drop-offs occur.
        </p>

        <div
          className="stagger"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0,
          }}
        >
          {funnel.length === 0 && !isLoading && (
            <div className="empty-state" style={{ padding: "40px 0" }}>
              <p>No pipeline data available for the selected filters.</p>
            </div>
          )}
          {funnel.map((stage, i) => {
            const stageCount = Number(stage.count) || 0;
            const widthPct = Math.max(
              35,
              Math.min(100, (stageCount / funnelMaxCount) * 100),
            );
            const dropOffValue =
              stage.drop_off_pct === null || stage.drop_off_pct === undefined
                ? null
                : Number(stage.drop_off_pct);
            const isGrowth = dropOffValue !== null && dropOffValue < 0;
            return (
              <React.Fragment key={stage.stage}>
                <div
                  className="card"
                  style={{
                    width: `clamp(280px, ${widthPct}%, 100%)`,
                    maxWidth: "100%",
                    padding: "20px 28px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "width 0.6s ease",
                  }}
                >
                  <div>
                    <div className="label" style={{ marginBottom: 6 }}>
                      {stage.stage}
                    </div>
                    <div className="kpi-number-sm">
                      {formatNumber(stage.count)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {Number(stage.duration_hours).toFixed(1)} hrs
                    </div>
                    {dropOffValue !== null && Number.isFinite(dropOffValue) && (
                      <span
                        className={`badge ${isGrowth ? "badge-success" : "badge-danger"}`}
                        style={{ marginTop: 6 }}
                      >
                        {Math.abs(dropOffValue).toFixed(1)}%{" "}
                        {isGrowth ? "growth" : "drop-off"}
                      </span>
                    )}
                  </div>
                </div>
                {i < funnel.length - 1 && (
                  <div style={{ padding: "6px 0", color: "var(--text-muted)" }}>
                    <ArrowDown size={18} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ─── Conversion KPIs ─── */}
      {funnel.length >= 3 && (
        <div className="section-gap">
          <div className="grid-3">
            <KpiCard
              title="Upload → Process"
              value={
                funnel[0].count > 0
                  ? (funnel[1].count / funnel[0].count) * 100
                  : 0
              }
              suffix="%"
              description="Share of uploaded source videos that successfully generate at least one processed output. Low values here usually indicate stalled production, failed processing, or content that never gets packaged."
              loading={isLoading}
            />
            <KpiCard
              title="Process → Publish"
              value={
                funnel[1].count > 0
                  ? (funnel[2].count / funnel[1].count) * 100
                  : 0
              }
              suffix="%"
              description="Share of processed source videos that ultimately reach publication. This is the cleanest measure of how much created content actually reaches an audience instead of remaining stranded in workflow."
              loading={isLoading}
            />
            <KpiCard
              title="End-to-End Rate"
              value={
                funnel[0].count > 0
                  ? (funnel[2].count / funnel[0].count) * 100
                  : 0
              }
              suffix="%"
              description="Overall conversion from initial upload to at least one publish event. This is the most compact end-to-end efficiency metric on the page."
              loading={isLoading}
            />
          </div>
        </div>
      )}

      {/* ─── Bottlenecks + Funnel by Dimension ─── */}
      <div className="grid-2 section-gap">
        <ChartCard
          title="Funnel by Channel"
          description="Compares uploaded, processed, and published counts for each channel so bottlenecks are visible at the channel level. If uploaded volume is healthy but published volume stays weak, that channel likely has production friction, editorial deprioritization, or publishing failure."
          loading={isLoading}
          minHeight={280}
          isEmpty={funnelDim.length === 0}
          emptyMessage="No channel funnel data available"
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={funnelDim}
              margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="dimension_label"
                tick={{ fontSize: 9 }}
                angle={-12}
                textAnchor="end"
                height={45}
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={customTooltipStyle()} />
              <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
              <Bar
                dataKey="uploaded_count"
                name="Uploaded"
                fill="#dc2626"
                radius={[4, 4, 0, 0]}
                maxBarSize={20}
              />
              <Bar
                dataKey="processed_count"
                name="Processed"
                fill="#f87171"
                radius={[4, 4, 0, 0]}
                maxBarSize={20}
              />
              <Bar
                dataKey="published_count"
                name="Published"
                fill="#22c55e"
                radius={[4, 4, 0, 0]}
                maxBarSize={20}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Publishing Bottlenecks"
          description="Entities with the largest gap between processed and published videos - these are your biggest opportunities to improve publish rates."
          loading={isLoading}
          minHeight={280}
        >
          <DataTable
            columns={[
              { key: "dimension_label", label: "Entity", sortable: true },
              {
                key: "processed_count",
                label: "Processed",
                sortable: true,
                align: "right",
              },
              {
                key: "published_count",
                label: "Published",
                sortable: true,
                align: "right",
              },
              {
                key: "gap_count",
                label: "Gap",
                sortable: true,
                align: "right",
                render: (r: any) => (
                  <span className="delta-down">
                    {formatNumber(r.gap_count)}
                  </span>
                ),
              },
              {
                key: "gap_pct",
                label: "Gap %",
                sortable: true,
                align: "right",
                render: (r: any) => (
                  <span className="badge badge-danger">
                    {Number(r.gap_pct).toFixed(1)}%
                  </span>
                ),
              },
            ]}
            data={bottlenecks as any[]}
            pageSize={6}
          />
        </ChartCard>
      </div>

      {/* ─── Content Mix ─── */}
      <div className="section-gap">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div className="accent-bar" />
          <h3 className="section-title">Content Type Mix</h3>
        </div>
        <p className="section-description" style={{ marginBottom: 28 }}>
          This section shows the structural mix of your content catalog. It
          separates output formats from input sources so you can tell whether
          the team is intentionally diversifying content, over-relying on a few
          packaging formats, or simply reflecting whatever types of source
          material are entering the system.
        </p>

        <div className="grid-2">
          <ChartCard
            title="Output Format Distribution"
            description="Shows how total content volume is split across output formats such as chapters, summaries, packages, or key moments. Use it to see whether the production engine is balanced across formats or overly dependent on one type of output."
            loading={isLoading}
            minHeight={280}
            isEmpty={normalizedOutputMix.length === 0}
            emptyMessage="No output type data available"
          >
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={normalizedOutputMix}
                  dataKey="count"
                  nameKey="output_type"
                  cx="50%"
                  cy="42%"
                  innerRadius={50}
                  outerRadius={92}
                  minAngle={6}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {normalizedOutputMix.map((_, i) => (
                    <Cell
                      key={i}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={customTooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard
            title="Input Source Distribution"
            description="Shows the intake-side composition of the pipeline by input type. This helps distinguish whether the downstream output mix is being driven by editorial choice or by the makeup of incoming source material."
            loading={isLoading}
            minHeight={280}
            isEmpty={normalizedInputMix.length === 0}
            emptyMessage="No input type data available"
          >
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={normalizedInputMix}
                  dataKey="count"
                  nameKey="input_type"
                  cx="50%"
                  cy="42%"
                  innerRadius={50}
                  outerRadius={92}
                  minAngle={6}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {normalizedInputMix.map((_, i) => (
                    <Cell
                      key={i}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={customTooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      {/* ─── Type Trends ─── */}
      <div className="section-gap">
        <ChartCard
          title="Output Type Trends Over Time"
          description="Tracks how each output format rises or falls over time. This makes it easier to separate one-off spikes from real strategic shifts and to see whether the portfolio is becoming more concentrated or more balanced month by month."
          loading={isLoading}
          minHeight={320}
          isEmpty={!hasTrendData}
          emptyMessage="No output type trend data for this period"
        >
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart
              data={stackedData}
              margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={customTooltipStyle()} />
              <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
              {trendSeries.map((series, i) => (
                <Area
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stackId="1"
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={0.35}
                  strokeWidth={1.5}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ─── Language + Platform ─── */}
      <div className="grid-2">
        <ChartCard
          title="Language Distribution"
          description="Shows the share of content being created across languages. This is useful for understanding multilingual coverage, localization investment, and whether language output is aligned with the audiences the organization is trying to reach."
          loading={isLoading}
          minHeight={240}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={langDist}
              margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="language" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={customTooltipStyle()} />
              <Bar
                dataKey="count"
                fill="#dc2626"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              >
                {langDist.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard
          title="Platform Distribution"
          description="Shows where published outputs are ultimately distributed. This makes platform strategy visible: whether content is concentrated on a few destinations, broadly diversified, or missing expected publishing surfaces."
          loading={isLoading}
          minHeight={240}
        >
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={platDist}
                dataKey="count"
                nameKey="platform"
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={80}
                paddingAngle={3}
                strokeWidth={0}
              >
                {platDist.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={customTooltipStyle()} />
              <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

export default function ContentFunnelPage() {
  return (
    <Suspense
      fallback={<div className="page-container">Loading content funnel...</div>}
    >
      <ContentFunnelPageContent />
    </Suspense>
  );
}
