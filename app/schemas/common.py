"""Shared Pydantic schemas — filters, pagination, API wrappers."""

from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Any, Optional
from datetime import date
from enum import Enum


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class Granularity(str, Enum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    quarterly = "quarterly"
    yearly = "yearly"


class MetricType(str, Enum):
    count = "count"
    duration = "duration"
    both = "both"


class SortOrder(str, Enum):
    asc = "asc"
    desc = "desc"


class DimensionEnum(str, Enum):
    channel = "channel"
    client = "client"
    user = "user"
    team = "team"
    language = "language"
    input_type = "input_type"
    output_type = "output_type"
    platform = "platform"
    published_status = "published_status"


# ──────────────────────────────────────────────
# Filter schemas
# ──────────────────────────────────────────────

class DateRangeFilter(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class ComparisonDateRange(BaseModel):
    current: DateRangeFilter = Field(default_factory=DateRangeFilter)
    previous: Optional[DateRangeFilter] = None


class DimensionFilter(BaseModel):
    """Generic filter: pass IDs for any dimension to narrow results."""
    client_ids: Optional[list[str]] = None
    channel_ids: Optional[list[str]] = None
    user_ids: Optional[list[str]] = None
    team_ids: Optional[list[str]] = None
    language_ids: Optional[list[str]] = None
    input_type_ids: Optional[list[str]] = None
    output_type_ids: Optional[list[str]] = None
    platform_ids: Optional[list[str]] = None
    is_billable: Optional[bool] = None


class PaginationParams(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=500)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


# ──────────────────────────────────────────────
# Request helpers
# ──────────────────────────────────────────────

class AnalyticsRequest(BaseModel):
    """Base request body reused by most analytics endpoints."""
    date_range: DateRangeFilter = Field(default_factory=DateRangeFilter)
    filters: DimensionFilter = Field(default_factory=DimensionFilter)


class MultiDimensionRequest(AnalyticsRequest):
    dimension1: DimensionEnum
    dimension2: Optional[DimensionEnum] = None
    metric: MetricType = MetricType.both


class TrendRequest(AnalyticsRequest):
    granularity: Granularity = Granularity.daily
    metric: MetricType = MetricType.both


class ComparisonRequest(BaseModel):
    date_range: ComparisonDateRange = Field(default_factory=ComparisonDateRange)
    filters: DimensionFilter = Field(default_factory=DimensionFilter)


class TopNRequest(AnalyticsRequest):
    dimension: DimensionEnum = DimensionEnum.channel
    metric: MetricType = MetricType.count
    n: int = Field(default=10, ge=1, le=100)
    sort: SortOrder = SortOrder.desc


class VideoSearchRequest(AnalyticsRequest):
    search_query: Optional[str] = None
    published_only: Optional[bool] = None
    pagination: PaginationParams = Field(default_factory=PaginationParams)
    sort_by: Optional[str] = None
    sort_order: SortOrder = SortOrder.desc


class ScenarioSimulationRequest(AnalyticsRequest):
    publish_rate_uplift_pct: float = Field(default=12.0, ge=0, le=100)
    process_to_publish_days_improvement: float = Field(default=1.0, ge=0, le=30)
    active_users_uplift_pct: float = Field(default=5.0, ge=0, le=100)
    billable_rate_uplift_pct: float = Field(default=3.0, ge=0, le=100)


# ──────────────────────────────────────────────
# Response helpers
# ──────────────────────────────────────────────

class ApiResponse(BaseModel):
    success: bool = True
    data: Any = None
    meta: Optional[dict[str, Any]] = None
    message: Optional[str] = None


class PaginatedResponse(BaseModel):
    items: list[Any]
    total: int
    page: int
    page_size: int
    total_pages: int


class KPIValue(BaseModel):
    count: int = 0
    duration_seconds: int = 0
    duration_hours: float = 0.0


class KPIWithPublished(BaseModel):
    total: KPIValue = Field(default_factory=KPIValue)
    published: KPIValue = Field(default_factory=KPIValue)
    publish_rate_pct: float = 0.0


class KPISummaryResponse(BaseModel):
    uploaded: KPIWithPublished = Field(default_factory=KPIWithPublished)
    processed: KPIWithPublished = Field(default_factory=KPIWithPublished)
    published: KPIValue = Field(default_factory=KPIValue)


class KPIComparisonResponse(BaseModel):
    current: KPISummaryResponse
    previous: Optional[KPISummaryResponse] = None
    delta: Optional[dict[str, Any]] = None
    pct_change: Optional[dict[str, Any]] = None


class OutputTypeCard(BaseModel):
    output_type_id: str
    output_type: str
    total_count: int = 0
    total_duration_hours: float = 0.0
    published_count: int = 0
    published_duration_hours: float = 0.0
    publish_rate_pct: float = 0.0


class TrendPoint(BaseModel):
    period: str
    count: int = 0
    duration_hours: float = 0.0


class DimensionBreakdownItem(BaseModel):
    dimension_id: str
    dimension_label: str
    count: int = 0
    duration_hours: float = 0.0
    published_count: int = 0
    published_duration_hours: float = 0.0
    publish_rate_pct: float = 0.0


class CrossDimensionCell(BaseModel):
    dim1_id: str
    dim1_label: str
    dim2_id: str
    dim2_label: str
    count: int = 0
    duration_hours: float = 0.0


class FunnelStage(BaseModel):
    stage: str
    count: int = 0
    duration_hours: float = 0.0
    drop_off_pct: Optional[float] = None


class FunnelDimensionItem(BaseModel):
    dimension_id: str
    dimension_label: str
    uploaded_count: int = 0
    processed_count: int = 0
    published_count: int = 0
    upload_to_process_pct: float = 0.0
    process_to_publish_pct: float = 0.0


class DataQualityFieldReport(BaseModel):
    field_name: str
    total_records: int = 0
    missing_count: int = 0
    missing_pct: float = 0.0
    unknown_count: int = 0
    unknown_pct: float = 0.0


class DataQualityScore(BaseModel):
    overall_score: float = 0.0
    field_scores: list[DataQualityFieldReport] = []
    error_type_distribution: list[dict[str, Any]] = []
    total_errors: int = 0


class DataQualityPillar(BaseModel):
    pillar: str
    score: float = 0.0
    status: str = "watch"
    issue_count: int = 0
    affected_records: int = 0
    affected_pct: float = 0.0
    description: Optional[str] = None


class DataQualityTrendPoint(BaseModel):
    period: str
    quality_score: float = 0.0
    error_events: int = 0
    affected_records: int = 0
    missing_issues: int = 0


class DataQualityHotspot(BaseModel):
    dimension: str
    dimension_value: str
    total_records: int = 0
    affected_records: int = 0
    affected_pct: float = 0.0
    error_events: int = 0
    incident_index: float = 0.0
    primary_issue: str = "No major issue"


class DataQualityIncident(BaseModel):
    issue_key: str
    title: str
    category: str
    severity: str
    priority_score: float = 0.0
    occurrences: int = 0
    affected_records: int = 0
    affected_pct: float = 0.0
    trend_delta_pct: Optional[float] = None
    blast_radius: str = "localized"
    recommended_action: Optional[str] = None


class DataQualityStorySummary(BaseModel):
    headline: str
    verdict: str
    overall_score: float = 0.0
    total_records: int = 0
    affected_records: int = 0
    affected_pct: float = 0.0
    total_errors: int = 0
    duplicate_clusters: int = 0
    total_field_issues: int = 0
    strongest_pillar: Optional[str] = None
    weakest_pillar: Optional[str] = None
    momentum_label: str = "stable"
    priority_focus: Optional[str] = None


class DataQualityStoryResponse(BaseModel):
    summary: DataQualityStorySummary
    pillars: list[DataQualityPillar] = []
    incidents: list[DataQualityIncident] = []
    hotspots: list[DataQualityHotspot] = []
    score_trend: list[DataQualityTrendPoint] = []
    field_reports: list[DataQualityFieldReport] = []
    error_type_distribution: list[dict[str, Any]] = []


class DataQualityErrorDetailRequest(AnalyticsRequest):
    error_type: str = Field(min_length=1, max_length=255)


class DataQualityErrorDetail(BaseModel):
    dq_log_id: str
    error_type: str
    input_video_id: str
    headline: Optional[str] = None
    source_name: Optional[str] = None
    log_date: Optional[date] = None
    channel_name: Optional[str] = None
    client_name: Optional[str] = None
    user_name: Optional[str] = None
    team_name: Optional[str] = None


class VideoDetailItem(BaseModel):
    input_video_id: str
    headline: str
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    channel_name: Optional[str] = None
    client_name: Optional[str] = None
    user_name: Optional[str] = None
    team_name: Optional[str] = None
    language: Optional[str] = None
    input_type: Optional[str] = None
    output_type: Optional[str] = None
    uploaded_duration_seconds: Optional[int] = None
    upload_date: Optional[date] = None
    output_video_id: Optional[str] = None
    output_headline: Optional[str] = None
    created_duration_seconds: Optional[int] = None
    create_date: Optional[date] = None
    is_published: bool = False
    published_platform: Optional[str] = None
    published_url: Optional[str] = None
    published_date: Optional[date] = None
    published_duration_seconds: Optional[int] = None
    is_billable: Optional[bool] = None


class AnomalyAlert(BaseModel):
    metric: str
    dimension: Optional[str] = None
    dimension_value: Optional[str] = None
    current_value: float
    expected_value: float
    deviation_pct: float
    severity: str  # "low", "medium", "high"
    message: str


# ──────────────────────────────────────────────
# Operational KPI schemas
# ──────────────────────────────────────────────

class OperationalKPIs(BaseModel):
    active_clients: int = 0
    total_clients: int = 0
    active_users: int = 0
    total_users: int = 0
    active_channels: int = 0
    total_channels: int = 0
    clip_multiplication_rate: float = 0.0
    duration_compression_ratio: float = 0.0
    avg_input_duration_seconds: float = 0.0
    avg_output_duration_seconds: float = 0.0
    billable_rate_pct: float = 0.0
    input_to_output_conversion_pct: float = 0.0
    avg_days_upload_to_process: float = 0.0
    avg_days_process_to_publish: float = 0.0
    avg_days_upload_to_publish: float = 0.0
    multi_platform_reach: float = 0.0
    unique_platforms_used: int = 0
    unique_languages_used: int = 0
    data_completeness_pct: float = 0.0
    publishing_dropout_pct: float = 0.0
    translation_rate_pct: float = 0.0
    translation_duration_uplift: float = 0.0
    weekend_publish_rate_pct: float = 0.0
    content_reuse_ratio: float = 0.0
    full_repurposing_rate_pct: float = 0.0
    mixed_language_fragment_rate: float = 0.0
    avg_languages_per_channel: float = 0.0
    avg_platforms_per_client: float = 0.0
    fully_saturated_clients: int = 0
    total_platforms_available: int = 0
    avg_monthly_published_clips_per_channel: float = 0.0
    best_channel_monthly_clips: float = 0.0
    worst_channel_monthly_clips: float = 0.0
    channel_monthly_throughput_stddev: float = 0.0
    avg_monthly_published_clips_per_client: float = 0.0
    best_client_monthly_clips: float = 0.0
    best_client_name: Optional[str] = None
    worst_client_monthly_clips: float = 0.0
    worst_client_name: Optional[str] = None
    user_upload_retention_rate_pct: float = 0.0
    single_month_user_pct: float = 0.0
    rarely_active_user_cmr_paradox: float = 0.0
    rarely_active_clips_per_upload: float = 0.0
    active_user_clips_per_upload: float = 0.0


class CategoryPerformance(BaseModel):
    category_id: str
    category_name: str
    total_uploads: int = 0
    total_outputs: int = 0
    total_published: int = 0
    total_duration_hours: float = 0.0
    output_duration_hours: float = 0.0
    publish_rate_pct: float = 0.0
    billable_count: int = 0
    billable_rate_pct: float = 0.0
    clip_multiplication_rate: float = 0.0


class UserProductivity(BaseModel):
    user_id: str
    user_name: str
    team_name: str
    uploads: int = 0
    outputs: int = 0
    published: int = 0
    clips_per_upload: float = 0.0
    publish_rate_pct: float = 0.0
    total_input_hours: float = 0.0
    total_output_hours: float = 0.0
    productivity_score: float = 0.0


class TeamEfficiency(BaseModel):
    team_id: str
    team_name: str
    member_count: int = 0
    uploads: int = 0
    outputs: int = 0
    published: int = 0
    uploads_per_member: float = 0.0
    clips_per_upload: float = 0.0
    publish_rate_pct: float = 0.0
    efficiency_score: float = 0.0


class PipelineVelocityPoint(BaseModel):
    period: str
    avg_days_upload_to_process: float = 0.0
    avg_days_process_to_publish: float = 0.0
    avg_days_end_to_end: float = 0.0
    throughput_count: int = 0


class PlatformReachItem(BaseModel):
    entity_id: str
    entity_name: str
    total_published: int = 0
    platforms_used: int = 0
    platform_names: list[str] = []
    reach_score: float = 0.0
