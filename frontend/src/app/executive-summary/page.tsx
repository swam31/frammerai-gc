"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Line,
  ComposedChart,
} from "recharts";
import {
  Upload,
  Cpu,
  Send,
  AlertTriangle,
  Clock,
  Activity,
  Users,
  Building2,
  Radio,
  Timer,
  Target,
  Layers,
  Globe,
  TrendingUp,
  ShieldCheck,
  Languages,
  CalendarDays,
  Repeat,
  PackageCheck,
  Scissors,
  UserCheck,
} from "lucide-react";
import KpiCard from "@/components/ui/KpiCard";
import ChartCard from "@/components/ui/ChartCard";
import DataTable from "@/components/ui/DataTable";
import { useFilters } from "@/lib/filters-context";
import {
  kpiApi,
  trendsApi,
  alertsApi,
  rankingsApi,
  operationalApi,
  productivityApi,
  funnelApi,
  OutputTypeCard,
  TrendPoint,
  AnomalyAlert,
  RankedItem,
  FunnelStage,
  OperationalKPIs,
  CategoryPerformance,
  TeamEfficiencyItem,
  PipelineVelocityPoint,
  buildAnalyticsRequest,
  buildTrendRequest,
  buildComparisonRequest,
} from "@/lib/api";
import {
  CHART_COLORS,
  customTooltipStyle,
  formatNumber,
  shortDate,
} from "@/lib/chart-utils";

const EMPTY_OPERATIONAL_KPIS: OperationalKPIs = {
  active_clients: 0,
  total_clients: 0,
  active_users: 0,
  total_users: 0,
  active_channels: 0,
  total_channels: 0,
  clip_multiplication_rate: 0,
  duration_compression_ratio: 0,
  avg_input_duration_seconds: 0,
  avg_output_duration_seconds: 0,
  billable_rate_pct: 0,
  input_to_output_conversion_pct: 0,
  avg_days_upload_to_process: 0,
  avg_days_process_to_publish: 0,
  avg_days_upload_to_publish: 0,
  multi_platform_reach: 0,
  unique_platforms_used: 0,
  unique_languages_used: 0,
  data_completeness_pct: 0,
  publishing_dropout_pct: 0,
  translation_rate_pct: 0,
  translation_duration_uplift: 0,
  weekend_publish_rate_pct: 0,
  content_reuse_ratio: 0,
  full_repurposing_rate_pct: 0,
  mixed_language_fragment_rate: 0,
  avg_languages_per_channel: 0,
  avg_platforms_per_client: 0,
  fully_saturated_clients: 0,
  total_platforms_available: 0,
  avg_monthly_published_clips_per_channel: 0,
  best_channel_monthly_clips: 0,
  worst_channel_monthly_clips: 0,
  channel_monthly_throughput_stddev: 0,
  avg_monthly_published_clips_per_client: 0,
  best_client_monthly_clips: 0,
  best_client_name: undefined,
  worst_client_monthly_clips: 0,
  worst_client_name: undefined,
  user_upload_retention_rate_pct: 0,
  single_month_user_pct: 0,
  rarely_active_user_cmr_paradox: 0,
  rarely_active_clips_per_upload: 0,
  active_user_clips_per_upload: 0,
};

export default function ExecutiveSummaryPage() {
  const { dateRange, filters, loading: filtersLoading } = useFilters();

  const [pipelineStages, setPipelineStages] = useState<FunnelStage[]>([]);
  const [kpiDelta, setKpiDelta] = useState<Record<string, number>>({});
  const [cards, setCards] = useState<OutputTypeCard[]>([]);
  const [uploadTrend, setUploadTrend] = useState<TrendPoint[]>([]);
  const [processedTrend, setProcessedTrend] = useState<TrendPoint[]>([]);
  const [publishedTrend, setPublishedTrend] = useState<TrendPoint[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>([]);
  const [topChannels, setTopChannels] = useState<RankedItem[]>([]);
  const [opKpis, setOpKpis] = useState<OperationalKPIs | null>(null);
  const [categories, setCategories] = useState<CategoryPerformance[]>([]);
  const [teams, setTeams] = useState<TeamEfficiencyItem[]>([]);
  const [velocity, setVelocity] = useState<PipelineVelocityPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (filtersLoading) return;
    setLoading(true);
    try {
      const req = buildAnalyticsRequest(dateRange, filters);
      const trendReq = buildTrendRequest(dateRange, filters, "daily");
      const weeklyReq = buildTrendRequest(dateRange, filters, "weekly");

      let compReq = null;
      if (dateRange.start_date && dateRange.end_date) {
        const start = new Date(dateRange.start_date);
        const end = new Date(dateRange.end_date);
        const diffMs = end.getTime() - start.getTime();
        const prevEnd = new Date(start.getTime() - 86400000);
        const prevStart = new Date(prevEnd.getTime() - diffMs);
        compReq = buildComparisonRequest(
          dateRange,
          {
            start_date: prevStart.toISOString().split("T")[0],
            end_date: prevEnd.toISOString().split("T")[0],
          },
          filters,
        );
      }

      const [
        funnelRes,
        cardsRes,
        uploadRes,
        processedRes,
        publishedRes,
        anomalyRes,
        topRes,
        opRes,
        catRes,
        teamRes,
        velRes,
      ] = await Promise.all([
        funnelApi.overview(req).catch(() => []),
        kpiApi.cards(req).catch(() => []),
        trendsApi.timeseries(trendReq).catch(() => []),
        trendsApi.processedTimeseries(trendReq).catch(() => []),
        trendsApi.publishedTimeseries(trendReq).catch(() => []),
        alertsApi.anomalies(req).catch(() => []),
        rankingsApi
          .topN({ ...req, dimension: "channel", n: 5, sort: "desc" })
          .catch(() => []),
        operationalApi.kpis(req).catch(() => null),
        operationalApi.categoryPerformance(req).catch(() => []),
        productivityApi.teamEfficiency(req).catch(() => []),
        productivityApi.pipelineVelocity(weeklyReq).catch(() => []),
      ]);

      setPipelineStages(funnelRes as FunnelStage[]);
      setCards(cardsRes as OutputTypeCard[]);
      setUploadTrend(uploadRes as TrendPoint[]);
      setProcessedTrend(processedRes as TrendPoint[]);
      setPublishedTrend(publishedRes as TrendPoint[]);
      setAnomalies(anomalyRes as AnomalyAlert[]);
      setTopChannels(topRes as RankedItem[]);
      setOpKpis(opRes as OperationalKPIs | null);
      setCategories((catRes as CategoryPerformance[]).slice(0, 8));
      setTeams(teamRes as TeamEfficiencyItem[]);
      setVelocity(velRes as PipelineVelocityPoint[]);

      if (compReq) {
        try {
          const previousReq = buildAnalyticsRequest(
            compReq.date_range.previous ?? {},
            filters,
          );
          const previousStages = await funnelApi
            .overview(previousReq)
            .catch(() => []);
          const currentMap = Object.fromEntries(
            (funnelRes as FunnelStage[]).map((stage) => [
              stage.stage,
              stage.count,
            ]),
          );
          const previousMap = Object.fromEntries(
            (previousStages as FunnelStage[]).map((stage) => [
              stage.stage,
              stage.count,
            ]),
          );
          const pctChange = (current: number, previous: number) =>
            previous
              ? Number((((current - previous) / previous) * 100).toFixed(2))
              : 0;

          if ((funnelRes as FunnelStage[]).length) {
            setKpiDelta({
              uploaded_count: pctChange(
                currentMap.Uploaded ?? 0,
                previousMap.Uploaded ?? 0,
              ),
              processed_count: pctChange(
                currentMap.Processed ?? 0,
                previousMap.Processed ?? 0,
              ),
              published_count: pctChange(
                currentMap.Published ?? 0,
                previousMap.Published ?? 0,
              ),
            });
          }
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dateRange, filters, filtersLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const mergedTrend = (() => {
    const map = new Map<
      string,
      { period: string; Uploaded: number; Processed: number; Published: number }
    >();
    for (const u of uploadTrend) {
      const label = shortDate(u.period);
      map.set(u.period, {
        period: label,
        Uploaded: u.count,
        Processed: 0,
        Published: 0,
      });
    }
    for (const p of processedTrend) {
      const entry = map.get(p.period);
      if (entry) entry.Processed = p.count;
      else
        map.set(p.period, {
          period: shortDate(p.period),
          Uploaded: 0,
          Processed: p.count,
          Published: 0,
        });
    }
    for (const p of publishedTrend) {
      const entry = map.get(p.period);
      if (entry) entry.Published = p.count;
      else
        map.set(p.period, {
          period: shortDate(p.period),
          Uploaded: 0,
          Processed: 0,
          Published: p.count,
        });
    }
    return Array.from(map.values());
  })();

  const renderChannelTick = (props: {
    x?: number | string;
    y?: number | string;
    payload?: { value?: string | number };
  }) => {
    const { x = 0, y = 0, payload } = props;
    const xPos = Number(x) || 0;
    const yPos = Number(y) || 0;
    const words = String(payload?.value ?? "").split(" ");
    const midpoint = Math.ceil(words.length / 2);
    const lines =
      words.length > 2
        ? [words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" ")]
        : [words.join(" ")];

    return (
      <text
        x={xPos}
        y={yPos}
        textAnchor="end"
        fill="var(--text-muted)"
        fontSize={10}
      >
        {lines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={x} dy={index === 0 ? 0 : 12}>
            {line}
          </tspan>
        ))}
      </text>
    );
  };

  const isLoading = loading || filtersLoading;
  const op = opKpis ?? EMPTY_OPERATIONAL_KPIS;

  const uploadedStage = pipelineStages.find(
    (stage) => stage.stage === "Uploaded",
  );
  const processedStage = pipelineStages.find(
    (stage) => stage.stage === "Processed",
  );
  const publishedStage = pipelineStages.find(
    (stage) => stage.stage === "Published",
  );

  const velocityChart = velocity.map((v) => ({
    period: shortDate(v.period),
    "Upload → Process": v.avg_days_upload_to_process,
    "Process → Publish": v.avg_days_process_to_publish,
    "End-to-End": v.avg_days_end_to_end,
    Throughput: v.throughput_count,
  }));

  const teamLeaderboard = [...teams]
    .sort((a, b) => b.efficiency_score - a.efficiency_score)
    .map((team, index) => ({ ...team, rank: index + 1 }));

  const teamRadar = teamLeaderboard.slice(0, 6).map((t) => ({
    team:
      t.team_name.length > 12 ? t.team_name.slice(0, 12) + "…" : t.team_name,
    "Clips/Upload": t.clips_per_upload * 20,
    "Publish %": t.publish_rate_pct,
    "Uploads/Member": t.uploads_per_member,
    Score: t.efficiency_score,
  }));

  return (
    <div className="page-container">
      {/* ─── Page Header ─── */}
      <div className="page-header">
        <h1 className="page-title">Executive Summary</h1>
        <p className="page-subtitle">
          A bird&apos;s-eye view of your media operations pipeline. Track how
          content moves from upload through processing to final publication
          across all your channels and teams.
        </p>
      </div>

      {/* ─── Pipeline KPI Cards ─── */}
      <div className="section-gap">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 20,
          }}
        >
          <div className="accent-bar" />
          <h3 className="section-title">Pipeline Performance</h3>
        </div>
        <p className="section-description" style={{ marginBottom: 24 }}>
          Core pipeline metrics tracking content from upload through AI
          processing to final publication.
        </p>

        <div className="grid-3 stagger">
          <KpiCard
            title="Videos Uploaded"
            value={uploadedStage?.count ?? 0}
            description={`${Number(uploadedStage?.duration_hours ?? 0).toFixed(1)} hours of source uploads ingested`}
            delta={kpiDelta.uploaded_count || null}
            icon={<Upload size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Videos Processed"
            value={processedStage?.count ?? 0}
            description={`${Number(processedStage?.duration_hours ?? 0).toFixed(1)} hours from source videos that produced at least one output`}
            delta={kpiDelta.processed_count || null}
            icon={<Cpu size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Videos Published"
            value={publishedStage?.count ?? 0}
            description={`${Number(publishedStage?.duration_hours ?? 0).toFixed(1)} hours from source videos that produced at least one published output`}
            delta={kpiDelta.published_count || null}
            icon={<Send size={16} />}
            loading={isLoading}
          />
        </div>
      </div>

      {/* ─── Operational KPI Cards ─── */}
      <div className="section-gap">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 20,
          }}
        >
          <div className="accent-bar" />
          <h3 className="section-title">Operational Metrics</h3>
        </div>
        <p className="section-description" style={{ marginBottom: 24 }}>
          Derived metrics measuring platform health, conversion efficiency, and
          content velocity.
        </p>

        <div style={{ marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 12 }}>
            Core Activity
          </div>
          <div className="grid-5 stagger">
            <KpiCard
              title="Active Clients"
              value={op.active_clients}
              suffix={`/ ${op.total_clients}`}
              description="Clients with uploads in selected period"
              icon={<Building2 size={16} />}
              loading={isLoading}
            />
            <KpiCard
              title="Active Users"
              value={op.active_users}
              suffix={`/ ${op.total_users}`}
              description="Users contributing content this period"
              icon={<Users size={16} />}
              loading={isLoading}
            />
            <KpiCard
              title="Active Channels"
              value={op.active_channels}
              suffix={`/ ${op.total_channels}`}
              description="Channels with activity in period"
              icon={<Radio size={16} />}
              loading={isLoading}
            />
            <KpiCard
              title="Clip Multiplication"
              value={op.clip_multiplication_rate}
              suffix="x"
              description="Output clips generated per input video"
              icon={<Layers size={16} />}
              loading={isLoading}
            />
            <KpiCard
              title="Conversion Rate"
              value={op.input_to_output_conversion_pct}
              suffix="%"
              description="Uploads that produce at least one clip"
              icon={<Target size={16} />}
              loading={isLoading}
            />
          </div>
        </div>

        <div className="label" style={{ marginBottom: 12 }}>
          Velocity & Reach
        </div>
        <div className="grid-5 stagger" style={{ marginTop: 16 }}>
          <KpiCard
            title="Billable Rate"
            value={op.billable_rate_pct}
            suffix="%"
            description="Publish events marked as billable"
            icon={<Activity size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Duration Compression"
            value={Math.round(op.duration_compression_ratio * 100)}
            suffix="%"
            description="Output duration as % of input (shorter clips)"
            icon={<Timer size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Avg Upload → Process"
            value={op.avg_days_upload_to_process}
            suffix="days"
            description="Average time from upload to clip creation"
            icon={<Clock size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Avg Process → Publish"
            value={op.avg_days_process_to_publish}
            suffix="days"
            description="Average time from creation to publishing"
            icon={<TrendingUp size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Platforms Reached"
            value={op.unique_platforms_used}
            description={`${op.unique_languages_used} languages in use`}
            icon={<Globe size={16} />}
            loading={isLoading}
          />
        </div>

        <div className="label" style={{ marginBottom: 12, marginTop: 16 }}>
          Quality & Localization
        </div>
        <div className="grid-5 stagger" style={{ marginTop: 16 }}>
          <KpiCard
            title="Data Completeness"
            value={op.data_completeness_pct}
            suffix="%"
            description="Pipeline records without logged DQ issues"
            icon={<ShieldCheck size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Publishing Dropout"
            value={op.publishing_dropout_pct}
            suffix="%"
            description="Created outputs that never reach a publish event"
            icon={<AlertTriangle size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Translation Rate"
            value={op.translation_rate_pct}
            suffix="%"
            description="Published outputs where output language differs from source"
            icon={<Languages size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Translation Uplift"
            value={op.translation_duration_uplift}
            suffix="x"
            description="Avg translated published duration vs non-translated"
            icon={<TrendingUp size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Weekend Publish Rate"
            value={op.weekend_publish_rate_pct}
            suffix="%"
            description="Publish events landing on Saturday or Sunday"
            icon={<CalendarDays size={16} />}
            loading={isLoading}
          />
        </div>

        <div className="label" style={{ marginBottom: 12, marginTop: 16 }}>
          Repurposing & Diversity
        </div>
        <div className="grid-5 stagger" style={{ marginTop: 16 }}>
          <KpiCard
            title="Content Reuse Ratio"
            value={op.content_reuse_ratio}
            suffix="types"
            description="Average distinct output types generated per input"
            icon={<Repeat size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Full Repurposing"
            value={op.full_repurposing_rate_pct}
            suffix="%"
            description="Inputs that generated all 5 output types"
            icon={<PackageCheck size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Mix Fragment Rate"
            value={op.mixed_language_fragment_rate}
            suffix="%"
            description="Mix-language outputs that are not Full Package"
            icon={<Scissors size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Languages / Channel"
            value={op.avg_languages_per_channel}
            suffix="avg"
            description="Average distinct languages served by each active channel"
            icon={<Languages size={16} />}
            loading={isLoading}
          />
        </div>

        <div className="label" style={{ marginBottom: 12, marginTop: 16 }}>
          Saturation & Throughput
        </div>
        <div className="grid-4 stagger" style={{ marginTop: 16 }}>
          <KpiCard
            title="Client Platform Saturation"
            value={op.avg_platforms_per_client}
            suffix={`/ ${op.total_platforms_available}`}
            description={`${op.fully_saturated_clients} clients publish to every tracked platform`}
            icon={<Globe size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Channel Throughput Gap"
            value={op.avg_monthly_published_clips_per_channel}
            suffix="clips/mo"
            description={`Best ${op.best_channel_monthly_clips.toFixed(1)} | Worst ${op.worst_channel_monthly_clips.toFixed(1)} | SD ${op.channel_monthly_throughput_stddev.toFixed(1)}`}
            icon={<Activity size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Client Throughput Cliff"
            value={op.avg_monthly_published_clips_per_client}
            suffix="clips/mo"
            description={`${op.best_client_name ?? "Best"} ${op.best_client_monthly_clips.toFixed(1)} | ${op.worst_client_name ?? "Worst"} ${op.worst_client_monthly_clips.toFixed(1)}`}
            icon={<Building2 size={16} />}
            loading={isLoading}
          />
        </div>

        <div className="label" style={{ marginBottom: 12, marginTop: 16 }}>
          User Retention & Cohorts
        </div>
        <div className="grid-4 stagger" style={{ marginTop: 16 }}>
          <KpiCard
            title="Upload Retention"
            value={op.user_upload_retention_rate_pct}
            suffix="%"
            description={`${op.single_month_user_pct.toFixed(1)}% of uploaders appear in only one month`}
            icon={<UserCheck size={16} />}
            loading={isLoading}
          />
          <KpiCard
            title="Rarely Active CMR"
            value={op.rarely_active_user_cmr_paradox}
            suffix="x"
            description={`Rarely active ${op.rarely_active_clips_per_upload.toFixed(2)} vs active ${op.active_user_clips_per_upload.toFixed(2)} clips/upload`}
            icon={<Repeat size={16} />}
            loading={isLoading}
          />
        </div>
      </div>

      {/* ─── Output Type Cards ─── */}
      {cards.length > 0 && (
        <div className="section-gap">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div className="accent-bar" />
            <h3 className="section-title">Output Format Breakdown</h3>
          </div>
          <p className="section-description" style={{ marginBottom: 24 }}>
            Content is automatically converted into multiple output formats.
            Here&apos;s how volume and publish rates break down across each
            type.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
            }}
            className="stagger"
          >
            {cards.map((card) => (
              <div
                key={card.output_type_id}
                className="card"
                style={{ padding: "24px 20px" }}
              >
                <div className="label" style={{ marginBottom: 14 }}>
                  {card.output_type}
                </div>
                <div className="kpi-number-sm" style={{ marginBottom: 8 }}>
                  {formatNumber(card.total_count)}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-secondary)",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <Clock size={11} />{" "}
                    {Number(card.total_duration_hours).toFixed(1)} hrs
                  </span>
                  <span
                    className={`badge ${card.publish_rate_pct >= 50 ? "badge-success" : "badge-warning"}`}
                  >
                    {Number(card.publish_rate_pct).toFixed(0)}% published
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Main Charts Row: Pipeline Trend + Right column ─── */}
      <div className="section-gap">
        <div className="grid-2" style={{ alignItems: "start" }}>
          <ChartCard
            title="Pipeline Trend"
            description="Daily volume of videos through Upload → Process → Publish."
            loading={isLoading}
            minHeight={450}
            isEmpty={mergedTrend.length === 0}
            emptyMessage="No pipeline trend data for this period"
            fullscreenContent={
              <ResponsiveContainer
                width={Math.max(mergedTrend.length * 28, 800)}
                height={600}
              >
                <AreaChart
                  data={mergedTrend}
                  margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="fsGUp" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="#dc2626"
                        stopOpacity={0.25}
                      />
                      <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="fsGPr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f87171" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="fsGPb" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend
                    wrapperStyle={{ fontSize: "0.75rem", paddingTop: 12 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="Uploaded"
                    stroke="#dc2626"
                    fill="url(#fsGUp)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="Processed"
                    stroke="#f87171"
                    fill="url(#fsGPr)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="Published"
                    stroke="#22c55e"
                    fill="url(#fsGPb)"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            }
          >
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart
                data={mergedTrend}
                margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#dc2626" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gPr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gPb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={36} />
                <Tooltip contentStyle={customTooltipStyle()} />
                <Legend
                  wrapperStyle={{ fontSize: "0.75rem", paddingTop: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="Uploaded"
                  stroke="#dc2626"
                  fill="url(#gUp)"
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="Processed"
                  stroke="#f87171"
                  fill="url(#gPr)"
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="Published"
                  stroke="#22c55e"
                  fill="url(#gPb)"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              height: "100%",
            }}
          >
            <ChartCard
              title="Top Channels"
              description="Channels with the highest upload volume."
              loading={isLoading}
              minHeight={220}
              isEmpty={topChannels.length === 0}
              emptyMessage="No channel data"
            >
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={topChannels}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 28, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={renderChannelTick}
                    width={118}
                  />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={14}>
                    {topChannels.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Output Mix"
              description="Proportion of each output format produced."
              loading={isLoading}
              minHeight={260}
            >
              <ResponsiveContainer width="100%" height={295}>
                <PieChart>
                  <Pie
                    data={cards}
                    dataKey="total_count"
                    nameKey="output_type"
                    cx="50%"
                    cy="38%"
                    innerRadius={42}
                    outerRadius={82}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {cards.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend
                    verticalAlign="bottom"
                    align="center"
                    wrapperStyle={{
                      fontSize: "0.7rem",
                      width: "100%",
                      paddingTop: 18,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      </div>

      {/* ─── Content Category Performance + Pipeline Velocity ─── */}
      <div className="section-gap">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 20,
          }}
        >
          <div className="accent-bar" />
          <h3 className="section-title">Content Category Performance</h3>
        </div>
        <p className="section-description" style={{ marginBottom: 24 }}>
          How each output category performs across the pipeline - from upload
          volume to publish and billable rates.
        </p>

        <div className="grid-2">
          <ChartCard
            title="Category Clip Rate & Publish Rate"
            description="Clip multiplication rate and publish rate by content category."
            loading={isLoading}
            minHeight={280}
            isEmpty={categories.length === 0}
            emptyMessage="No category performance data"
            fullscreenContent={
              <ResponsiveContainer
                width={Math.max(categories.length * 120, 600)}
                height="100%"
              >
                <ComposedChart
                  data={categories}
                  margin={{ top: 8, right: 24, left: 0, bottom: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="category_name"
                    tick={{ fontSize: 10 }}
                    angle={-30}
                    textAnchor="end"
                  />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={36} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10 }}
                    unit="%"
                    width={36}
                  />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend
                    wrapperStyle={{ fontSize: "0.75rem", paddingTop: 12 }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="clip_multiplication_rate"
                    name="Clip Rate"
                    fill="#dc2626"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={32}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="publish_rate_pct"
                    name="Publish %"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="billable_rate_pct"
                    name="Billable %"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            }
          >
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart
                data={categories}
                margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="category_name"
                  tick={{ fontSize: 9 }}
                  angle={-25}
                  textAnchor="end"
                />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={36} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  unit="%"
                  width={36}
                />
                <Tooltip contentStyle={customTooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: "0.72rem", paddingTop: 8 }} />
                <Bar
                  yAxisId="left"
                  dataKey="clip_multiplication_rate"
                  name="Clip Rate"
                  fill="#dc2626"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="publish_rate_pct"
                  name="Publish %"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="billable_rate_pct"
                  name="Billable %"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Pipeline Velocity"
            description="Average days between pipeline stages and throughput over time."
            loading={isLoading}
            minHeight={280}
            isEmpty={velocityChart.length === 0}
            emptyMessage="No pipeline velocity data"
            fullscreenContent={
              <ResponsiveContainer
                width={Math.max(velocityChart.length * 60, 800)}
                height="100%"
              >
                <ComposedChart
                  data={velocityChart}
                  margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10 }}
                    width={42}
                    label={{
                      value: "Days",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10 },
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10 }}
                    width={42}
                    label={{
                      value: "Clips",
                      angle: 90,
                      position: "insideRight",
                      style: { fontSize: 10 },
                    }}
                  />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend
                    wrapperStyle={{ fontSize: "0.75rem", paddingTop: 12 }}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="End-to-End"
                    fill="rgba(220,38,38,0.08)"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Upload → Process"
                    stroke="#f87171"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Process → Publish"
                    stroke="#eab308"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="Throughput"
                    fill="rgba(59,130,246,0.35)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            }
          >
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart
                data={velocityChart}
                margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={36} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  width={36}
                />
                <Tooltip contentStyle={customTooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: "0.72rem", paddingTop: 8 }} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="End-to-End"
                  fill="rgba(220,38,38,0.08)"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="Upload → Process"
                  stroke="#f87171"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="Process → Publish"
                  stroke="#eab308"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Bar
                  yAxisId="right"
                  dataKey="Throughput"
                  fill="rgba(59,130,246,0.35)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={16}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      {/* ─── Team Efficiency + Category Volume ─── */}
      {(teams.length > 0 || categories.length > 0) && (
        <div className="section-gap">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div className="accent-bar" />
            <h3 className="section-title">Team & Category Insights</h3>
          </div>
          <p className="section-description" style={{ marginBottom: 24 }}>
            Compare team productivity and see how content volume distributes
            across categories.
          </p>

          <div className="grid-2">
            {teams.length > 0 && (
              <ChartCard
                title="Team Efficiency Radar"
                description="Comparative view of team performance across key efficiency metrics."
                loading={isLoading}
                minHeight={300}
              >
                <ResponsiveContainer width="100%" height={280}>
                  <RadarChart
                    data={teamRadar}
                    cx="50%"
                    cy="50%"
                    outerRadius="70%"
                  >
                    <PolarGrid stroke="var(--border-subtle)" />
                    <PolarAngleAxis
                      dataKey="team"
                      tick={{ fontSize: 9, fill: "var(--text-secondary)" }}
                    />
                    <PolarRadiusAxis
                      tick={{ fontSize: 8, fill: "var(--text-muted)" }}
                    />
                    <Radar
                      name="Publish %"
                      dataKey="Publish %"
                      stroke="#22c55e"
                      fill="#22c55e"
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                    <Radar
                      name="Score"
                      dataKey="Score"
                      stroke="#dc2626"
                      fill="#dc2626"
                      fillOpacity={0.1}
                      strokeWidth={2}
                    />
                    <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                    <Tooltip contentStyle={customTooltipStyle()} />
                  </RadarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {categories.length > 0 && (
              <ChartCard
                title="Category Volume Distribution"
                description="Upload, output, and published counts by content category."
                loading={isLoading}
                minHeight={300}
                fullscreenContent={
                  <ResponsiveContainer
                    width={Math.max(categories.length * 120, 600)}
                    height="100%"
                  >
                    <BarChart
                      data={categories}
                      margin={{ top: 8, right: 24, left: 0, bottom: 60 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="category_name"
                        tick={{ fontSize: 10 }}
                        angle={-30}
                        textAnchor="end"
                      />
                      <YAxis tick={{ fontSize: 10 }} width={36} />
                      <Tooltip contentStyle={customTooltipStyle()} />
                      <Legend
                        wrapperStyle={{ fontSize: "0.75rem", paddingTop: 12 }}
                      />
                      <Bar
                        dataKey="total_uploads"
                        name="Uploads"
                        fill="#dc2626"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                      />
                      <Bar
                        dataKey="total_outputs"
                        name="Outputs"
                        fill="#f87171"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                      />
                      <Bar
                        dataKey="total_published"
                        name="Published"
                        fill="#22c55e"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                }
              >
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={categories}
                    margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="category_name"
                      tick={{ fontSize: 9 }}
                      angle={-25}
                      textAnchor="end"
                    />
                    <YAxis tick={{ fontSize: 10 }} width={36} />
                    <Tooltip contentStyle={customTooltipStyle()} />
                    <Legend
                      wrapperStyle={{ fontSize: "0.72rem", paddingTop: 8 }}
                    />
                    <Bar
                      dataKey="total_uploads"
                      name="Uploads"
                      fill="#dc2626"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={24}
                    />
                    <Bar
                      dataKey="total_outputs"
                      name="Outputs"
                      fill="#f87171"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={24}
                    />
                    <Bar
                      dataKey="total_published"
                      name="Published"
                      fill="#22c55e"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={24}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>
        </div>
      )}

      {/* ─── Team Efficiency Table ─── */}
      {teams.length > 0 && (
        <div className="section-gap">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div className="accent-bar" />
            <h3 className="section-title">Team Efficiency Leaderboard</h3>
          </div>
          <p className="section-description" style={{ marginBottom: 20 }}>
            Ranked by composite efficiency score factoring in uploads per
            member, clip generation rate, and publish success.
          </p>

          <div className="card-static" style={{ overflow: "hidden" }}>
            <DataTable
              columns={[
                {
                  key: "rank",
                  label: "#",
                  sortable: true,
                  width: 56,
                  render: (row: (typeof teamLeaderboard)[number]) => (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {row.rank}
                    </span>
                  ),
                },
                { key: "team_name", label: "Team", sortable: true },
                {
                  key: "member_count",
                  label: "Members",
                  sortable: true,
                  align: "right",
                },
                {
                  key: "uploads",
                  label: "Uploads",
                  sortable: true,
                  align: "right",
                  render: (row: (typeof teamLeaderboard)[number]) =>
                    formatNumber(row.uploads),
                },
                {
                  key: "outputs",
                  label: "Outputs",
                  sortable: true,
                  align: "right",
                  render: (row: (typeof teamLeaderboard)[number]) =>
                    formatNumber(row.outputs),
                },
                {
                  key: "published",
                  label: "Published",
                  sortable: true,
                  align: "right",
                  render: (row: (typeof teamLeaderboard)[number]) =>
                    formatNumber(row.published),
                },
                {
                  key: "clips_per_upload",
                  label: "Clips/Upload",
                  sortable: true,
                  align: "right",
                  render: (row: (typeof teamLeaderboard)[number]) =>
                    row.clips_per_upload.toFixed(1),
                },
                {
                  key: "publish_rate_pct",
                  label: "Publish %",
                  sortable: true,
                  align: "right",
                  render: (row: (typeof teamLeaderboard)[number]) => (
                    <span
                      className={`badge ${row.publish_rate_pct >= 50 ? "badge-success" : "badge-warning"}`}
                    >
                      {row.publish_rate_pct.toFixed(1)}%
                    </span>
                  ),
                },
                {
                  key: "efficiency_score",
                  label: "Score",
                  sortable: true,
                  align: "right",
                  render: (row: (typeof teamLeaderboard)[number]) => (
                    <span
                      style={{
                        textAlign: "right",
                        fontFamily: "var(--font-mono)",
                        fontWeight: 600,
                        color: "var(--accent-soft)",
                      }}
                    >
                      {row.efficiency_score.toFixed(1)}
                    </span>
                  ),
                },
              ]}
              data={teamLeaderboard}
              pageSize={8}
            />
          </div>
        </div>
      )}

      {/* ─── Alerts ─── */}
      {anomalies.length > 0 && (
        <div className="section-gap">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div className="accent-bar" />
            <h3 className="section-title">Anomaly Alerts</h3>
          </div>
          <p className="section-description" style={{ marginBottom: 20 }}>
            Automated statistical outlier detection flagged these unusual
            patterns. Review to identify unexpected activity changes.
          </p>
          <div className="card-static" style={{ padding: "4px 8px" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {anomalies.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "16px 20px",
                    borderBottom:
                      i < anomalies.length - 1
                        ? "1px solid var(--border-subtle)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "var(--radius-sm)",
                      background:
                        a.severity === "high"
                          ? "var(--red-muted)"
                          : a.severity === "medium"
                            ? "var(--amber-muted)"
                            : "var(--accent-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <AlertTriangle
                      size={14}
                      style={{
                        color:
                          a.severity === "high"
                            ? "var(--red)"
                            : a.severity === "medium"
                              ? "var(--amber)"
                              : "var(--text-secondary)",
                      }}
                    />
                  </div>
                  <span
                    style={{ fontSize: "0.85rem", flex: 1, lineHeight: 1.5 }}
                  >
                    {a.message}
                  </span>
                  <span
                    className={`badge ${a.severity === "high" ? "badge-danger" : a.severity === "medium" ? "badge-warning" : "badge-neutral"}`}
                  >
                    {a.severity}
                  </span>
                  <span
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Activity
                      size={11}
                      style={{ marginRight: 4, verticalAlign: "middle" }}
                    />
                    {Number(a.deviation_pct ?? 0).toFixed(1)}% deviation
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
