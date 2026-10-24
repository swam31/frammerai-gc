"use client";

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
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
  Treemap,
} from "recharts";
import { Grid3X3, ArrowRight, X, TableIcon } from "lucide-react";
import ChartCard from "@/components/ui/ChartCard";
import TreemapTooltip from "@/components/ui/TreemapTooltip";
import DataTable from "@/components/ui/DataTable";
import type { Column } from "@/components/ui/DataTable";
import { useFilters } from "@/lib/filters-context";
import {
  dimensionsApi,
  videoApi,
  CrossDimensionCell,
  HeatmapCell,
  VideoDetail,
  buildAnalyticsRequest,
} from "@/lib/api";
import {
  CHART_COLORS,
  customTooltipStyle,
  formatNumber,
} from "@/lib/chart-utils";

type DimKey =
  | "channel"
  | "client"
  | "user"
  | "team"
  | "language"
  | "input_type"
  | "output_type"
  | "platform";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Treemap cell renderer
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

// Color interpolation for heatmap gradient
function heatColor(intensity: number): string {
  if (intensity <= 0) return "var(--bg-input)";
  // Warm gradient: light peach → medium red → deep crimson
  const r = Math.round(220 + 35 * (1 - intensity));
  const g = Math.round(200 - 162 * intensity);
  const b = Math.round(200 - 162 * intensity);
  const alpha = 0.15 + intensity * 0.85;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Map dimension key to the filter field name for videoApi
function dimKeyToFilterField(dim: DimKey): string {
  const map: Record<DimKey, string> = {
    channel: "channel_ids",
    client: "client_ids",
    user: "user_ids",
    team: "team_ids",
    language: "language_ids",
    input_type: "input_type_ids",
    output_type: "output_type_ids",
    platform: "platform_ids",
  };
  return map[dim];
}

// Video drill-down table columns
const videoCols: Column<Record<string, unknown>>[] = [
  { key: "headline", label: "Headline", sortable: true },
  { key: "channel_name", label: "Channel", sortable: true },
  { key: "language", label: "Language", sortable: true },
  { key: "output_type", label: "Output Type", sortable: true },
  { key: "published_platform", label: "Platform", sortable: true },
  {
    key: "is_published",
    label: "Published",
    sortable: true,
    align: "center",
    render: (row) => (
      <span
        className={`badge ${row.is_published ? "badge-success" : "badge-danger"}`}
        style={{ fontSize: "0.68rem" }}
      >
        {row.is_published ? "Yes" : "No"}
      </span>
    ),
  },
  { key: "upload_date", label: "Upload Date", sortable: true },
];

export default function CrossDimensionalExplorerPage() {
  const { dateRange, filters, loading: fl } = useFilters();

  const [exploreDim1, setExploreDim1] = useState<DimKey>("language");
  const [exploreDim2, setExploreDim2] = useState<DimKey>("platform");
  const [exploreData, setExploreData] = useState<CrossDimensionCell[]>([]);
  const [exploreHeatmap, setExploreHeatmap] = useState<HeatmapCell[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);

  // Drill-down state
  const [selectedCell, setSelectedCell] = useState<{
    x: string;
    y: string;
    value: number;
  } | null>(null);
  const [drilldownVideos, setDrilldownVideos] = useState<VideoDetail[]>([]);
  const [drilldownTotal, setDrilldownTotal] = useState(0);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const drilldownRef = useRef<HTMLDivElement>(null);

  const fetchExplore = useCallback(async () => {
    if (fl) return;
    setExploreLoading(true);
    setSelectedCell(null);
    setDrilldownVideos([]);
    try {
      const req = buildAnalyticsRequest(dateRange, filters);
      const [cross, heat] = await Promise.all([
        dimensionsApi
          .double({ ...req, dimension1: exploreDim1, dimension2: exploreDim2 })
          .catch(() => []),
        dimensionsApi
          .heatmap({ ...req, dimension1: exploreDim1, dimension2: exploreDim2 })
          .catch(() => []),
      ]);
      setExploreData(cross as CrossDimensionCell[]);
      setExploreHeatmap(heat as HeatmapCell[]);
    } catch (e) {
      console.error(e);
    } finally {
      setExploreLoading(false);
    }
  }, [dateRange, filters, fl, exploreDim1, exploreDim2]);

  useEffect(() => {
    fetchExplore();
  }, [fetchExplore]);

  // When a cell is clicked, fetch matching videos
  const handleCellClick = useCallback(
    async (x: string, y: string, value: number) => {
      if (value <= 0) return;

      // Toggle off if clicking same cell
      if (selectedCell?.x === x && selectedCell?.y === y) {
        setSelectedCell(null);
        setDrilldownVideos([]);
        return;
      }

      setSelectedCell({ x, y, value });
      setDrilldownLoading(true);
      try {
        // Look up dimension IDs from the cross-dimension data (labels → IDs)
        const match = exploreData.find(
          (c) => c.dim1_label === x && c.dim2_label === y,
        );
        const dim1Id = match?.dim1_id ?? x;
        const dim2Id = match?.dim2_id ?? y;

        const filter1Field = dimKeyToFilterField(exploreDim1);
        const filter2Field = dimKeyToFilterField(exploreDim2);
        const drillFilters = {
          ...filters,
          [filter1Field]: [String(dim1Id)],
          [filter2Field]: [String(dim2Id)],
        };

        const result = await videoApi.search({
          date_range: dateRange,
          filters: drillFilters,
          pagination: { page: 1, page_size: 50 },
          sort_by: "upload_date",
          sort_order: "desc",
        });
        setDrilldownVideos(result.items || []);
        setDrilldownTotal(result.total ?? result.items?.length ?? 0);
        // Scroll to drill-down section
        setTimeout(() => {
          drilldownRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 100);
      } catch (e) {
        console.error("Drill-down fetch failed:", e);
        setDrilldownVideos([]);
        setDrilldownTotal(0);
      } finally {
        setDrilldownLoading(false);
      }
    },
    [selectedCell, filters, dateRange, exploreDim1, exploreDim2, exploreData],
  );

  // Derived chart data
  const exploreStacked = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    const dim2Set = new Set<string>();
    for (const c of exploreData) {
      if (!map[c.dim1_label]) map[c.dim1_label] = { name: c.dim1_label } as any;
      map[c.dim1_label][c.dim2_label] = c.count;
      dim2Set.add(c.dim2_label);
    }
    return { rows: Object.values(map), dim2Keys: Array.from(dim2Set) };
  }, [exploreData]);

  const exploreHeatGrid = useMemo(() => {
    if (!exploreHeatmap.length) return { cells: [], xLabels: [], yLabels: [] };
    const xSet = new Set<string>();
    const ySet = new Set<string>();
    for (const h of exploreHeatmap) {
      xSet.add(h.x);
      ySet.add(h.y);
    }
    const maxVal = Math.max(...exploreHeatmap.map((h) => h.value), 1);
    return {
      cells: exploreHeatmap.map((h) => ({ ...h, intensity: h.value / maxVal })),
      xLabels: Array.from(xSet),
      yLabels: Array.from(ySet),
    };
  }, [exploreHeatmap]);

  const dimLabels: Record<DimKey, string> = {
    channel: "Channel",
    client: "Client",
    user: "User",
    team: "Team",
    language: "Language",
    input_type: "Input Type",
    output_type: "Output Type",
    platform: "Platform",
  };
  const dimOptions: DimKey[] = [
    "channel",
    "client",
    "user",
    "team",
    "language",
    "input_type",
    "output_type",
    "platform",
  ];

  // Dynamic heatmap height
  const heatmapRowHeight = 36;
  const heatmapHeight = Math.max(
    300,
    (exploreHeatGrid.xLabels.length + 1) * heatmapRowHeight + 20,
  );

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Grid3X3 size={22} style={{ color: "var(--accent)" }} />
          <h1 className="page-title" style={{ fontSize: "1.55rem" }}>
            Cross-Dimensional Explorer
          </h1>
        </div>
        <p className="page-subtitle">
          Select any two dimensions and instantly visualize their
          cross-tabulation. Discover hidden patterns, correlations, and
          distribution anomalies across any combination of channels, clients,
          users, teams, languages, content types, and platforms.
        </p>
      </div>

      {/* Dimension selectors */}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          marginBottom: 28,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="label">Rows</span>
          <select
            className="input-field"
            value={exploreDim1}
            onChange={(e) => setExploreDim1(e.target.value as DimKey)}
            style={{ width: 160 }}
          >
            {dimOptions.map((d) => (
              <option key={d} value={d}>
                {dimLabels[d]}
              </option>
            ))}
          </select>
        </div>
        <ArrowRight size={16} style={{ color: "var(--text-muted)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="label">Columns</span>
          <select
            className="input-field"
            value={exploreDim2}
            onChange={(e) => setExploreDim2(e.target.value as DimKey)}
            style={{ width: 160 }}
          >
            {dimOptions
              .filter((d) => d !== exploreDim1)
              .map((d) => (
                <option key={d} value={d}>
                  {dimLabels[d]}
                </option>
              ))}
          </select>
        </div>
        {exploreLoading && (
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Loading…
          </span>
        )}
      </div>

      <div className="grid-2 section-gap">
        {/* Stacked bar */}
        <ChartCard
          title={`${dimLabels[exploreDim1]} × ${dimLabels[exploreDim2]} - Stacked Bar`}
          subtitle="Multi-dimensional"
          description={`How ${dimLabels[exploreDim2].toLowerCase()} distributes across each ${dimLabels[exploreDim1].toLowerCase()}.`}
          loading={exploreLoading}
          minHeight={320}
          fullscreenContent={
            <ResponsiveContainer
              width={Math.max(exploreStacked.rows.length * 80, 800)}
              height={500}
            >
              <BarChart
                data={exploreStacked.rows}
                margin={{ top: 8, right: 24, left: 0, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9 }}
                  angle={-30}
                  textAnchor="end"
                />
                <YAxis tick={{ fontSize: 10 }} width={36} />
                <Tooltip contentStyle={customTooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                {exploreStacked.dim2Keys.map((k, i) => (
                  <Bar
                    key={k}
                    dataKey={k}
                    stackId="a"
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    maxBarSize={36}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          }
        >
          <div style={{ overflowX: "auto" }}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={exploreStacked.rows}
                margin={{ top: 8, right: 12, left: -8, bottom: 50 }}
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
                {exploreStacked.dim2Keys.map((k, i) => (
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
          </div>
        </ChartCard>

        {/* Upgraded Heatmap - interactive with click-to-filter */}
        <ChartCard
          title={`${dimLabels[exploreDim1]} × ${dimLabels[exploreDim2]} - Heatmap`}
          subtitle="Click any cell to drill down"
          description="Cell intensity represents volume. Click a cell to see matching videos below."
          loading={exploreLoading}
          minHeight={320}
        >
          <div
            style={{
              overflow: "auto",
              maxHeight: Math.min(heatmapHeight, 600),
            }}
          >
            {exploreHeatGrid.cells.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `120px repeat(${exploreHeatGrid.yLabels.length}, minmax(54px, 1fr))`,
                  gap: 3,
                  minWidth: Math.max(exploreHeatGrid.yLabels.length * 60, 300),
                }}
              >
                {/* Header row */}
                <div
                  style={{
                    fontSize: "0.62rem",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    padding: "6px 4px",
                    display: "flex",
                    alignItems: "flex-end",
                  }}
                >
                  {dimLabels[exploreDim1]} ↓
                </div>
                {exploreHeatGrid.yLabels.map((y) => (
                  <div
                    key={y}
                    style={{
                      fontSize: "0.58rem",
                      textAlign: "center",
                      color: "var(--text-muted)",
                      padding: "4px 2px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontWeight: 600,
                    }}
                  >
                    {y}
                  </div>
                ))}
                {/* Data rows */}
                {exploreHeatGrid.xLabels.map((x) => (
                  <React.Fragment key={x}>
                    <div
                      style={{
                        fontSize: "0.62rem",
                        color: "var(--text-secondary)",
                        padding: "8px 6px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: 500,
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {x}
                    </div>
                    {exploreHeatGrid.yLabels.map((y) => {
                      const cell = exploreHeatGrid.cells.find(
                        (c) => c.x === x && c.y === y,
                      );
                      const intensity = cell?.intensity ?? 0;
                      const cellKey = `${x}::${y}`;
                      const isSelected =
                        selectedCell?.x === x && selectedCell?.y === y;
                      const isHovered = hoveredCell === cellKey;
                      const cellValue = cell?.value ?? 0;

                      return (
                        <div
                          key={cellKey}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleCellClick(x, y, cellValue)}
                          onMouseEnter={() => setHoveredCell(cellKey)}
                          onMouseLeave={() => setHoveredCell(null)}
                          onKeyDown={(e) =>
                            e.key === "Enter" &&
                            handleCellClick(x, y, cellValue)
                          }
                          title={`${x} × ${y}: ${cellValue} videos - Click to drill down`}
                          style={{
                            background: heatColor(intensity),
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.68rem",
                            fontWeight: intensity > 0.3 ? 600 : 400,
                            fontFamily: "var(--font-mono)",
                            color:
                              intensity > 0.45
                                ? "#fff"
                                : intensity > 0
                                  ? "var(--text-secondary)"
                                  : "var(--text-muted)",
                            minHeight: 32,
                            cursor: cellValue > 0 ? "pointer" : "default",
                            transition: "all 0.15s ease",
                            transform:
                              isHovered && cellValue > 0
                                ? "scale(1.08)"
                                : "scale(1)",
                            boxShadow: isSelected
                              ? "0 0 0 2.5px var(--accent), 0 2px 8px rgba(220,38,38,0.3)"
                              : isHovered && cellValue > 0
                                ? "0 2px 8px rgba(0,0,0,0.15)"
                                : "none",
                            zIndex: isHovered || isSelected ? 2 : 1,
                            position: "relative",
                          }}
                        >
                          {cellValue > 0 ? formatNumber(cellValue) : ""}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>No data for this combination</p>
              </div>
            )}
          </div>

          {/* Color scale legend */}
          {exploreHeatGrid.cells.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                Low
              </span>
              <div
                style={{
                  flex: 1,
                  maxWidth: 180,
                  height: 10,
                  borderRadius: 5,
                  background:
                    "linear-gradient(to right, rgba(255,220,200,0.3), rgba(220,38,38,0.9))",
                }}
              />
              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                High
              </span>
              <span
                style={{
                  fontSize: "0.68rem",
                  color: "var(--text-muted)",
                  marginLeft: 12,
                }}
              >
                Click a cell to see details
              </span>
            </div>
          )}
        </ChartCard>
      </div>

      {/* ─── Drill-Down Table ─── */}
      {selectedCell && (
        <div
          ref={drilldownRef}
          className="section-gap"
          style={{ marginTop: 28 }}
        >
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 24px",
                borderBottom: "1px solid var(--border-subtle)",
                background: "var(--bg-surface)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <TableIcon size={16} style={{ color: "var(--accent)" }} />
                <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                  {selectedCell.x} × {selectedCell.y}
                </span>
                <span className="badge" style={{ fontSize: "0.72rem" }}>
                  {drilldownTotal} clips
                </span>
                {selectedCell.value !== drilldownTotal && (
                  <span
                    style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}
                  >
                    ({selectedCell.value} input
                    {selectedCell.value !== 1 ? "s" : ""} → {drilldownTotal}{" "}
                    output clips)
                  </span>
                )}
              </div>
              <button
                className="btn-ghost"
                onClick={() => {
                  setSelectedCell(null);
                  setDrilldownVideos([]);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "0.8rem",
                  padding: "6px 12px",
                }}
              >
                <X size={14} /> Clear
              </button>
            </div>
            {/* Table */}
            <div style={{ padding: "0" }}>
              <DataTable
                columns={videoCols}
                data={drilldownVideos as unknown as Record<string, unknown>[]}
                loading={drilldownLoading}
                emptyMessage={`No matching videos found for ${selectedCell.x} × ${selectedCell.y}`}
                pageSize={10}
                maxHeight={400}
              />
            </div>
          </div>
        </div>
      )}

      {/* Treemap */}
      {exploreData.length > 0 && (
        <div className="section-gap" style={{ marginTop: 24 }}>
          <ChartCard
            title={`${dimLabels[exploreDim1]} × ${dimLabels[exploreDim2]} - Treemap`}
            subtitle="Multi-dimensional"
            description="Proportional area view - larger rectangles represent higher content volume for that combination."
            loading={exploreLoading}
            minHeight={280}
          >
            <ResponsiveContainer width="100%" height={260}>
              <Treemap
                data={exploreData.map((c) => ({
                  name: `${c.dim1_label} / ${c.dim2_label}`,
                  label: c.dim2_label,
                  group: c.dim1_label,
                  value: c.count,
                  share_pct:
                    (c.count /
                      (exploreData.reduce((sum, item) => sum + item.count, 0) ||
                        1)) *
                    100,
                }))}
                dataKey="value"
                nameKey="name"
                content={<TreemapCell />}
              >
                <Tooltip content={<TreemapTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </div>
  );
}
