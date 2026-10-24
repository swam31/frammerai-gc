/* ── Frammer Analytics API Client ──────────────────────── */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

/* ── Types ─────────────────────────────────────────────── */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
  message?: string;
}

export interface DateRangeFilter {
  start_date?: string | null;
  end_date?: string | null;
}

export interface ComparisonDateRange {
  current: DateRangeFilter;
  previous?: DateRangeFilter | null;
}

export interface DimensionFilter {
  client_ids?: string[] | null;
  channel_ids?: string[] | null;
  user_ids?: string[] | null;
  team_ids?: string[] | null;
  language_ids?: string[] | null;
  input_type_ids?: string[] | null;
  output_type_ids?: string[] | null;
  platform_ids?: string[] | null;
  is_billable?: boolean | null;
}

export interface AnalyticsRequest {
  date_range: DateRangeFilter;
  filters: DimensionFilter;
}

export interface TrendRequest extends AnalyticsRequest {
  granularity: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  metric?: 'count' | 'duration' | 'both';
}

export interface ComparisonRequest {
  date_range: ComparisonDateRange;
  filters: DimensionFilter;
}

export interface MultiDimensionRequest extends AnalyticsRequest {
  dimension1: string;
  dimension2?: string | null;
  metric?: 'count' | 'duration' | 'both';
}

export interface TopNRequest extends AnalyticsRequest {
  dimension: string;
  metric?: 'count' | 'duration' | 'both';
  n?: number;
  sort?: 'asc' | 'desc';
}

export interface VideoSearchRequest extends AnalyticsRequest {
  search_query?: string | null;
  published_only?: boolean | null;
  pagination: { page: number; page_size: number };
  sort_by?: string | null;
  sort_order?: 'asc' | 'desc';
}

export type CustomKpiInputMode = 'natural_language' | 'sql';

export interface CustomKpiQueryRequest {
  query: string;
  input_mode: CustomKpiInputMode;
}

export interface CreateCustomKpiRequest extends CustomKpiQueryRequest {
  name: string;
  description?: string | null;
}

/* ── Helpers ───────────────────────────────────────────── */

async function apiPost<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const json: ApiResponse<T> = await res.json();
  return json.data;
}

async function apiPostRaw<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const json = await res.json();
      detail = json?.detail || detail;
    } catch {}
    throw new Error(`API error: ${detail}`);
  }
  return res.json();
}

async function apiGet<T>(endpoint: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${API_BASE}${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const json: ApiResponse<T> = await res.json();
  return json.data;
}

export function buildAnalyticsRequest(
  dateRange: DateRangeFilter,
  filters: DimensionFilter,
): AnalyticsRequest {
  return { date_range: dateRange, filters };
}

export function buildTrendRequest(
  dateRange: DateRangeFilter,
  filters: DimensionFilter,
  granularity: TrendRequest['granularity'] = 'daily',
): TrendRequest {
  return { date_range: dateRange, filters, granularity };
}

export function buildComparisonRequest(
  current: DateRangeFilter,
  previous: DateRangeFilter | null,
  filters: DimensionFilter,
): ComparisonRequest {
  return {
    date_range: { current, previous },
    filters,
  };
}

/* ── Filters ───────────────────────────────────────────── */

export const filtersApi = {
  companies: () => apiGet<{ id: string; name: string }[]>('/filters/companies'),
  channels: (clientId?: string) => apiGet<{ id: string; name: string; client_id: string; client_name: string }[]>('/filters/channels', clientId ? { client_id: clientId } : undefined),
  users: (teamId?: string) => apiGet<{ id: string; name: string; team_id: string; team_name: string }[]>('/filters/users', teamId ? { team_id: teamId } : undefined),
  teams: () => apiGet<{ id: string; name: string }[]>('/filters/teams'),
  languages: () => apiGet<{ id: string; name: string }[]>('/filters/languages'),
  inputTypes: () => apiGet<{ id: string; name: string }[]>('/filters/input-types'),
  outputTypes: () => apiGet<{ id: string; name: string }[]>('/filters/output-types'),
  platforms: () => apiGet<{ id: string; name: string }[]>('/filters/platforms'),
  dateRange: () => apiGet<{ min_date: string; max_date: string }>('/filters/date-range'),
};

/* ── KPI ───────────────────────────────────────────────── */

export const kpiApi = {
  summary: (body: AnalyticsRequest) => apiPost<KPISummary>('/kpi/summary', body),
  comparison: (body: ComparisonRequest) => apiPost<KPIComparison>('/kpi/comparison', body),
  cards: (body: AnalyticsRequest) => apiPost<OutputTypeCard[]>('/kpi/cards', body),
};

/* ── Trends ────────────────────────────────────────────── */

export const trendsApi = {
  timeseries: (body: TrendRequest) => apiPost<TrendPoint[]>('/trends/timeseries', body),
  processedTimeseries: (body: TrendRequest) => apiPost<TrendPoint[]>('/trends/processed-timeseries', body),
  publishedTimeseries: (body: TrendRequest) => apiPost<TrendPoint[]>('/trends/published-timeseries', body),
  comparison: (body: ComparisonRequest) => apiPost<{ current: TrendPoint[]; previous?: TrendPoint[] }>('/trends/comparison', body),
  cumulative: (body: TrendRequest) => apiPost<CumulativePoint[]>('/trends/cumulative', body),
  growthRate: (body: TrendRequest) => apiPost<GrowthPoint[]>('/trends/growth-rate', body),
};

/* ── Multi-Dimension ───────────────────────────────────── */

export const dimensionsApi = {
  single: (body: MultiDimensionRequest) => apiPost<DimensionBreakdownItem[]>('/dimensions/single', body),
  double: (body: MultiDimensionRequest) => apiPost<CrossDimensionCell[]>('/dimensions/double', body),
  pivot: (body: MultiDimensionRequest) => apiPost<PivotData>('/dimensions/pivot', body),
  heatmap: (body: MultiDimensionRequest) => apiPost<HeatmapCell[]>('/dimensions/heatmap', body),
};

/* ── Funnel ────────────────────────────────────────────── */

export const funnelApi = {
  overview: (body: AnalyticsRequest) => apiPost<FunnelStage[]>('/funnel/overview', body),
  byDimension: (body: TopNRequest) => apiPost<FunnelDimensionItem[]>('/funnel/by-dimension', body),
  conversionRates: (body: TopNRequest) => apiPost<ConversionRateItem[]>('/funnel/conversion-rates', body),
  bottlenecks: (body: TopNRequest) => apiPost<BottleneckItem[]>('/funnel/bottlenecks', body),
};

/* ── Channel / Client / User / Team ────────────────────── */

export const channelApi = {
  performance: (body: AnalyticsRequest) => apiPost<ChannelPerf[]>('/channels/performance', body),
  trends: (body: TrendRequest) => apiPost<EntityTrend[]>('/channels/trends', body),
  ranking: (body: AnalyticsRequest) => apiPost<RankedEntity[]>('/channels/ranking', body),
};

export const clientApi = {
  performance: (body: AnalyticsRequest) => apiPost<ClientPerf[]>('/clients/performance', body),
  channelBreakdown: (body: AnalyticsRequest) => apiPost<ChannelBreakdownItem[]>('/clients/channel-breakdown', body),
  trends: (body: TrendRequest) => apiPost<EntityTrend[]>('/clients/trends', body),
  usageDistribution: (body: AnalyticsRequest) => apiPost<UsageDistItem[]>('/clients/usage-distribution', body),
};

export const userApi = {
  performance: (body: AnalyticsRequest) => apiPost<UserPerf[]>('/users/performance', body),
  activity: (body: TrendRequest) => apiPost<EntityTrend[]>('/users/activity', body),
  ranking: (body: AnalyticsRequest) => apiPost<RankedEntity[]>('/users/ranking', body),
  underutilized: (body: AnalyticsRequest) => apiPost<UnderutilizedUser[]>('/users/underutilized', body),
};

export const teamApi = {
  performance: (body: AnalyticsRequest) => apiPost<TeamPerf[]>('/teams/performance', body),
  memberBreakdown: (body: AnalyticsRequest) => apiPost<TeamMember[]>('/teams/member-breakdown', body),
};

/* ── Content Mix ───────────────────────────────────────── */

export const contentApi = {
  outputTypeMix: (body: AnalyticsRequest) => apiPost<TypeMixItem[]>('/content/output-type-mix', body),
  inputTypeMix: (body: AnalyticsRequest) => apiPost<TypeMixItem[]>('/content/input-type-mix', body),
  typeTrends: (body: TrendRequest) => apiPost<TypeTrendItem[]>('/content/type-trends', body),
  inputTypeTrends: (body: TrendRequest) => apiPost<TypeTrendItem[]>('/content/input-type-trends', body),
  typeChannelMatrix: (body: AnalyticsRequest) => apiPost<TypeChannelMatrix>('/content/type-channel-matrix', body),
};

/* ── Language / Platform ───────────────────────────────── */

export const languageApi = {
  distribution: (body: AnalyticsRequest) => apiPost<LangDistItem[]>('/languages/distribution', body),
  trends: (body: TrendRequest) => apiPost<EntityTrend[]>('/languages/trends', body),
  byChannel: (body: AnalyticsRequest) => apiPost<LangChannelItem[]>('/languages/by-channel', body),
};

export const platformApi = {
  distribution: (body: AnalyticsRequest) => apiPost<PlatformDistItem[]>('/platforms/distribution', body),
  trends: (body: TrendRequest) => apiPost<EntityTrend[]>('/platforms/trends', body),
  byType: (body: AnalyticsRequest) => apiPost<PlatformTypeItem[]>('/platforms/by-type', body),
};

/* ── Data Quality ──────────────────────────────────────── */

export const dataQualityApi = {
  overview: (body: AnalyticsRequest) => apiPost<DQFieldReport[]>('/data-quality/overview', body),
  errors: (body: AnalyticsRequest) => apiPost<DQErrorItem[]>('/data-quality/errors', body),
  errorDetails: (body: AnalyticsRequest & { error_type: string }) => apiPost<DQErrorDetail[]>('/data-quality/errors/details', body),
  trends: (body: TrendRequest) => apiPost<DQTrendPoint[]>('/data-quality/trends', body),
  missingByDimension: (body: AnalyticsRequest) => apiPost<DQDimItem[]>('/data-quality/missing-fields', body),
  duplicates: (body: AnalyticsRequest) => apiPost<DQDuplicate[]>('/data-quality/duplicates', body),
  score: (body: AnalyticsRequest) => apiPost<DQScore>('/data-quality/score', body),
  story: (body: AnalyticsRequest) => apiPost<DQStory>('/data-quality/story', body),
};

/* ── Video Explorer ────────────────────────────────────── */

export const videoApi = {
  search: (body: VideoSearchRequest) => apiPost<PaginatedVideos>('/videos/search', body),
  detail: (id: number | string) => apiGet<VideoDetail[]>(`/videos/detail/${id}`),
  exportCsv: (body: VideoSearchRequest) => apiPost<VideoDetail[]>('/videos/export', body),
  stats: (body: VideoSearchRequest) => apiPost<BulkStats>('/videos/bulk-stats', body),
};

/* ── Rankings ──────────────────────────────────────────── */

export const rankingsApi = {
  topN: (body: TopNRequest) => apiPost<RankedItem[]>('/rankings/top-n', body),
  bottomN: (body: TopNRequest) => apiPost<RankedItem[]>('/rankings/bottom-n', body),
  movers: (body: ComparisonRequest) => apiPost<MoversData>('/rankings/movers', body),
};

/* ── Alerts ────────────────────────────────────────────── */

export const alertsApi = {
  anomalies: (body: AnalyticsRequest) => apiPost<AnomalyAlert[]>('/alerts/anomalies', body),
  dropOffs: (body: AnalyticsRequest) => apiPost<DropOffAlert[]>('/alerts/drop-offs', body),
  channelAnomalies: (body: AnalyticsRequest) => apiPost<ChannelAnomalyItem[]>('/alerts/channel-anomalies', body),
};

/* ── Comparisons ───────────────────────────────────────── */

export const compareApi = {
  periods: (body: ComparisonRequest) => apiPost<KPIComparison>('/compare/periods', body),
  benchmarks: (body: AnalyticsRequest) => apiPost<BenchmarkResult>('/compare/benchmarks', body),
};

/* ── Operational KPIs ─────────────────────────────────── */

export const operationalApi = {
  kpis: (body: AnalyticsRequest) => apiPost<OperationalKPIs>('/kpi/operational', body),
  categoryPerformance: (body: AnalyticsRequest) => apiPost<CategoryPerformance[]>('/kpi/content-category-performance', body),
};

/* ── Productivity & Efficiency ────────────────────────── */

export const productivityApi = {
  userEfficiency: (body: AnalyticsRequest) => apiPost<UserProductivityItem[]>('/productivity/user-efficiency', body),
  teamEfficiency: (body: AnalyticsRequest) => apiPost<TeamEfficiencyItem[]>('/productivity/team-efficiency', body),
  pipelineVelocity: (body: TrendRequest) => apiPost<PipelineVelocityPoint[]>('/productivity/pipeline-velocity', body),
  platformReach: (body: AnalyticsRequest) => apiPost<PlatformReachItem[]>('/productivity/platform-reach', body),
};

/* -- Intelligence Layer -- */

export const intelligenceApi = {
  controlTower: (body: AnalyticsRequest) => apiPost<ControlTowerResponse>('/intelligence/control-tower', body),
  scenarioSimulator: (body: ScenarioSimulationRequest) => apiPost<ScenarioSimulationResponse>('/intelligence/scenario-simulator', body),
  lostValue: (body: AnalyticsRequest) => apiPost<LostValueResponse>('/intelligence/lost-value', body),
  peerDna: (body: AnalyticsRequest) => apiPost<PeerDNAResponse>('/intelligence/peer-dna', body),
};

export const customKpiApi = {
  preview: (body: CustomKpiQueryRequest) => apiPost<CustomKpiExecutionResult>('/custom-kpis/preview', body),
  create: (body: CreateCustomKpiRequest) => apiPost<SavedCustomKpi>('/custom-kpis', body),
  list: () => apiGet<SavedCustomKpi[]>('/custom-kpis'),
  detail: (id: number | string) => apiGet<SavedCustomKpi>(`/custom-kpis/${id}`),
};

export const nlpPipelineApi = {
  query: (body: { query: string }) => apiPostRaw<NlpPipelineResult>('/nlp-pipeline/query', body),
};

/* ── Response Types ────────────────────────────────────── */

export interface KPIValue {
  count: number;
  duration_seconds: number;
  duration_hours: number;
}

export interface KPIWithPublished {
  total: KPIValue;
  published: KPIValue;
  publish_rate_pct: number;
}

export interface KPISummary {
  uploaded: KPIWithPublished;
  processed: KPIWithPublished;
  published: KPIValue;
}

export interface KPIComparison {
  current: KPISummary;
  previous?: KPISummary;
  delta?: Record<string, unknown>;
  pct_change?: Record<string, unknown>;
}

export interface OutputTypeCard {
  output_type_id: string;
  output_type: string;
  total_count: number;
  total_duration_hours: number;
  published_count: number;
  published_duration_hours: number;
  publish_rate_pct: number;
}

export interface TrendPoint {
  period: string;
  count: number;
  duration_hours: number;
}

export interface CumulativePoint {
  period: string;
  cumulative_count: number;
  cumulative_duration_hours: number;
}

export interface GrowthPoint {
  period: string;
  count: number;
  growth_pct: number | null;
}

export interface DimensionBreakdownItem {
  dimension_id: number;
  dimension_label: string;
  count: number;
  duration_hours: number;
  published_count: number;
  published_duration_hours: number;
  publish_rate_pct: number;
}

export interface CrossDimensionCell {
  dim1_id: string;
  dim1_label: string;
  dim2_id: string;
  dim2_label: string;
  count: number;
  duration_hours: number;
}

export interface PivotData {
  dim2_values: string[];
  rows: Record<string, unknown>[];
}

export interface HeatmapCell {
  x: string;
  y: string;
  value: number;
}

export interface FunnelStage {
  stage: string;
  count: number;
  duration_hours: number;
  drop_off_pct: number | null;
}

export interface FunnelDimensionItem {
  dimension_id: number;
  dimension_label: string;
  uploaded_count: number;
  processed_count: number;
  published_count: number;
  upload_to_process_pct: number;
  process_to_publish_pct: number;
}

export interface ConversionRateItem {
  dimension_id: number;
  dimension_label: string;
  uploaded: number;
  published: number;
  conversion_pct: number;
}

export interface BottleneckItem {
  dimension_id: number;
  dimension_label: string;
  processed_count: number;
  published_count: number;
  gap_count: number;
  gap_pct: number;
}

export interface ChannelPerf {
  channel_id: number;
  channel_name: string;
  client_name: string;
  uploaded_count: number;
  uploaded_duration_hours: number;
  processed_count: number;
  processed_duration_hours: number;
  published_count: number;
  published_duration_hours: number;
  publish_rate_pct: number;
}

export interface ClientPerf {
  client_id: number;
  client_name: string;
  uploaded_count: number;
  uploaded_duration_hours: number;
  published_count: number;
  published_duration_hours: number;
  publish_rate_pct: number;
}

export interface ChannelBreakdownItem {
  client_id: string;
  client_name: string;
  channel_id: string;
  channel_name: string;
  count: number;
  duration_hours: number;
}

export interface UsageDistItem {
  client: string;
  count: number;
  duration_hours: number;
  share_pct: number;
}

export interface UserPerf {
  user_id: number;
  user_name: string;
  team_name: string;
  uploaded_count: number;
  uploaded_duration_hours: number;
  published_count: number;
  publish_rate_pct: number;
}

export interface UnderutilizedUser {
  user_id: number;
  user_name: string;
  team_name: string;
  uploaded_count: number;
  published_count: number;
  publish_rate_pct: number;
}

export interface TeamPerf {
  team_id: number;
  team_name: string;
  uploaded_count: number;
  uploaded_duration_hours: number;
  published_count: number;
  published_duration_hours: number;
  publish_rate_pct: number;
}

export interface TeamMember {
  team_id: string;
  team_name: string;
  user_id: string;
  user_name: string;
  count: number;
  duration_hours: number;
}

export interface EntityTrend {
  [key: string]: string | number;
}

export interface RankedEntity {
  rank: number;
  [key: string]: string | number;
}

export interface TypeMixItem {
  output_type_id?: string;
  output_type?: string;
  input_type_id?: string;
  input_type?: string;
  count: number;
  duration_hours: number;
  share_pct: number;
}

export interface TypeTrendItem {
  output_type?: string;
  input_type?: string;
  period: string;
  count: number;
  duration_hours: number;
}

export interface TypeChannelMatrix {
  output_types: string[];
  rows: Record<string, unknown>[];
}

export interface LangDistItem {
  language_id: string;
  language: string;
  count: number;
  duration_hours: number;
  share_pct: number;
}

export interface LangChannelItem {
  channel: string;
  language: string;
  count: number;
  duration_hours: number;
}

export interface PlatformDistItem {
  platform_id: string;
  platform: string;
  count: number;
  duration_hours: number;
  share_pct: number;
}

export interface PlatformTypeItem {
  platform: string;
  output_type: string;
  count: number;
  duration_hours: number;
}

export interface DQFieldReport {
  field_name: string;
  total_records: number;
  missing_count: number;
  missing_pct: number;
  unknown_count: number;
  unknown_pct: number;
}

export interface DQErrorItem {
  error_type: string;
  count: number;
}

export interface DQErrorDetail {
  dq_log_id: string;
  error_type: string;
  input_video_id: string | number;
  headline?: string | null;
  source_name?: string | null;
  log_date?: string | null;
  channel_name?: string | null;
  client_name?: string | null;
  user_name?: string | null;
  team_name?: string | null;
}

export interface DQTrendPoint {
  period: string;
  error_type?: string;
  count?: number;
  error_count?: number;
}

export interface DQDimItem {
  channel_name: string;
  field_name: string;
  missing_pct: number;
}

export interface DQDuplicate {
  input_video_id: number | string;
  duplicate_count?: number;
  occurrences?: number;
}

export interface DQScore {
  overall_score: number;
  field_scores?: DQFieldReport[];
  error_type_distribution?: { error_type: string; count: number }[];
  total_errors: number;
  total_records?: number;
  total_field_issues?: number;
  breakdown?: Record<string, number>;
}

export interface DQPillar {
  pillar: string;
  score: number;
  status: string;
  issue_count: number;
  affected_records: number;
  affected_pct: number;
  description?: string | null;
}

export interface DQIncident {
  issue_key: string;
  title: string;
  category: string;
  severity: string;
  priority_score: number;
  occurrences: number;
  affected_records: number;
  affected_pct: number;
  trend_delta_pct?: number | null;
  blast_radius: string;
  recommended_action?: string | null;
}

export interface DQHotspot {
  dimension: string;
  dimension_value: string;
  total_records: number;
  affected_records: number;
  affected_pct: number;
  error_events: number;
  incident_index: number;
  primary_issue: string;
}

export interface DQScoreTrend {
  period: string;
  quality_score: number;
  error_events: number;
  affected_records: number;
  missing_issues: number;
}

export interface DQStorySummary {
  headline: string;
  verdict: string;
  overall_score: number;
  total_records: number;
  affected_records: number;
  affected_pct: number;
  total_errors: number;
  duplicate_clusters: number;
  total_field_issues: number;
  strongest_pillar?: string | null;
  weakest_pillar?: string | null;
  momentum_label: string;
  priority_focus?: string | null;
}

export interface DQStory {
  summary: DQStorySummary;
  pillars: DQPillar[];
  incidents: DQIncident[];
  hotspots: DQHotspot[];
  score_trend: DQScoreTrend[];
  field_reports: DQFieldReport[];
  error_type_distribution: { error_type: string; count: number; affected_records?: number }[];
}

export interface VideoDetail {
  input_video_id: number;
  headline: string;
  source_name?: string;
  source_url?: string;
  channel_name?: string;
  client_name?: string;
  user_name?: string;
  team_name?: string;
  language?: string;
  input_type?: string;
  output_type?: string;
  uploaded_duration_seconds?: number;
  upload_date?: string;
  output_video_id?: string;
  output_headline?: string;
  created_duration_seconds?: number;
  create_date?: string;
  is_published: boolean;
  published_platform?: string;
  published_url?: string;
  published_date?: string;
  published_duration_seconds?: number;
  is_billable?: boolean;
}

export interface PaginatedVideos {
  items: VideoDetail[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface BulkStats {
  total_videos: number;
  total_duration_hours: number;
  published_count: number;
  publish_rate_pct: number;
}

export interface RankedItem {
  rank: number;
  id: string;
  label: string;
  count: number;
  duration_hours: number;
}

export interface MoversData {
  gainers: MoverItem[];
  losers: MoverItem[];
}

export interface MoverItem {
  channel_id: number;
  channel_name: string;
  current_count: number;
  previous_count: number;
  delta: number;
  pct_change: number | null;
}

export interface AnomalyAlert {
  metric: string;
  dimension?: string;
  dimension_value?: string;
  current_value: number;
  expected_value: number;
  deviation_pct: number;
  severity: string;
  message: string;
}

export interface DropOffAlert {
  day: string;
  current_count: number;
  previous_count: number;
  change_pct: number;
  severity: string;
  message: string;
}

export interface ChannelAnomalyItem {
  channel_id: number;
  channel_name: string;
  uploaded: number;
  published: number;
  publish_rate_pct: number;
  avg_rate_pct: number;
  severity: string;
  message: string;
}

export interface BenchmarkResult {
  segment: KPISummary;
  overall: KPISummary;
  delta_vs_overall: Record<string, unknown>;
  pct_vs_overall: Record<string, unknown>;
}

/* ── Operational KPI types ────────────────────────────── */

export interface OperationalKPIs {
  active_clients: number;
  total_clients: number;
  active_users: number;
  total_users: number;
  active_channels: number;
  total_channels: number;
  clip_multiplication_rate: number;
  duration_compression_ratio: number;
  avg_input_duration_seconds: number;
  avg_output_duration_seconds: number;
  billable_rate_pct: number;
  input_to_output_conversion_pct: number;
  avg_days_upload_to_process: number;
  avg_days_process_to_publish: number;
  avg_days_upload_to_publish: number;
  multi_platform_reach: number;
  unique_platforms_used: number;
  unique_languages_used: number;
  data_completeness_pct: number;
  publishing_dropout_pct: number;
  translation_rate_pct: number;
  translation_duration_uplift: number;
  weekend_publish_rate_pct: number;
  content_reuse_ratio: number;
  full_repurposing_rate_pct: number;
  mixed_language_fragment_rate: number;
  avg_languages_per_channel: number;
  avg_platforms_per_client: number;
  fully_saturated_clients: number;
  total_platforms_available: number;
  avg_monthly_published_clips_per_channel: number;
  best_channel_monthly_clips: number;
  worst_channel_monthly_clips: number;
  channel_monthly_throughput_stddev: number;
  avg_monthly_published_clips_per_client: number;
  best_client_monthly_clips: number;
  best_client_name?: string;
  worst_client_monthly_clips: number;
  worst_client_name?: string;
  user_upload_retention_rate_pct: number;
  single_month_user_pct: number;
  rarely_active_user_cmr_paradox: number;
  rarely_active_clips_per_upload: number;
  active_user_clips_per_upload: number;
}

export interface CategoryPerformance {
  category_id: string;
  category_name: string;
  total_uploads: number;
  total_outputs: number;
  total_published: number;
  total_duration_hours: number;
  output_duration_hours: number;
  publish_rate_pct: number;
  billable_count: number;
  billable_rate_pct: number;
  clip_multiplication_rate: number;
}

export interface UserProductivityItem {
  user_id: string;
  user_name: string;
  team_name: string;
  uploads: number;
  outputs: number;
  published: number;
  clips_per_upload: number;
  publish_rate_pct: number;
  total_input_hours: number;
  total_output_hours: number;
  productivity_score: number;
}

export interface TeamEfficiencyItem {
  team_id: string;
  team_name: string;
  member_count: number;
  uploads: number;
  outputs: number;
  published: number;
  uploads_per_member: number;
  clips_per_upload: number;
  publish_rate_pct: number;
  efficiency_score: number;
}

export interface PipelineVelocityPoint {
  period: string;
  avg_days_upload_to_process: number;
  avg_days_process_to_publish: number;
  avg_days_end_to_end: number;
  throughput_count: number;
}

export interface PlatformReachItem {
  entity_id: string;
  entity_name: string;
  total_published: number;
  platforms_used: number;
  platform_names: string[];
  reach_score: number;
}

export interface ScenarioSimulationRequest extends AnalyticsRequest {
  publish_rate_uplift_pct: number;
  process_to_publish_days_improvement: number;
  active_users_uplift_pct: number;
  billable_rate_uplift_pct: number;
}

export interface ControlTowerSummary {
  overall_health_score: number;
  tracked_channels: number;
  tracked_clients: number;
  avg_publish_rate_pct: number;
  avg_velocity_days: number;
  avg_data_quality_score: number;
  recoverable_published_hours: number;
  recoverable_billable_hours: number;
}

export interface HealthScoreItem {
  entity_id: string;
  entity_name: string;
  client_name: string;
  uploads: number;
  outputs: number;
  published: number;
  publish_rate_pct: number;
  billable_rate_pct: number;
  health_score: number;
  adoption_score: number;
  conversion_score: number;
  velocity_score: number;
  coverage_score: number;
  data_quality_score: number;
  lost_outputs: number;
  lost_hours: number;
  recoverable_billable_hours: number;
  avg_process_to_publish_days: number;
  primary_issue: string;
  recommended_action: string;
}

export interface DriverItem {
  dimension: string;
  dimension_id: string;
  dimension_label: string;
  outputs: number;
  published: number;
  gap_count: number;
  gap_hours: number;
  publish_rate_pct: number;
  share_of_gap_pct: number;
}

export interface OpportunityItem {
  entity_id: string;
  entity_name: string;
  client_name: string;
  recoverable_published_hours: number;
  recoverable_billable_hours: number;
  likely_impact_score: number;
  primary_issue: string;
  recommended_action: string;
}

export interface ActionCardItem {
  title: string;
  detail: string;
  severity: string;
  owner: string;
  metric: string;
  value: number;
}

export interface ControlTowerResponse {
  summary: ControlTowerSummary;
  health_scores: HealthScoreItem[];
  drivers: DriverItem[];
  opportunities: OpportunityItem[];
  action_cards: ActionCardItem[];
}

export interface ScenarioBaseline {
  processed_count: number;
  published_count: number;
  output_hours: number;
  published_hours: number;
  active_users: number;
  publish_rate_pct: number;
  billable_rate_pct: number;
  avg_process_to_publish_days: number;
}

export interface ScenarioProjection {
  projected_published_count: number;
  projected_published_hours: number;
  projected_billable_hours: number;
  projected_billable_rate_pct: number;
  projected_process_to_publish_days: number;
  net_new_published_outputs: number;
  net_new_published_hours: number;
}

export interface ScenarioSimulationResponse {
  baseline: ScenarioBaseline;
  inputs: Record<string, number>;
  projection: ScenarioProjection;
  assumptions: string[];
}

export interface LostValueSummary {
  processed_outputs: number;
  published_outputs: number;
  stalled_outputs: number;
  recoverable_hours: number;
  recoverable_billable_hours: number;
  current_publish_rate_pct: number;
  avg_process_to_publish_days: number;
}

export interface StageValue {
  stage: string;
  value: number;
}

export interface LostValueBreakdown {
  dimension: string;
  dimension_id: string;
  dimension_label: string;
  outputs: number;
  published: number;
  output_hours: number;
  published_hours: number;
  gap_count: number;
  gap_hours: number;
  publish_rate_pct: number;
}

export interface LostValueResponse {
  summary: LostValueSummary;
  waterfall: StageValue[];
  by_client: LostValueBreakdown[];
  by_output_type: LostValueBreakdown[];
  by_channel: LostValueBreakdown[];
}

export interface PeerNode {
  entity_id: string;
  entity_name: string;
  client_name: string;
  cluster: string;
  health_score: number;
  outputs: number;
  published: number;
  publish_rate_pct: number;
  avg_process_to_publish_days: number;
  lost_hours: number;
}

export interface PeerEdge {
  source: string;
  target: string;
  similarity_pct: number;
}

export interface PeerPlaybook {
  entity_id: string;
  entity_name: string;
  peer_id: string;
  peer_name: string;
  similarity_pct: number;
  performance_gap: number;
  playbook: string;
}

export interface PeerCluster {
  cluster: string;
  count: number;
}

export interface PeerDNAResponse {
  nodes: PeerNode[];
  edges: PeerEdge[];
  playbooks: PeerPlaybook[];
  clusters: PeerCluster[];
}

export interface CustomKpiExecutionResult {
  id?: string | number;
  name?: string;
  description?: string | null;
  query?: string;
  input_mode?: CustomKpiInputMode;
  sql?: string | null;
  answer_nl?: string | null;
  columns?: string[];
  df_records?: Record<string, unknown>[];
  value?: string | number | boolean | null;
  result_type?: 'table' | 'value' | string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SavedCustomKpi extends CustomKpiExecutionResult {
  id: string | number;
  name: string;
  query: string;
  input_mode: CustomKpiInputMode;
}

export interface NlpPipelineResult {
  question?: string;
  response_type?: 'query' | 'information';
  route?: 'SQL' | 'KPI';
  route_reason?: string;
  answer_nl?: string | null;
  sql?: string | null;
  columns?: string[];
  df_records?: Record<string, unknown>[];
  kpi_matches?: { name: string; definition: string }[];
  plan?: Record<string, unknown> | null;
  plan_ms?: number | null;
  retrieved_examples?: Record<string, unknown>[];
  attempts?: Record<string, unknown>[];
  filters?: string[];
  verification?: Record<string, unknown> | null;
  sanity?: Record<string, unknown> | null;
  error?: string | null;
}
