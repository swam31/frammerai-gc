"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import {
  CartesianGrid,
  Area,
  Bar,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCard from "@/components/ui/ChartCard";
import DataTable from "@/components/ui/DataTable";
import { useFilters } from "@/lib/filters-context";
import {
  buildAnalyticsRequest,
  buildTrendRequest,
  dataQualityApi,
  type DQDuplicate,
  type DQErrorDetail,
  type DQErrorItem,
  type DQFieldReport,
  type DQIncident,
  type DQStory,
  type DQTrendPoint,
} from "@/lib/api";
import { CHART_COLORS, customTooltipStyle } from "@/lib/chart-utils";

type DuplicateRow = {
  input_video_id: number | string;
  duplicate_count: number;
};

type TrendRow = {
  period: string;
  error_count: number;
};

const statusTone: Record<string, string> = {
  strong: "badge-success",
  stable: "badge-info",
  watch: "badge-warning",
  critical: "badge-danger",
};

const severityTone: Record<string, string> = {
  low: "badge-neutral",
  medium: "badge-warning",
  high: "badge-danger",
  critical: "badge-danger",
};

function scoreTone(score: number) {
  if (score >= 85) return "var(--green)";
  if (score >= 65) return "var(--blue)";
  if (score >= 45) return "var(--amber)";
  return "var(--red)";
}

function fieldRisk(report: DQFieldReport) {
  return Number(report.missing_pct) * 0.7 + Number(report.unknown_pct) * 0.9;
}

export default function DataQualityPage() {
  const { dateRange, filters, loading: filtersLoading } = useFilters();
  const [story, setStory] = useState<DQStory | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateRow[]>([]);
  const [trendSeries, setTrendSeries] = useState<TrendRow[]>([]);
  const [selectedErrorType, setSelectedErrorType] = useState<string | null>(
    null,
  );
  const [errorDetails, setErrorDetails] = useState<DQErrorDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorDetailsLoading, setErrorDetailsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (filtersLoading) return;
    setLoading(true);
    try {
      const request = buildAnalyticsRequest(dateRange, filters);
      const trendRequest = buildTrendRequest(dateRange, filters, "monthly");
      const [storyResp, duplicatesResp, trendResp] = await Promise.all([
        dataQualityApi.story(request).catch(() => null),
        dataQualityApi.duplicates(request).catch(() => []),
        dataQualityApi.trends(trendRequest).catch(() => []),
      ]);

      const normalizedDuplicates = (duplicatesResp as DQDuplicate[]).map(
        (row) => ({
          input_video_id: row.input_video_id,
          duplicate_count: Number(row.duplicate_count ?? row.occurrences) || 0,
        }),
      );

      const trendMap = new Map<string, number>();
      for (const point of trendResp as DQTrendPoint[]) {
        const period = String(point.period ?? "");
        if (!period) continue;
        const count = Number(point.error_count ?? point.count) || 0;
        trendMap.set(period, (trendMap.get(period) ?? 0) + count);
      }
      const normalizedTrendSeries = Array.from(trendMap.entries())
        .map(([period, error_count]) => ({ period, error_count }))
        .sort((a, b) => a.period.localeCompare(b.period));

      setStory(storyResp as DQStory | null);
      setDuplicates(normalizedDuplicates);
      setTrendSeries(normalizedTrendSeries);
      setSelectedErrorType((current) => {
        const next =
          (storyResp as DQStory | null)?.error_type_distribution?.[0]
            ?.error_type ?? null;
        return current ?? next;
      });
    } catch (error) {
      console.error(error);
      setStory(null);
      setDuplicates([]);
      setTrendSeries([]);
    } finally {
      setLoading(false);
    }
  }, [dateRange, filters, filtersLoading]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!selectedErrorType || filtersLoading) {
      setErrorDetails([]);
      return;
    }

    let cancelled = false;
    const loadDetails = async () => {
      setErrorDetailsLoading(true);
      try {
        const request = buildAnalyticsRequest(dateRange, filters);
        const rows = await dataQualityApi.errorDetails({
          ...request,
          error_type: selectedErrorType,
        });
        if (!cancelled) setErrorDetails(rows);
      } catch (error) {
        console.error(error);
        if (!cancelled) setErrorDetails([]);
      } finally {
        if (!cancelled) setErrorDetailsLoading(false);
      }
    };

    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [dateRange, filters, filtersLoading, selectedErrorType]);

  const isLoading = loading || filtersLoading;
  const summary = story?.summary;
  const overallScore = summary?.overall_score ?? 0;
  const scoreColor = scoreTone(overallScore);
  const ringRadius = 66;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringFill = (overallScore / 100) * ringCircumference;

  const pillars = useMemo(() => story?.pillars ?? [], [story?.pillars]);
  const incidents = useMemo(() => story?.incidents ?? [], [story?.incidents]);
  const fieldReports = useMemo(
    () =>
      [...(story?.field_reports ?? [])].sort(
        (a, b) => fieldRisk(b) - fieldRisk(a),
      ),
    [story?.field_reports],
  );
  const topErrors = useMemo(
    () => story?.error_type_distribution ?? [],
    [story?.error_type_distribution],
  );
  const hotspots = useMemo(() => story?.hotspots ?? [], [story?.hotspots]);
  const trend = useMemo(() => story?.score_trend ?? [], [story?.score_trend]);
  const legacyErrors = useMemo<DQErrorItem[]>(
    () =>
      topErrors.map((item) => ({
        error_type: item.error_type,
        count: Number(item.count) || 0,
      })),
    [topErrors],
  );

  const selectedIncident = useMemo(
    () =>
      incidents.find((item) => item.title === summary?.priority_focus) ??
      incidents[0],
    [incidents, summary?.priority_focus],
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Data Quality Command Center</h1>
        <p className="page-subtitle">
          This page now behaves like a trust narrative for stakeholders: it shows
          where confidence is strong, where reliability is leaking, which
          channels carry the largest blast radius, and exactly what should be
          fixed first.
        </p>
      </div>

      <div className="dq-hero section-gap">
        <div className="dq-hero__score">
          {isLoading ? (
            <div
              className="skeleton"
              style={{ width: 168, height: 168, borderRadius: "50%" }}
            />
          ) : (
            <div style={{ position: "relative", width: 168, height: 168 }}>
              <svg width="168" height="168" viewBox="0 0 168 168">
                <circle
                  cx="84"
                  cy="84"
                  r={ringRadius}
                  fill="none"
                  stroke="var(--border-subtle)"
                  strokeWidth="11"
                />
                <circle
                  cx="84"
                  cy="84"
                  r={ringRadius}
                  fill="none"
                  stroke={scoreColor}
                  strokeWidth="11"
                  strokeDasharray={`${ringFill} ${ringCircumference - ringFill}`}
                  strokeDashoffset={ringCircumference * 0.25}
                  strokeLinecap="round"
                />
              </svg>
              <div className="dq-hero__score-label">
                <div className="kpi-number" style={{ color: scoreColor }}>
                  {overallScore.toFixed(0)}
                </div>
                <span className="label">Trust Score</span>
              </div>
            </div>
          )}
        </div>

        <div className="dq-hero__body">
          <div className="dq-hero__kicker">
            <Sparkles size={14} /> Trust Narrative
          </div>
          <h2 className="dq-hero__title">
            {summary?.headline ?? "Scanning pipeline quality..."}
          </h2>
          <p className="dq-hero__copy">
            {summary?.verdict ??
              "The page computes a blended view of completeness, validity, reliability, uniqueness, and classification quality."}
          </p>
          <div className="dq-metric-strip">
            <div>
              <span className="label">Affected</span>
              <strong>{summary?.affected_pct?.toFixed(1) ?? "0.0"}%</strong>
            </div>
            <div>
              <span className="label">Errors</span>
              <strong>{summary?.total_errors ?? 0}</strong>
            </div>
            <div>
              <span className="label">Field Issues</span>
              <strong>{summary?.total_field_issues ?? 0}</strong>
            </div>
            <div>
              <span className="label">Duplicate Clusters</span>
              <strong>{summary?.duplicate_clusters ?? 0}</strong>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span
              className={`badge ${statusTone[summary?.momentum_label === "deteriorating" ? "critical" : summary?.momentum_label === "improving" ? "strong" : "stable"] ?? "badge-neutral"}`}
            >
              <Activity size={11} /> {summary?.momentum_label ?? "stable"}
            </span>
            {summary?.weakest_pillar && (
              <span className="badge badge-warning">
                <Target size={11} /> Weakest pillar: {summary.weakest_pillar}
              </span>
            )}
            {summary?.priority_focus && (
              <span className="badge badge-danger">
                <ShieldAlert size={11} /> Priority: {summary.priority_focus}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="dq-pillars-grid section-gap">
        {isLoading
          ? Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="card-static skeleton"
                style={{ minHeight: 150 }}
              />
            ))
          : pillars.map((pillar) => (
              <div key={pillar.pillar} className="dq-pillar card-static">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div>
                    <div className="label">{pillar.pillar}</div>
                    <div className="kpi-number-sm" style={{ marginTop: 8 }}>
                      {pillar.score.toFixed(0)}
                    </div>
                  </div>
                  <span
                    className={`badge ${statusTone[pillar.status] ?? "badge-neutral"}`}
                  >
                    {pillar.status}
                  </span>
                </div>
                <div className="dq-pillar__bar">
                  <span
                    style={{
                      width: `${pillar.score}%`,
                      background: scoreTone(pillar.score),
                    }}
                  />
                </div>
                <p className="section-description">{pillar.description}</p>
                <div className="dq-pillar__meta">
                  <span>{pillar.issue_count} issue events</span>
                  <span>{pillar.affected_pct.toFixed(1)}% pressure</span>
                </div>
              </div>
            ))}
      </div>

      <div className="grid-2 section-gap">
        <ChartCard
          title="Trust Trajectory"
          description="Monthly score movement combines field-completeness pressure with the share of records touched by logged incidents."
          loading={isLoading}
          minHeight={300}
          isEmpty={!isLoading && trend.length === 0}
          emptyMessage="No trend data returned for the selected slice."
        >
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend}>
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10 }}
                  domain={[0, 100]}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  allowDecimals={false}
                />
                <Tooltip contentStyle={customTooltipStyle()} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="quality_score"
                  fill="var(--accent-glow-soft)"
                  stroke="var(--accent-bright)"
                  strokeWidth={2.5}
                />
                <Bar
                  yAxisId="right"
                  dataKey="error_events"
                  fill="var(--red)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Incident Command Board"
          description="Ranked by weighted urgency so the highest-trust recovery move is obvious within a few seconds."
          loading={isLoading}
          minHeight={300}
          isEmpty={!isLoading && incidents.length === 0}
          emptyMessage="No incidents were generated from the current filters."
        >
          <div className="dq-incident-list h-75 overflow-scroll">
            {incidents.slice(0, 8).map((incident: DQIncident) => (
              <button
                key={incident.issue_key}
                type="button"
                className={`dq-incident-card ${selectedIncident?.issue_key === incident.issue_key ? "active" : ""}`}
                onClick={() => {
                  const matchingError = topErrors.find(
                    (item) => item.error_type === incident.title,
                  );
                  if (matchingError)
                    setSelectedErrorType(matchingError.error_type);
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <div className="label">{incident.category}</div>
                    <div style={{ fontWeight: 700, marginTop: 6 }}>
                      {incident.title}
                    </div>
                  </div>
                  <span
                    className={`badge ${severityTone[incident.severity] ?? "badge-neutral"}`}
                  >
                    {incident.severity}
                  </span>
                </div>
                <p className="section-description" style={{ marginTop: 10 }}>
                  {incident.recommended_action}
                </p>
                <div className="dq-incident-card__meta">
                  <span>{incident.priority_score.toFixed(0)} priority</span>
                  <span>{incident.affected_pct.toFixed(1)}% affected</span>
                  <span>{incident.occurrences} occurrences</span>
                </div>
              </button>
            ))}
          </div>
        </ChartCard>
      </div>

      <div className="grid-2 section-gap">
        <ChartCard
          title="Blast Radius by Channel"
          description="Where should the cleanup team start first?"
          loading={isLoading}
          minHeight={320}
          isEmpty={!isLoading && hotspots.length === 0}
          emptyMessage="No hotspot dimensions were returned."
        >
          <div style={{ width: "100%", height: 290 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={hotspots}
                layout="vertical"
                margin={{ top: 8, right: 12, left: 12, bottom: 0 }}
              >
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="dimension_value"
                  width={110}
                  tick={{ fontSize: 9 }}
                />
                <Tooltip contentStyle={customTooltipStyle()} />
                <Bar
                  dataKey="incident_index"
                  radius={[0, 6, 6, 0]}
                  maxBarSize={16}
                >
                  {hotspots.map((item, index) => (
                    <Cell
                      key={index}
                      fill={scoreTone(100 - item.incident_index)}
                    />
                  ))}
                </Bar>
                <Area
                  type="monotone"
                  dataKey="affected_pct"
                  fill="var(--accent-glow-soft)"
                  stroke="var(--accent-soft)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Error Genome"
          description="A visual fingerprint of the failure modes currently shaping trust."
          loading={isLoading}
          minHeight={320}
          isEmpty={!isLoading && topErrors.length === 0}
          emptyMessage="No error-type distribution was returned."
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) minmax(0,0.9fr)",
              gap: 20,
              alignItems: "center",
              minWidth: 0,
            }}
          >
            <div style={{ width: "100%", height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={topErrors}
                    dataKey="count"
                    nameKey="error_type"
                    innerRadius={48}
                    outerRadius={92}
                    paddingAngle={3}
                  >
                    {topErrors.map((_, index) => (
                      <Cell
                        key={index}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={customTooltipStyle()} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="dq-error-legend" style={{ maxHeight: 250, overflowY: "auto" }}>
              {topErrors.slice(0, 8).map((item, index) => (
                <button
                  key={`${item.error_type}-${index}`}
                  type="button"
                  className="dq-error-legend__item"
                  onClick={() => setSelectedErrorType(item.error_type)}
                >
                  <span
                    className="dq-error-legend__swatch"
                    style={{
                      background: CHART_COLORS[index % CHART_COLORS.length],
                    }}
                  />
                  <span>{item.error_type}</span>
                  <strong>{item.count}</strong>
                </button>
              ))}
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="grid-2 section-gap">
        <ChartCard
          title="Field Integrity Radar"
          description="Weighted by missing and unknown pressure, so the dirtiest fields rise to the top immediately."
          loading={isLoading}
          minHeight={260}
        >
          <DataTable<DQFieldReport>
            columns={[
              { key: "field_name", label: "Field", sortable: true },
              {
                key: "total_records",
                label: "Records",
                sortable: true,
                align: "right",
              },
              {
                key: "missing_count",
                label: "Missing",
                sortable: true,
                align: "right",
              },
              {
                key: "unknown_count",
                label: "Unknown",
                sortable: true,
                align: "right",
              },
              {
                key: "risk",
                label: "Risk Index",
                sortable: true,
                align: "right",
                render: (row: DQFieldReport) => (
                  <span
                    className={`badge ${fieldRisk(row) >= 18 ? "badge-danger" : fieldRisk(row) >= 8 ? "badge-warning" : "badge-success"}`}
                  >
                    {fieldRisk(row).toFixed(1)}
                  </span>
                ),
              },
            ]}
            data={fieldReports.map((item) => ({
              ...item,
              risk: fieldRisk(item),
            }))}
            pageSize={8}
          />
        </ChartCard>

        <ChartCard
          title="Duplicate Pressure"
          description="Duplicate clusters are surfaced separately because they can silently inflate every downstream KPI."
          loading={isLoading}
          minHeight={260}
        >
          <DataTable<DuplicateRow>
            columns={[
              { key: "input_video_id", label: "Video ID", sortable: true },
              {
                key: "duplicate_count",
                label: "Occurrences",
                sortable: true,
                align: "right",
                render: (row: DuplicateRow) => (
                  <span className="badge badge-danger">
                    {row.duplicate_count}
                  </span>
                ),
              },
            ]}
            data={duplicates}
            pageSize={6}
            emptyMessage="No duplicate clusters found for the current selection."
          />
        </ChartCard>
      </div>

      <div className="grid-2 section-gap">
        <ChartCard
          title="Error Trends Over Time"
          description="Monthly logged-error volume, preserved as the direct operational trend view."
          loading={isLoading}
          minHeight={280}
          isEmpty={!isLoading && trendSeries.length === 0}
          emptyMessage="No time-series error data was returned for the selected filters."
        >
          <div style={{ width: "100%", height: 340, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={trendSeries}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={customTooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: "0.72rem", paddingTop: 8 }} />
                <Line
                  type="monotone"
                  dataKey="error_count"
                  stroke="var(--red)"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: "var(--red)" }}
                  name="Errors"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Logged Errors"
          description="Ranked list of current error classes. Click a row to inspect the detailed underlying records."
          loading={isLoading}
          minHeight={180}
          isEmpty={!isLoading && legacyErrors.length === 0}
          emptyMessage="No logged error rows were returned."
        >
          <DataTable<DQErrorItem>
            columns={[
              { key: "error_type", label: "Error Type", sortable: true },
              {
                key: "count",
                label: "Count",
                sortable: true,
                align: "right",
                render: (row: DQErrorItem) => (
                  <span className="badge badge-danger">{row.count}</span>
                ),
              },
            ]}
            data={legacyErrors}
            pageSize={4}
            onRowClick={(row: DQErrorItem) =>
              setSelectedErrorType(row.error_type)
            }
          />
        </ChartCard>
      </div>

      {selectedErrorType && (
        <div className="section-gap">
          <ChartCard
            title={`Error Drilldown: ${selectedErrorType}`}
            description="Clicking an error from the genome or incident board reveals the underlying records for fast root-cause analysis."
            minHeight={220}
            isEmpty={!errorDetailsLoading && errorDetails.length === 0}
            emptyMessage="No detailed rows were returned for this error type."
          >
            <DataTable<DQErrorDetail>
              columns={[
                { key: "log_date", label: "Log Date", sortable: true },
                { key: "input_video_id", label: "Video ID", sortable: true },
                { key: "headline", label: "Headline", sortable: true },
                { key: "source_name", label: "Source", sortable: true },
                { key: "channel_name", label: "Channel", sortable: true },
                { key: "client_name", label: "Client", sortable: true },
                { key: "team_name", label: "Team", sortable: true },
                { key: "dq_log_id", label: "Log ID", sortable: true },
              ]}
              data={errorDetails}
              loading={errorDetailsLoading}
              pageSize={10}
            />
          </ChartCard>
        </div>
      )}

      {!isLoading && summary && (
        <div className="card-static dq-footer-note">
          {overallScore >= 80 ? (
            <CheckCircle size={18} />
          ) : overallScore >= 55 ? (
            <ShieldCheck size={18} />
          ) : (
            <AlertTriangle size={18} />
          )}
          <span>
            Strongest pillar:{" "}
            <strong>{summary.strongest_pillar ?? "n/a"}</strong>. Recovery path:{" "}
            <strong>{summary.priority_focus ?? "continue monitoring"}</strong>.
          </span>
        </div>
      )}
    </div>
  );
}
