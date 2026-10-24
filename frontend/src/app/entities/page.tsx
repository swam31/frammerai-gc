"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  ScatterChart,
  Scatter,
  ZAxis,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  AreaChart,
  Area,
  ComposedChart,
  Line,
  Treemap,
} from "recharts";
import { Building2, Users, UsersRound, Monitor } from "lucide-react";
import ChartCard from "@/components/ui/ChartCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import TreemapTooltip from "@/components/ui/TreemapTooltip";
import { useFilters } from "@/lib/filters-context";
import {
  channelApi,
  clientApi,
  userApi,
  teamApi,
  dimensionsApi,
  funnelApi,
  productivityApi,
  ChannelPerf,
  ClientPerf,
  UserPerf,
  UnderutilizedUser,
  TeamPerf,
  TeamMember,
  UsageDistItem,
  CrossDimensionCell,
  FunnelDimensionItem,
  UserProductivityItem,
  TeamEfficiencyItem,
  HeatmapCell,
  EntityTrend,
  PlatformReachItem,
  buildAnalyticsRequest,
  buildTrendRequest,
} from "@/lib/api";
import {
  CHART_COLORS,
  customTooltipStyle,
  formatNumber,
} from "@/lib/chart-utils";

type Tab = "channels" | "clients" | "users" | "teams";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Heatmap cell renderer for Treemap
const TreemapCell = (props: any) => {
  const { x, y, width, height, name, value } = props;
  if (width < 4 || height < 4) return null;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        style={{
          fill: CHART_COLORS[
            Math.abs(String(name).charCodeAt(0)) % CHART_COLORS.length
          ],
          stroke: "var(--bg-page)",
          strokeWidth: 2,
          opacity: 0.85,
        }}
      />
      {width > 40 && height > 24 && (
        <>
          <text
            x={x + 6}
            y={y + 16}
            fill="var(--text-on-accent)"
            fontSize={10}
            fontWeight={600}
          >
            {String(name).slice(0, Math.floor(width / 6))}
          </text>
          <text x={x + 6} y={y + 30} fill="rgba(255,255,255,0.7)" fontSize={9}>
            {formatNumber(value)}
          </text>
        </>
      )}
    </g>
  );
};

function selectTopEntries<T>(
  items: T[],
  scoreFn: (item: T) => number,
  limit: number,
) {
  return [...items].sort((a, b) => scoreFn(b) - scoreFn(a)).slice(0, limit);
}

const MAX_TREND_SERIES = 8;

export default function EntityAnalysisPage() {
  const { dateRange, filters, loading: fl } = useFilters();
  const [tab, setTab] = useState<Tab>("channels");

  // Entity data
  const [channels, setChannels] = useState<ChannelPerf[]>([]);
  const [clients, setClients] = useState<ClientPerf[]>([]);
  const [clientDist, setClientDist] = useState<UsageDistItem[]>([]);
  const [usersData, setUsersData] = useState<UserPerf[]>([]);
  const [underutilized, setUnderutilized] = useState<UnderutilizedUser[]>([]);
  const [teamsData, setTeamsData] = useState<TeamPerf[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // Multi-dimensional data
  const [crossData, setCrossData] = useState<CrossDimensionCell[]>([]);
  const [heatmapData, setHeatmapData] = useState<HeatmapCell[]>([]);
  const [funnelDim, setFunnelDim] = useState<FunnelDimensionItem[]>([]);
  const [channelTrends, setChannelTrends] = useState<EntityTrend[]>([]);
  const [clientTrends, setClientTrends] = useState<EntityTrend[]>([]);

  // Productivity data
  const [userProd, setUserProd] = useState<UserProductivityItem[]>([]);
  const [teamEff, setTeamEff] = useState<TeamEfficiencyItem[]>([]);
  const [platReach, setPlatReach] = useState<PlatformReachItem[]>([]);

  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (fl) return;
    setLoading(true);
    try {
      const req = buildAnalyticsRequest(dateRange, filters);
      const trendReq = buildTrendRequest(dateRange, filters, "weekly");

      if (tab === "channels") {
        const [perf, cross, heat, funnel, trends, reach] = await Promise.all([
          channelApi.performance(req).catch(() => []),
          dimensionsApi
            .double({
              ...req,
              dimension1: "channel",
              dimension2: "output_type",
            })
            .catch(() => []),
          dimensionsApi
            .heatmap({ ...req, dimension1: "channel", dimension2: "language" })
            .catch(() => []),
          funnelApi
            .byDimension({ ...req, dimension: "channel", n: 10, sort: "desc" })
            .catch(() => []),
          channelApi.trends(trendReq).catch(() => []),
          productivityApi.platformReach(req).catch(() => []),
        ]);
        setChannels(perf as ChannelPerf[]);
        setCrossData(cross as CrossDimensionCell[]);
        setHeatmapData(heat as HeatmapCell[]);
        setFunnelDim(funnel as FunnelDimensionItem[]);
        setChannelTrends(trends as EntityTrend[]);
        setPlatReach(reach as PlatformReachItem[]);
      } else if (tab === "clients") {
        const [perf, dist, cross, heat, funnel, trends] = await Promise.all([
          clientApi.performance(req).catch(() => []),
          clientApi.usageDistribution(req).catch(() => []),
          dimensionsApi
            .double({ ...req, dimension1: "client", dimension2: "platform" })
            .catch(() => []),
          dimensionsApi
            .heatmap({
              ...req,
              dimension1: "client",
              dimension2: "output_type",
            })
            .catch(() => []),
          funnelApi
            .byDimension({ ...req, dimension: "client", n: 10, sort: "desc" })
            .catch(() => []),
          clientApi.trends(trendReq).catch(() => []),
        ]);
        setClients(perf as ClientPerf[]);
        setClientDist(dist as UsageDistItem[]);
        setCrossData(cross as CrossDimensionCell[]);
        setHeatmapData(heat as HeatmapCell[]);
        setFunnelDim(funnel as FunnelDimensionItem[]);
        setClientTrends(trends as EntityTrend[]);
      } else if (tab === "users") {
        const [perf, un, cross, heat, prod] = await Promise.all([
          userApi.performance(req).catch(() => []),
          userApi.underutilized(req).catch(() => []),
          dimensionsApi
            .double({ ...req, dimension1: "user", dimension2: "output_type" })
            .catch(() => []),
          dimensionsApi
            .heatmap({ ...req, dimension1: "user", dimension2: "language" })
            .catch(() => []),
          productivityApi.userEfficiency(req).catch(() => []),
        ]);
        setUsersData(perf as UserPerf[]);
        setUnderutilized(un as UnderutilizedUser[]);
        setCrossData(cross as CrossDimensionCell[]);
        setHeatmapData(heat as HeatmapCell[]);
        setUserProd(prod as UserProductivityItem[]);
      } else {
        const [perf, members, cross, heat, eff] = await Promise.all([
          teamApi.performance(req).catch(() => []),
          teamApi.memberBreakdown(req).catch(() => []),
          dimensionsApi
            .double({ ...req, dimension1: "team", dimension2: "output_type" })
            .catch(() => []),
          dimensionsApi
            .heatmap({ ...req, dimension1: "team", dimension2: "language" })
            .catch(() => []),
          productivityApi.teamEfficiency(req).catch(() => []),
        ]);
        setTeamsData(perf as TeamPerf[]);
        setTeamMembers(members as TeamMember[]);
        setCrossData(cross as CrossDimensionCell[]);
        setHeatmapData(heat as HeatmapCell[]);
        setTeamEff(eff as TeamEfficiencyItem[]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [dateRange, filters, fl, tab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isLoading = loading || fl;

  // ── Derived chart data ──

  // Cross-dimensional stacked bar: pivot crossData into {dim1Label, dim2a: count, dim2b: count, ...}
  const crossStacked = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    const dim2Set = new Set<string>();
    for (const c of crossData) {
      if (!map[c.dim1_label]) map[c.dim1_label] = { name: c.dim1_label } as any;
      map[c.dim1_label][c.dim2_label] = c.count;
      dim2Set.add(c.dim2_label);
    }
    return { rows: Object.values(map), dim2Keys: Array.from(dim2Set) };
  }, [crossData]);

  // Heatmap: transform to grid cells with color intensity
  const heatmapGrid = useMemo(() => {
    if (!heatmapData.length) return { cells: [], xLabels: [], yLabels: [] };
    const xSet = new Set<string>();
    const ySet = new Set<string>();
    for (const h of heatmapData) {
      xSet.add(h.x);
      ySet.add(h.y);
    }
    const maxVal = Math.max(...heatmapData.map((h) => h.value), 1);
    return {
      cells: heatmapData.map((h) => ({ ...h, intensity: h.value / maxVal })),
      xLabels: Array.from(xSet),
      yLabels: Array.from(ySet),
    };
  }, [heatmapData]);

  // Funnel comparison data
  const funnelChart = useMemo(
    () =>
      funnelDim.map((f) => ({
        name:
          f.dimension_label.length > 15
            ? f.dimension_label.slice(0, 15) + "…"
            : f.dimension_label,
        Uploaded: f.uploaded_count,
        Processed: f.processed_count,
        Published: f.published_count,
        "Conv %": f.upload_to_process_pct,
      })),
    [funnelDim],
  );

  // Channel trends: pivot to stacked area
  const channelTrendPivot = useMemo(() => {
    const topChannels = selectTopEntries(
      Array.from(
        channelTrends.reduce((acc, item) => {
          const key = String(item.channel);
          acc.set(key, (acc.get(key) ?? 0) + Number(item.count ?? 0));
          return acc;
        }, new Map<string, number>()),
      ),
      ([, total]) => total,
      MAX_TREND_SERIES,
    ).map(([channel]) => channel);
    const topChannelSet = new Set(topChannels);
    const periods = new Map<string, Record<string, any>>();
    const chSet = new Set<string>();
    for (const t of channelTrends) {
      const p = String(t.period);
      const ch = String(t.channel);
      if (!topChannelSet.has(ch)) continue;
      chSet.add(ch);
      if (!periods.has(p)) periods.set(p, { period: p });
      periods.get(p)![ch] = t.count;
    }
    return { rows: Array.from(periods.values()), channels: Array.from(chSet) };
  }, [channelTrends]);

  // Client trends pivot
  const clientTrendPivot = useMemo(() => {
    const topClients = selectTopEntries(
      Array.from(
        clientTrends.reduce((acc, item) => {
          const key = String(item.client);
          acc.set(key, (acc.get(key) ?? 0) + Number(item.count ?? 0));
          return acc;
        }, new Map<string, number>()),
      ),
      ([, total]) => total,
      MAX_TREND_SERIES,
    ).map(([client]) => client);
    const topClientSet = new Set(topClients);
    const periods = new Map<string, Record<string, any>>();
    const clSet = new Set<string>();
    for (const t of clientTrends) {
      const p = String(t.period);
      const cl = String(t.client);
      if (!topClientSet.has(cl)) continue;
      clSet.add(cl);
      if (!periods.has(p)) periods.set(p, { period: p });
      periods.get(p)![cl] = t.count;
    }
    return { rows: Array.from(periods.values()), clients: Array.from(clSet) };
  }, [clientTrends]);

  const clientDistTop = useMemo(() => {
    if (clientDist.length <= 8) return clientDist;
    const top = clientDist.slice(0, 8);
    const rest = clientDist.slice(8);
    const other = rest.reduce(
      (acc, item) => ({
        client: "Other",
        count: acc.count + item.count,
        duration_hours: acc.duration_hours + item.duration_hours,
        share_pct: acc.share_pct + item.share_pct,
      }),
      { client: "Other", count: 0, duration_hours: 0, share_pct: 0 },
    );
    return [...top, other];
  }, [clientDist]);

  // User productivity scatter
  const userScatter = useMemo(
    () =>
      userProd.map((u) => ({
        name: u.user_name,
        uploads: u.uploads,
        publishRate: u.publish_rate_pct,
        clipsPerUpload: u.clips_per_upload,
        score: u.productivity_score,
      })),
    [userProd],
  );

  // Team efficiency radar
  const teamRadar = useMemo(
    () =>
      selectTopEntries(teamEff, (team) => team.efficiency_score, 6).map(
        (t) => ({
          team:
            t.team_name.length > 12
              ? t.team_name.slice(0, 12) + "…"
              : t.team_name,
          "Clips/Upload": Math.min(t.clips_per_upload * 25, 100),
          "Publish %": t.publish_rate_pct,
          "Ups/Member": Math.min(t.uploads_per_member * 2, 100),
          Score: Math.min(t.efficiency_score, 100),
        }),
      ),
    [teamEff],
  );

  const userRadar = useMemo(() => {
    const selectedUsers = selectTopEntries(
      userProd,
      (user) => user.productivity_score,
      5,
    );
    const maxUploads = Math.max(
      ...selectedUsers.map((user) => user.uploads),
      1,
    );
    const maxScore = Math.max(
      ...selectedUsers.map((user) => user.productivity_score),
      1,
    );
    return selectedUsers.map((user) => ({
      user:
        user.user_name.length > 10
          ? `${user.user_name.slice(0, 10)}...`
          : user.user_name,
      Uploads: Math.min((user.uploads / maxUploads) * 100, 100),
      "Clips/Up": Math.min(user.clips_per_upload * 25, 100),
      "Pub %": user.publish_rate_pct,
      Score: Math.min((user.productivity_score / maxScore) * 100, 100),
    }));
  }, [userProd]);

  // Treemap data from cross data
  const treemapData = useMemo(() => {
    const total = crossData.reduce((sum, item) => sum + item.count, 0) || 1;
    const groups: Record<
      string,
      { name: string; children: { name: string; size: number }[] }
    > = {};
    for (const c of crossData) {
      if (!groups[c.dim1_label])
        groups[c.dim1_label] = { name: c.dim1_label, children: [] };
      groups[c.dim1_label].children.push({ name: c.dim2_label, size: c.count });
    }
    return Object.values(groups).flatMap((g) =>
      g.children.map((ch) => ({
        name: `${g.name} / ${ch.name}`,
        label: ch.name,
        value: ch.size,
        group: g.name,
        share_pct: (ch.size / total) * 100,
      })),
    );
  }, [crossData]);

  // Column defs
  const channelCols: Column<any>[] = [
    { key: "channel_name", label: "Channel", sortable: true },
    { key: "client_name", label: "Client", sortable: true },
    {
      key: "uploaded_count",
      label: "Uploaded",
      sortable: true,
      align: "right",
      render: (r) => formatNumber(r.uploaded_count),
    },
    {
      key: "uploaded_duration_hours",
      label: "Hours",
      sortable: true,
      align: "right",
      render: (r) => Number(r.uploaded_duration_hours).toFixed(1),
    },
    {
      key: "processed_count",
      label: "Processed",
      sortable: true,
      align: "right",
      render: (r) => formatNumber(r.processed_count),
    },
    {
      key: "published_count",
      label: "Published",
      sortable: true,
      align: "right",
      render: (r) => formatNumber(r.published_count),
    },
    {
      key: "publish_rate_pct",
      label: "Publish Rate",
      sortable: true,
      align: "right",
      render: (r) => (
        <span
          className={`badge ${r.publish_rate_pct >= 50 ? "badge-success" : r.publish_rate_pct >= 25 ? "badge-warning" : "badge-danger"}`}
        >
          {Number(r.publish_rate_pct).toFixed(1)}%
        </span>
      ),
    },
  ];

  const clientCols: Column<any>[] = [
    { key: "client_name", label: "Client", sortable: true },
    {
      key: "uploaded_count",
      label: "Uploaded",
      sortable: true,
      align: "right",
      render: (r) => formatNumber(r.uploaded_count),
    },
    {
      key: "uploaded_duration_hours",
      label: "Hours",
      sortable: true,
      align: "right",
      render: (r) => Number(r.uploaded_duration_hours).toFixed(1),
    },
    {
      key: "published_count",
      label: "Published",
      sortable: true,
      align: "right",
      render: (r) => formatNumber(r.published_count),
    },
    {
      key: "publish_rate_pct",
      label: "Publish Rate",
      sortable: true,
      align: "right",
      render: (r) => (
        <span
          className={`badge ${Number(r.publish_rate_pct) >= 50 ? "badge-success" : "badge-warning"}`}
        >
          {Number(r.publish_rate_pct).toFixed(1)}%
        </span>
      ),
    },
  ];

  const userCols: Column<any>[] = [
    { key: "user_name", label: "User", sortable: true },
    { key: "team_name", label: "Team", sortable: true },
    {
      key: "uploaded_count",
      label: "Uploaded",
      sortable: true,
      align: "right",
      render: (r) => formatNumber(r.uploaded_count),
    },
    {
      key: "uploaded_duration_hours",
      label: "Hours",
      sortable: true,
      align: "right",
      render: (r) => Number(r.uploaded_duration_hours).toFixed(1),
    },
    {
      key: "published_count",
      label: "Published",
      sortable: true,
      align: "right",
      render: (r) => formatNumber(r.published_count),
    },
    {
      key: "publish_rate_pct",
      label: "Publish Rate",
      sortable: true,
      align: "right",
      render: (r) => (
        <span
          className={`badge ${Number(r.publish_rate_pct) >= 50 ? "badge-success" : "badge-warning"}`}
        >
          {Number(r.publish_rate_pct).toFixed(1)}%
        </span>
      ),
    },
  ];

  const teamCols: Column<any>[] = [
    { key: "team_name", label: "Team", sortable: true },
    {
      key: "uploaded_count",
      label: "Uploaded",
      sortable: true,
      align: "right",
      render: (r) => formatNumber(r.uploaded_count),
    },
    {
      key: "uploaded_duration_hours",
      label: "Hours",
      sortable: true,
      align: "right",
      render: (r) => Number(r.uploaded_duration_hours).toFixed(1),
    },
    {
      key: "published_count",
      label: "Published",
      sortable: true,
      align: "right",
      render: (r) => formatNumber(r.published_count),
    },
    {
      key: "publish_rate_pct",
      label: "Publish Rate",
      sortable: true,
      align: "right",
      render: (r) => (
        <span
          className={`badge ${Number(r.publish_rate_pct) >= 50 ? "badge-success" : "badge-warning"}`}
        >
          {Number(r.publish_rate_pct).toFixed(1)}%
        </span>
      ),
    },
  ];

  const tabMeta: Record<Tab, { title: string; desc: string }> = {
    channels: {
      title: "Channel Performance",
      desc: "Channels represent individual workspaces within client organizations. Compare uploads, processing, publishing, and drill into multi-dimensional breakdowns by output type, language, and platform.",
    },
    clients: {
      title: "Client Overview",
      desc: "Each client is an organization using Frammer. Analyze their usage share, cross-reference with platforms and content types, and track conversion funnels.",
    },
    users: {
      title: "User Productivity",
      desc: "Individual operators who upload and manage content. Analyze productivity scores, scatter-plot efficiency, and cross-reference activity against output types and languages.",
    },
    teams: {
      title: "Team Efficiency",
      desc: "Teams group users together. Compare efficiency scores via radar, drill into output type breakdowns, and see how team members distribute their work.",
    },
  };

  const meta = tabMeta[tab];

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Entity Analysis</h1>
        <p className="page-subtitle">
          Deep-dive into channels, clients, users, and teams with
          multi-dimensional cross-analysis, funnel breakdowns, productivity
          metrics, and trend exploration.
        </p>
      </div>

      {/* Tabs */}
      <div className="tab-group" style={{ marginBottom: 32 }}>
        {[
          {
            key: "channels" as Tab,
            label: "Channels",
            icon: <Monitor size={14} />,
          },
          {
            key: "clients" as Tab,
            label: "Clients",
            icon: <Building2 size={14} />,
          },
          { key: "users" as Tab, label: "Users", icon: <Users size={14} /> },
          {
            key: "teams" as Tab,
            label: "Teams",
            icon: <UsersRound size={14} />,
          },
        ].map((t) => (
          <button
            key={t.key}
            className={`tab-item ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
            style={{ display: "flex", alignItems: "center", gap: 7 }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

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
          <h3 className="section-title">{meta.title}</h3>
        </div>
        <p className="section-description" style={{ marginBottom: 28 }}>
          {meta.desc}
        </p>
      </div>

      {/* ════════════════════════════════════════ CHANNELS ════════════════════════════════════════ */}
      {tab === "channels" && (
        <>
          {/* Row 1: Upload vs Published + Publish Rate */}
          <div className="grid-2 section-gap">
            <ChartCard
              title="Upload vs Processed vs Published"
              description="Full pipeline comparison per channel - see where content drops off."
              loading={isLoading}
              minHeight={280}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={channels}
                  margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="channel_name"
                    tick={{ fontSize: 8 }}
                    angle={-25}
                    textAnchor="end"
                  />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                  <Bar
                    dataKey="uploaded_count"
                    name="Uploaded"
                    fill="#dc2626"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                  <Bar
                    dataKey="processed_count"
                    name="Processed"
                    fill="#f87171"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                  <Bar
                    dataKey="published_count"
                    name="Published"
                    fill="#22c55e"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Publish Rate by Channel"
              description="Channels below 25% warrant investigation for bottlenecks."
              loading={isLoading}
              minHeight={280}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={channels}
                  layout="vertical"
                  margin={{ top: 8, right: 12, left: 12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} unit="%" />
                  <YAxis
                    type="category"
                    dataKey="channel_name"
                    tick={{ fontSize: 9 }}
                    width={72}
                  />
                  <Tooltip
                    contentStyle={customTooltipStyle()}
                    formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
                  />
                  <Bar
                    dataKey="publish_rate_pct"
                    name="Publish %"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={16}
                  >
                    {channels.map((c, i) => (
                      <Cell
                        key={i}
                        fill={
                          Number(c.publish_rate_pct) >= 50
                            ? "var(--green)"
                            : Number(c.publish_rate_pct) >= 25
                              ? "var(--amber)"
                              : "var(--red)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Row 2: Channel × Output Type stacked + Channel × Language heatmap */}
          <div className="grid-2 section-gap">
            <ChartCard
              title="Channel × Output Type"
              subtitle="Multi-dimensional"
              description="How each channel distributes across output formats - reveals content strategy patterns."
              loading={isLoading}
              minHeight={300}
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={crossStacked.rows}
                  margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 8 }}
                    angle={-25}
                    textAnchor="end"
                  />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: "0.68rem" }} />
                  {crossStacked.dim2Keys.map((k, i) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="a"
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      maxBarSize={32}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Channel × Language Heatmap"
              subtitle="Multi-dimensional"
              description="Intensity map showing which languages dominate in each channel."
              loading={isLoading}
              minHeight={300}
            >
              <div style={{ overflow: "auto", maxHeight: 280 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `80px repeat(${heatmapGrid.yLabels.length}, 1fr)`,
                    gap: 1,
                    minWidth: Math.max(heatmapGrid.yLabels.length * 50, 300),
                  }}
                >
                  <div />
                  {heatmapGrid.yLabels.map((y) => (
                    <div
                      key={y}
                      style={{
                        fontSize: "0.65rem",
                        textAlign: "center",
                        color: "var(--text-muted)",
                        padding: "4px 2px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {y}
                    </div>
                  ))}
                  {heatmapGrid.xLabels.map((x) => (
                    <React.Fragment key={x}>
                      <div
                        style={{
                          fontSize: "0.65rem",
                          color: "var(--text-secondary)",
                          padding: "6px 4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {x}
                      </div>
                      {heatmapGrid.yLabels.map((y) => {
                        const cell = heatmapGrid.cells.find(
                          (c) => c.x === x && c.y === y,
                        );
                        const intensity = cell?.intensity ?? 0;
                        return (
                          <div
                            key={`${x}-${y}`}
                            title={`${x} × ${y}: ${cell?.value ?? 0}`}
                            style={{
                              background:
                                intensity > 0
                                  ? `rgba(220, 38, 38, ${0.1 + intensity * 0.7})`
                                  : "var(--bg-input)",
                              borderRadius: 4,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "0.65rem",
                              color:
                                intensity > 0.5
                                  ? "var(--text-on-accent)"
                                  : "var(--text-muted)",
                              minHeight: 28,
                              cursor: "default",
                            }}
                          >
                            {cell?.value || ""}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </ChartCard>
          </div>

          {/* Row 3: Channel funnel + Channel trends */}
          <div className="grid-2 section-gap">
            <ChartCard
              title="Channel Funnel Comparison"
              description="Upload→Process→Publish conversion per channel. Identify which channels have the best end-to-end throughput."
              loading={isLoading}
              minHeight={280}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={funnelChart}
                  margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 8 }}
                    angle={-25}
                    textAnchor="end"
                  />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                  <Bar
                    dataKey="Uploaded"
                    fill="#dc2626"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                  <Bar
                    dataKey="Processed"
                    fill="#f87171"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                  <Bar
                    dataKey="Published"
                    fill="#22c55e"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Channel Activity Trends"
              description="Weekly upload volume for the top 8 channels by volume. Spot seasonal patterns and growth without overcrowding."
              loading={isLoading}
              minHeight={280}
              isEmpty={channelTrendPivot.rows.length === 0}
              emptyMessage="No channel trend data for this period"
            >
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={channelTrendPivot.rows}
                  margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: "0.68rem" }} />
                  {channelTrendPivot.channels.map((ch, i) => (
                    <Area
                      key={ch}
                      type="monotone"
                      dataKey={ch}
                      stackId="1"
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Row 4: Platform reach + Treemap */}
          <div className="grid-2 section-gap">
            <ChartCard
              title="Multi-Platform Reach"
              description="How many platforms each channel publishes to. Higher reach = broader content distribution."
              loading={isLoading}
              minHeight={260}
            >
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart
                  data={platReach}
                  margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="entity_name"
                    tick={{ fontSize: 8 }}
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
                  <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                  <Bar
                    yAxisId="left"
                    dataKey="total_published"
                    name="Published"
                    fill="#dc2626"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={24}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="reach_score"
                    name="Reach %"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Content Volume Treemap"
              subtitle="Multi-dimensional"
              description="Proportional view of content distribution across channel × output type combinations."
              loading={isLoading}
              minHeight={260}
            >
              {treemapData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <Treemap
                    data={treemapData}
                    dataKey="value"
                    nameKey="name"
                    content={<TreemapCell />}
                  >
                    <Tooltip content={<TreemapTooltip />} />
                  </Treemap>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <p>No cross-dimensional data</p>
                </div>
              )}
            </ChartCard>
          </div>

          <ChartCard
            title="Full Channel Table"
            description="Click any column header to sort."
            loading={isLoading}
            minHeight={200}
          >
            <DataTable
              columns={channelCols}
              data={channels as any[]}
              pageSize={10}
            />
          </ChartCard>
        </>
      )}

      {/* ════════════════════════════════════════ CLIENTS ════════════════════════════════════════ */}
      {tab === "clients" && (
        <>
          <div className="grid-2 section-gap">
            <ChartCard
              title="Usage Distribution"
              description="Share of total volume across clients."
              loading={isLoading}
              minHeight={360}
            >
              <ResponsiveContainer width="100%" height={420}>
                <PieChart>
                  <Pie
                    data={clientDistTop}
                    dataKey="count"
                    nameKey="client"
                    cx="50%"
                    cy="40%"
                    innerRadius={58}
                    outerRadius={104}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {clientDistTop.map((_, i) => (
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
                      fontSize: "0.72rem",
                      width: "100%",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Client Upload vs Published"
              description="Compare how much each client uploads versus how much gets published."
              loading={isLoading}
              minHeight={280}
            >
              <ResponsiveContainer width="100%" height={360}>
                <BarChart
                  data={clients}
                  margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="client_name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                  <Bar
                    dataKey="uploaded_count"
                    name="Uploaded"
                    fill="#dc2626"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                  <Bar
                    dataKey="published_count"
                    name="Published"
                    fill="#22c55e"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Client × Platform + Client × Output Type */}
          <div className="grid-2 section-gap">
            <ChartCard
              title="Client x Platform Distribution"
              subtitle="Multi-dimensional"
              description="Which platforms each client publishes to - reveals distribution strategy."
              loading={isLoading}
              minHeight={350}
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={crossStacked.rows}
                  margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 8 }}
                    angle={-25}
                    textAnchor="end"
                  />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: "0.68rem", top: 200 }} />
                  {crossStacked.dim2Keys.map((k, i) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="a"
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      maxBarSize={32}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Client × Output Type Heatmap"
              subtitle="Multi-dimensional"
              description="Intensity of each output type across clients."
              loading={isLoading}
              minHeight={300}
            >
              <div style={{ overflow: "auto", maxHeight: 280 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `80px repeat(${heatmapGrid.yLabels.length}, 1fr)`,
                    gap: 1,
                    minWidth: Math.max(heatmapGrid.yLabels.length * 50, 300),
                  }}
                >
                  <div />
                  {heatmapGrid.yLabels.map((y) => (
                    <div
                      key={y}
                      style={{
                        fontSize: "0.65rem",
                        textAlign: "center",
                        color: "var(--text-muted)",
                        padding: "4px 2px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {y}
                    </div>
                  ))}
                  {heatmapGrid.xLabels.map((x) => (
                    <React.Fragment key={x}>
                      <div
                        style={{
                          fontSize: "0.65rem",
                          color: "var(--text-secondary)",
                          padding: "6px 4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {x}
                      </div>
                      {heatmapGrid.yLabels.map((y) => {
                        const cell = heatmapGrid.cells.find(
                          (c) => c.x === x && c.y === y,
                        );
                        const intensity = cell?.intensity ?? 0;
                        return (
                          <div
                            key={`${x}-${y}`}
                            title={`${x} × ${y}: ${cell?.value ?? 0}`}
                            style={{
                              background:
                                intensity > 0
                                  ? `rgba(220, 38, 38, ${0.1 + intensity * 0.7})`
                                  : "var(--bg-input)",
                              borderRadius: 4,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "0.65rem",
                              color:
                                intensity > 0.5
                                  ? "var(--text-on-accent)"
                                  : "var(--text-muted)",
                              minHeight: 28,
                            }}
                          >
                            {cell?.value || ""}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </ChartCard>
          </div>

          {/* Client funnel + Client trends */}
          <div className="grid-2 section-gap">
            <ChartCard
              title="Client Funnel Comparison"
              description="End-to-end conversion: uploaded → processed → published per client."
              loading={isLoading}
              minHeight={280}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={funnelChart}
                  margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 8 }}
                    angle={-25}
                    textAnchor="end"
                  />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                  <Bar
                    dataKey="Uploaded"
                    fill="#dc2626"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                  <Bar
                    dataKey="Processed"
                    fill="#f87171"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                  <Bar
                    dataKey="Published"
                    fill="#22c55e"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Client Volume Trends"
              description="Weekly upload volume for the top 8 clients by volume. Identify growth and seasonal patterns."
              loading={isLoading}
              minHeight={280}
            >
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={clientTrendPivot.rows}
                  margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: "0.68rem" }} />
                  {clientTrendPivot.clients.map((cl, i) => (
                    <Area
                      key={cl}
                      type="monotone"
                      dataKey={cl}
                      stackId="1"
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Treemap */}
          <div className="section-gap">
            <ChartCard
              title="Client × Platform Treemap"
              subtitle="Multi-dimensional"
              description="Proportional view of how content volume distributes across client-platform combinations."
              loading={isLoading}
              minHeight={240}
            >
              {treemapData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <Treemap
                    data={treemapData}
                    dataKey="value"
                    nameKey="name"
                    content={<TreemapCell />}
                  >
                    <Tooltip content={<TreemapTooltip />} />
                  </Treemap>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <p>No cross-dimensional data</p>
                </div>
              )}
            </ChartCard>
          </div>

          <ChartCard
            title="Client Detail Table"
            loading={isLoading}
            minHeight={200}
          >
            <DataTable
              columns={clientCols}
              data={clients as any[]}
              pageSize={10}
            />
          </ChartCard>
        </>
      )}

      {/* ════════════════════════════════════════ USERS ════════════════════════════════════════ */}
      {tab === "users" && (
        <>
          {/* Productivity scatter + Rankings */}
          <div className="grid-2 section-gap">
            <ChartCard
              title="User Productivity Scatter"
              description="Each dot is a user. X = uploads, Y = publish rate. Top-right = high volume + high publish rate."
              loading={isLoading}
              minHeight={300}
            >
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="uploads"
                    name="Uploads"
                    tick={{ fontSize: 10 }}
                    label={{
                      value: "Uploads",
                      position: "insideBottom",
                      offset: -4,
                      style: { fontSize: 10 },
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="publishRate"
                    name="Publish %"
                    tick={{ fontSize: 10 }}
                    width={42}
                    unit="%"
                    label={{
                      value: "Publish %",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10 },
                    }}
                  />
                  <ZAxis
                    type="number"
                    dataKey="score"
                    range={[40, 300]}
                    name="Score"
                  />
                  <Tooltip
                    contentStyle={customTooltipStyle()}
                    formatter={(v: unknown, name?: string | number) => [
                      name === "Publish %"
                        ? `${Number(v).toFixed(1)}%`
                        : String(v),
                      String(name ?? "Value"),
                    ]}
                  />
                  <Scatter
                    data={userScatter}
                    fill="#dc2626"
                    fillOpacity={0.7}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Top User Rankings"
              description="Users ranked by composite productivity score (volume × clip rate × publish rate)."
              loading={isLoading}
              minHeight={300}
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={userProd}
                  layout="vertical"
                  margin={{ top: 0, right: 12, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis
                    type="category"
                    dataKey="user_name"
                    tick={{ fontSize: 9 }}
                    width={70}
                  />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Bar
                    dataKey="productivity_score"
                    name="Score"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={14}
                  >
                    {userProd.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* User × Output Type + User × Language heatmap */}
          <div className="grid-2 section-gap">
            <ChartCard
              title="User × Output Type"
              subtitle="Multi-dimensional"
              description="Which output types each user produces - reveals specialization patterns."
              loading={isLoading}
              minHeight={300}
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={crossStacked.rows}
                  margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 7 }}
                    angle={-30}
                    textAnchor="end"
                  />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: "0.68rem" }} />
                  {crossStacked.dim2Keys.map((k, i) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="a"
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      maxBarSize={28}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="User × Language Heatmap"
              subtitle="Multi-dimensional"
              description="Language diversity across users - spot multilingual operators."
              loading={isLoading}
              minHeight={300}
            >
              <div style={{ overflow: "auto", maxHeight: 280 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `80px repeat(${heatmapGrid.yLabels.length}, 1fr)`,
                    gap: 1,
                    minWidth: Math.max(heatmapGrid.yLabels.length * 50, 300),
                  }}
                >
                  <div />
                  {heatmapGrid.yLabels.map((y) => (
                    <div
                      key={y}
                      style={{
                        fontSize: "0.65rem",
                        textAlign: "center",
                        color: "var(--text-muted)",
                        padding: "4px 2px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {y}
                    </div>
                  ))}
                  {heatmapGrid.xLabels.map((x) => (
                    <React.Fragment key={x}>
                      <div
                        style={{
                          fontSize: "0.65rem",
                          color: "var(--text-secondary)",
                          padding: "6px 4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {x}
                      </div>
                      {heatmapGrid.yLabels.map((y) => {
                        const cell = heatmapGrid.cells.find(
                          (c) => c.x === x && c.y === y,
                        );
                        const intensity = cell?.intensity ?? 0;
                        return (
                          <div
                            key={`${x}-${y}`}
                            title={`${x} × ${y}: ${cell?.value ?? 0}`}
                            style={{
                              background:
                                intensity > 0
                                  ? `rgba(220, 38, 38, ${0.1 + intensity * 0.7})`
                                  : "var(--bg-input)",
                              borderRadius: 4,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "0.65rem",
                              color:
                                intensity > 0.5
                                  ? "var(--text-on-accent)"
                                  : "var(--text-muted)",
                              minHeight: 28,
                            }}
                          >
                            {cell?.value || ""}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </ChartCard>
          </div>

          {/* User Radar for top 5 */}
          {userProd.length >= 3 && (
            <div className="section-gap">
              <ChartCard
                title="Top User Radar"
                description="Multi-metric comparison of top 5 users across uploads, clips/upload, publish rate, and overall score."
                loading={isLoading}
                minHeight={320}
              >
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart
                    data={userRadar}
                    cx="50%"
                    cy="50%"
                    outerRadius="68%"
                  >
                    <PolarGrid stroke="var(--border-subtle)" />
                    <PolarAngleAxis
                      dataKey="user"
                      tick={{ fontSize: 9, fill: "var(--text-secondary)" }}
                    />
                    <PolarRadiusAxis
                      tick={{ fontSize: 8, fill: "var(--text-muted)" }}
                    />
                    <Radar
                      name="Uploads"
                      dataKey="Uploads"
                      stroke="#dc2626"
                      fill="#dc2626"
                      fillOpacity={0.1}
                      strokeWidth={2}
                    />
                    <Radar
                      name="Pub %"
                      dataKey="Pub %"
                      stroke="#22c55e"
                      fill="#22c55e"
                      fillOpacity={0.1}
                      strokeWidth={2}
                    />
                    <Radar
                      name="Score"
                      dataKey="Score"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.1}
                      strokeWidth={2}
                    />
                    <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                    <Tooltip contentStyle={customTooltipStyle()} />
                  </RadarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}

          <div className="section-gap">
            <ChartCard
              title="User Performance Table"
              description="Full breakdown of every user's upload and publish activity."
              loading={isLoading}
              minHeight={200}
            >
              <DataTable
                columns={userCols}
                data={usersData as any[]}
                pageSize={10}
              />
            </ChartCard>
          </div>
          {underutilized.length > 0 && (
            <ChartCard
              title="Underutilized Users"
              description="Users with &lt;50% publish rate. May need attention for workflow issues or training."
              loading={isLoading}
              minHeight={140}
            >
              <DataTable
                columns={[
                  { key: "user_name", label: "User", sortable: true },
                  { key: "team_name", label: "Team", sortable: true },
                  {
                    key: "uploaded_count",
                    label: "Uploaded",
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
                    key: "publish_rate_pct",
                    label: "Rate",
                    sortable: true,
                    align: "right",
                    render: (r: any) => (
                      <span className="badge badge-danger">
                        {Number(r.publish_rate_pct).toFixed(1)}%
                      </span>
                    ),
                  },
                ]}
                data={underutilized as any[]}
                pageSize={8}
              />
            </ChartCard>
          )}
        </>
      )}

      {/* ════════════════════════════════════════ TEAMS ════════════════════════════════════════ */}
      {tab === "teams" && (
        <>
          {/* Team radar + Team stacked bar */}
          <div className="grid-2 section-gap">
            <ChartCard
              title="Team Efficiency Radar"
              description="Compare teams across clips/upload, publish rate, uploads/member, and overall score."
              loading={isLoading}
              minHeight={320}
            >
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart
                  data={teamRadar}
                  cx="50%"
                  cy="50%"
                  outerRadius="68%"
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
                  <Radar
                    name="Clips/Upload"
                    dataKey="Clips/Upload"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.1}
                    strokeWidth={2}
                  />
                  <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                </RadarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Team × Output Type"
              subtitle="Multi-dimensional"
              description="Which output formats each team produces - reveals specialization vs generalization."
              loading={isLoading}
              minHeight={320}
            >
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={crossStacked.rows}
                  margin={{ top: 8, right: 12, left: -8, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 8 }}
                    angle={-25}
                    textAnchor="end"
                  />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={customTooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: "0.68rem" }} />
                  {crossStacked.dim2Keys.map((k, i) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="a"
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      maxBarSize={32}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Team × Language heatmap + Team member scatter */}
          <div className="grid-2 section-gap">
            <ChartCard
              title="Team × Language Heatmap"
              subtitle="Multi-dimensional"
              description="Language coverage by team - shows linguistic capacity."
              loading={isLoading}
              minHeight={300}
            >
              <div style={{ overflow: "auto", maxHeight: 280 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `80px repeat(${heatmapGrid.yLabels.length}, 1fr)`,
                    gap: 1,
                    minWidth: Math.max(heatmapGrid.yLabels.length * 50, 300),
                  }}
                >
                  <div />
                  {heatmapGrid.yLabels.map((y) => (
                    <div
                      key={y}
                      style={{
                        fontSize: "0.65rem",
                        textAlign: "center",
                        color: "var(--text-muted)",
                        padding: "4px 2px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {y}
                    </div>
                  ))}
                  {heatmapGrid.xLabels.map((x) => (
                    <React.Fragment key={x}>
                      <div
                        style={{
                          fontSize: "0.65rem",
                          color: "var(--text-secondary)",
                          padding: "6px 4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {x}
                      </div>
                      {heatmapGrid.yLabels.map((y) => {
                        const cell = heatmapGrid.cells.find(
                          (c) => c.x === x && c.y === y,
                        );
                        const intensity = cell?.intensity ?? 0;
                        return (
                          <div
                            key={`${x}-${y}`}
                            title={`${x} × ${y}: ${cell?.value ?? 0}`}
                            style={{
                              background:
                                intensity > 0
                                  ? `rgba(220, 38, 38, ${0.1 + intensity * 0.7})`
                                  : "var(--bg-input)",
                              borderRadius: 4,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "0.65rem",
                              color:
                                intensity > 0.5
                                  ? "var(--text-on-accent)"
                                  : "var(--text-muted)",
                              minHeight: 28,
                            }}
                          >
                            {cell?.value || ""}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </ChartCard>
            <ChartCard
              title="Team Member Contribution"
              description="Upload count and duration per member within each team - identify workload balance."
              loading={isLoading}
              minHeight={300}
            >
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="count"
                    name="Videos"
                    tick={{ fontSize: 10 }}
                    label={{
                      value: "Videos",
                      position: "insideBottom",
                      offset: -4,
                      style: { fontSize: 10 },
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="duration_hours"
                    name="Hours"
                    tick={{ fontSize: 10 }}
                    width={42}
                    label={{
                      value: "Hours",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10 },
                    }}
                  />
                  <Tooltip
                    contentStyle={customTooltipStyle()}
                    formatter={(v: unknown, name?: string | number) => [
                      name === "Hours" ? `${Number(v).toFixed(1)}h` : String(v),
                      String(name ?? "Value"),
                    ]}
                  />
                  <Scatter
                    data={teamMembers}
                    fill="#dc2626"
                    fillOpacity={0.7}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Team efficiency table */}
          {teamEff.length > 0 && (
            <div className="section-gap">
              <ChartCard
                title="Team Efficiency Leaderboard"
                description="Ranked by composite score. Factors: uploads/member, clip generation rate, publish success."
                loading={isLoading}
                minHeight={200}
              >
                <DataTable
                  columns={[
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
                      render: (r: any) => formatNumber(r.uploads),
                    },
                    {
                      key: "outputs",
                      label: "Outputs",
                      sortable: true,
                      align: "right",
                      render: (r: any) => formatNumber(r.outputs),
                    },
                    {
                      key: "published",
                      label: "Published",
                      sortable: true,
                      align: "right",
                      render: (r: any) => formatNumber(r.published),
                    },
                    {
                      key: "clips_per_upload",
                      label: "Clips/Up",
                      sortable: true,
                      align: "right",
                      render: (r: any) => Number(r.clips_per_upload).toFixed(1),
                    },
                    {
                      key: "publish_rate_pct",
                      label: "Pub %",
                      sortable: true,
                      align: "right",
                      render: (r: any) => (
                        <span
                          className={`badge ${r.publish_rate_pct >= 50 ? "badge-success" : "badge-warning"}`}
                        >
                          {Number(r.publish_rate_pct).toFixed(1)}%
                        </span>
                      ),
                    },
                    {
                      key: "efficiency_score",
                      label: "Score",
                      sortable: true,
                      align: "right",
                      render: (r: any) => (
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontWeight: 600,
                            color: "var(--accent-soft)",
                          }}
                        >
                          {Number(r.efficiency_score).toFixed(1)}
                        </span>
                      ),
                    },
                  ]}
                  data={teamEff as any[]}
                  pageSize={10}
                />
              </ChartCard>
            </div>
          )}

          <div className="section-gap">
            <ChartCard
              title="Team Performance Table"
              loading={isLoading}
              minHeight={200}
            >
              <DataTable
                columns={teamCols}
                data={teamsData as any[]}
                pageSize={10}
              />
            </ChartCard>
          </div>
          {teamMembers.length > 0 && (
            <ChartCard
              title="Team Member Contributions"
              description="Individual contributions within each team."
              loading={isLoading}
              minHeight={140}
            >
              <DataTable
                columns={[
                  { key: "team_name", label: "Team", sortable: true },
                  { key: "user_name", label: "User", sortable: true },
                  {
                    key: "count",
                    label: "Videos",
                    sortable: true,
                    align: "right",
                  },
                  {
                    key: "duration_hours",
                    label: "Hours",
                    sortable: true,
                    align: "right",
                    render: (r: any) => Number(r.duration_hours).toFixed(1),
                  },
                ]}
                data={teamMembers as any[]}
                pageSize={10}
              />
            </ChartCard>
          )}
        </>
      )}
    </div>
  );
}
