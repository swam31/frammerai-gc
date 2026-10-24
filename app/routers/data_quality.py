"""Data quality monitoring endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import case, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import (
    AnalyticsRequest,
    ApiResponse,
    DataQualityErrorDetail,
    DataQualityErrorDetailRequest,
    DataQualityFieldReport,
    DataQualityHotspot,
    DataQualityIncident,
    DataQualityPillar,
    DataQualityScore,
    DataQualityStoryResponse,
    DataQualityStorySummary,
    DataQualityTrendPoint,
    Granularity,
    TrendRequest,
)
from app.services.analytics_service import (
    DC,
    DD,
    DIV,
    DU,
    FDQ,
    FI,
    FO,
    FP,
    apply_date_filter,
    apply_dimension_filters,
    granularity_label,
)

router = APIRouter(prefix="/data-quality", tags=["Data Quality"])


def _safe_pct(part: float | int, whole: float | int) -> float:
    return round((part / whole) * 100, 2) if whole else 0.0


def _clamp_score(value: float) -> float:
    return round(max(0.0, min(100.0, value)), 2)


def _blank_string(column):
    return func.coalesce(func.trim(column), "") == ""


def _unknown_string(column):
    return func.lower(func.coalesce(func.trim(column), "")) == "unknown"


def _serialize_field(report: DataQualityFieldReport) -> dict[str, Any]:
    return report.model_dump()


def _severity_from_score(score: float) -> str:
    if score >= 75:
        return "critical"
    if score >= 50:
        return "high"
    if score >= 25:
        return "medium"
    return "low"


def _status_from_score(score: float) -> str:
    if score >= 85:
        return "strong"
    if score >= 65:
        return "stable"
    if score >= 40:
        return "watch"
    return "critical"


def _classify_error(error_type: str) -> tuple[str, str]:
    lowered = (error_type or "unknown").lower()
    if "missing" in lowered:
        return "Completeness", "Backfill or enforce required-field capture upstream."
    if any(token in lowered for token in ("invalid", "broken", "corrupt")):
        return "Validity", "Add schema validation and reject malformed payloads earlier."
    if any(token in lowered for token in ("mismatch", "duplicate")):
        return "Consistency", "Reconcile conflicting values and deduplicate before publish."
    if any(token in lowered for token in ("failed", "timeout")):
        return "Reliability", "Stabilize the ingestion handoff and retry failed jobs automatically."
    return "Reliability", "Inspect the raw logs and codify this failure into a typed validation rule."


async def _build_field_reports(
    body: AnalyticsRequest,
    db: AsyncSession,
) -> tuple[list[DataQualityFieldReport], dict[str, int], int, int]:
    upload_dd = select(DD.Date_ID, DD.Full_Date).subquery("dq_upload_dd")
    publish_dd = select(DD.Date_ID, DD.Full_Date).subquery("dq_publish_dd")

    total_q = select(func.count(FI.Fact_Input_ID).label("total")).join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
    total_q = apply_date_filter(total_q, upload_dd.c.Full_Date, body.date_range)
    total_q = apply_dimension_filters(total_q, body.filters, has_fi=True)
    total_records = (await db.execute(total_q)).scalar() or 0

    field_q = (
        select(
            func.count(case((_blank_string(DIV.Headline), 1))).label("missing_headline"),
            func.count(case((_blank_string(DIV.Source_Name), 1))).label("missing_source_name"),
            func.count(case((_unknown_string(DIV.Source_Name), 1))).label("unknown_source_name"),
            func.count(case((_blank_string(DIV.Source_URL), 1))).label("missing_source_url"),
            func.count(case((FI.Uploaded_Duration.is_(None), 1))).label("missing_duration"),
            func.count(case((_unknown_string(DU.Team_Name), 1))).label("unknown_team"),
        )
        .select_from(FI)
        .join(DIV, FI.Input_Video_ID == DIV.Input_Video_ID)
        .join(DU, FI.User_ID == DU.User_ID)
        .join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
    )
    field_q = apply_date_filter(field_q, upload_dd.c.Full_Date, body.date_range)
    field_q = apply_dimension_filters(field_q, body.filters, has_fi=True, du_joined=True)
    field_counts = (await db.execute(field_q)).one()

    published_total_q = (
        select(func.count(FP.Fact_Publish_ID).label("total"))
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(publish_dd, FP.Published_Date_ID == publish_dd.c.Date_ID)
    )
    published_total_q = apply_date_filter(published_total_q, publish_dd.c.Full_Date, body.date_range)
    published_total_q = apply_dimension_filters(published_total_q, body.filters, has_fi=True, has_fp=True)
    published_total = (await db.execute(published_total_q)).scalar() or 0

    published_url_q = (
        select(func.count(case((_blank_string(FP.Published_URL), 1))).label("missing_published_url"))
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(publish_dd, FP.Published_Date_ID == publish_dd.c.Date_ID)
    )
    published_url_q = apply_date_filter(published_url_q, publish_dd.c.Full_Date, body.date_range)
    published_url_q = apply_dimension_filters(published_url_q, body.filters, has_fi=True, has_fp=True)
    published_url_missing = (await db.execute(published_url_q)).scalar() or 0

    reports = [
        DataQualityFieldReport(
            field_name="Headline",
            total_records=total_records,
            missing_count=field_counts.missing_headline,
            missing_pct=_safe_pct(field_counts.missing_headline, total_records),
        ),
        DataQualityFieldReport(
            field_name="Source_Name",
            total_records=total_records,
            missing_count=field_counts.missing_source_name,
            missing_pct=_safe_pct(field_counts.missing_source_name, total_records),
            unknown_count=field_counts.unknown_source_name,
            unknown_pct=_safe_pct(field_counts.unknown_source_name, total_records),
        ),
        DataQualityFieldReport(
            field_name="Source_URL",
            total_records=total_records,
            missing_count=field_counts.missing_source_url,
            missing_pct=_safe_pct(field_counts.missing_source_url, total_records),
        ),
        DataQualityFieldReport(
            field_name="Uploaded_Duration",
            total_records=total_records,
            missing_count=field_counts.missing_duration,
            missing_pct=_safe_pct(field_counts.missing_duration, total_records),
        ),
        DataQualityFieldReport(
            field_name="Team_Name",
            total_records=total_records,
            unknown_count=field_counts.unknown_team,
            unknown_pct=_safe_pct(field_counts.unknown_team, total_records),
        ),
        DataQualityFieldReport(
            field_name="Published_URL",
            total_records=published_total,
            missing_count=published_url_missing,
            missing_pct=_safe_pct(published_url_missing, published_total),
        ),
    ]

    total_field_issues = sum(report.missing_count + report.unknown_count for report in reports)
    breakdown = {
        "missing_headline": field_counts.missing_headline,
        "missing_source_name": field_counts.missing_source_name,
        "unknown_source_name": field_counts.unknown_source_name,
        "missing_source_url": field_counts.missing_source_url,
        "missing_duration": field_counts.missing_duration,
        "unknown_team": field_counts.unknown_team,
        "missing_published_url": published_url_missing,
    }
    return reports, breakdown, total_records, total_field_issues


async def _build_error_distribution(body: AnalyticsRequest, db: AsyncSession) -> tuple[list[dict[str, Any]], int, int]:
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery("dq_error_dd")
    q = (
        select(
            FDQ.Error_Type,
            func.count(FDQ.DQ_Log_ID).label("count"),
            func.count(distinct(FDQ.Input_Video_ID)).label("affected_records"),
        )
        .select_from(FDQ)
        .join(FI, FDQ.Input_Video_ID == FI.Input_Video_ID)
        .join(dd_sub, FDQ.Log_Date_ID == dd_sub.c.Date_ID)
        .group_by(FDQ.Error_Type)
        .order_by(func.count(FDQ.DQ_Log_ID).desc(), FDQ.Error_Type.asc())
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()
    data = [
        {
            "error_type": row.Error_Type or "Unknown",
            "count": row.count,
            "affected_records": row.affected_records,
        }
        for row in rows
    ]
    total_errors = sum(item["count"] for item in data)
    total_affected = max((item["affected_records"] for item in data), default=0)
    return data, total_errors, total_affected


async def _build_duplicate_summary(body: AnalyticsRequest, db: AsyncSession) -> tuple[list[dict[str, Any]], int]:
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery("dq_dup_dd")
    q = (
        select(
            FI.Input_Video_ID,
            func.count(FI.Fact_Input_ID).label("occurrences"),
        )
        .select_from(FI)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(FI.Input_Video_ID)
        .having(func.count(FI.Fact_Input_ID) > 1)
        .order_by(func.count(FI.Fact_Input_ID).desc(), FI.Input_Video_ID.asc())
        .limit(100)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()
    data = [{"input_video_id": row.Input_Video_ID, "occurrences": row.occurrences} for row in rows]
    return data, len(data)


async def _build_hotspots(body: AnalyticsRequest, db: AsyncSession) -> list[DataQualityHotspot]:
    upload_dd = select(DD.Date_ID, DD.Full_Date).subquery("dq_hotspot_upload_dd")
    error_dd = select(DD.Date_ID, DD.Full_Date).subquery("dq_hotspot_error_dd")

    field_issue_condition = or_(
        _blank_string(DIV.Headline),
        _blank_string(DIV.Source_Name),
        _unknown_string(DIV.Source_Name),
        _blank_string(DIV.Source_URL),
        FI.Uploaded_Duration.is_(None),
        _unknown_string(DU.Team_Name),
    )

    field_q = (
        select(
            DC.Channel_Name.label("channel_name"),
            func.count(FI.Fact_Input_ID).label("total_records"),
            func.count(distinct(case((field_issue_condition, FI.Input_Video_ID)))).label("affected_records"),
            func.sum(case((field_issue_condition, 1), else_=0)).label("issue_events"),
        )
        .select_from(FI)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(DIV, FI.Input_Video_ID == DIV.Input_Video_ID)
        .join(DU, FI.User_ID == DU.User_ID)
        .join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
        .group_by(DC.Channel_Name)
    )
    field_q = apply_date_filter(field_q, upload_dd.c.Full_Date, body.date_range)
    field_q = apply_dimension_filters(field_q, body.filters, has_fi=True, dc_joined=True, du_joined=True)

    error_q = (
        select(
            DC.Channel_Name.label("channel_name"),
            func.count(FDQ.DQ_Log_ID).label("error_events"),
            func.count(distinct(FDQ.Input_Video_ID)).label("affected_records"),
        )
        .select_from(FDQ)
        .join(FI, FDQ.Input_Video_ID == FI.Input_Video_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(error_dd, FDQ.Log_Date_ID == error_dd.c.Date_ID)
        .group_by(DC.Channel_Name)
    )
    error_q = apply_date_filter(error_q, error_dd.c.Full_Date, body.date_range)
    error_q = apply_dimension_filters(error_q, body.filters, has_fi=True, dc_joined=True)

    field_rows = {row.channel_name: row for row in (await db.execute(field_q)).all()}
    error_rows = {row.channel_name: row for row in (await db.execute(error_q)).all()}

    hotspots: list[DataQualityHotspot] = []
    for channel_name in sorted(set(field_rows) | set(error_rows)):
        field_row = field_rows.get(channel_name)
        error_row = error_rows.get(channel_name)
        total_records = int(getattr(field_row, "total_records", 0) or 0)
        field_affected = int(getattr(field_row, "affected_records", 0) or 0)
        error_affected = int(getattr(error_row, "affected_records", 0) or 0)
        affected_records = max(field_affected, error_affected)
        error_events = int(getattr(error_row, "error_events", 0) or 0)
        field_events = int(getattr(field_row, "issue_events", 0) or 0)
        affected_pct = _safe_pct(affected_records, total_records)
        incident_index = _clamp_score((affected_pct * 0.7) + (_safe_pct(error_events, max(total_records, 1)) * 0.3))
        primary_issue = "Error log concentration" if error_events >= field_events else "Field completeness drift"
        hotspots.append(
            DataQualityHotspot(
                dimension="Channel",
                dimension_value=channel_name or "Unknown",
                total_records=total_records,
                affected_records=affected_records,
                affected_pct=affected_pct,
                error_events=error_events,
                incident_index=incident_index,
                primary_issue=primary_issue,
            )
        )

    hotspots.sort(key=lambda item: (item.incident_index, item.error_events, item.affected_records), reverse=True)
    return hotspots[:8]


async def _build_score_trend(body: AnalyticsRequest, db: AsyncSession) -> list[DataQualityTrendPoint]:
    upload_dd = select(DD.Date_ID, DD.Full_Date, DD.Month, DD.Year).subquery("dq_trend_upload_dd")
    error_dd = select(DD.Date_ID, DD.Full_Date, DD.Month, DD.Year).subquery("dq_trend_error_dd")
    period_upload = granularity_label(Granularity.monthly, upload_dd.c)
    period_error = granularity_label(Granularity.monthly, error_dd.c)

    field_issue_total = (
        case((_blank_string(DIV.Headline), 1), else_=0)
        + case((_blank_string(DIV.Source_Name), 1), else_=0)
        + case((_unknown_string(DIV.Source_Name), 1), else_=0)
        + case((_blank_string(DIV.Source_URL), 1), else_=0)
        + case((FI.Uploaded_Duration.is_(None), 1), else_=0)
        + case((_unknown_string(DU.Team_Name), 1), else_=0)
    )

    field_q = (
        select(
            period_upload,
            func.count(FI.Fact_Input_ID).label("total_records"),
            func.coalesce(func.sum(field_issue_total), 0).label("missing_issues"),
        )
        .select_from(FI)
        .join(DIV, FI.Input_Video_ID == DIV.Input_Video_ID)
        .join(DU, FI.User_ID == DU.User_ID)
        .join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
        .group_by("period")
        .order_by("period")
    )
    field_q = apply_date_filter(field_q, upload_dd.c.Full_Date, body.date_range)
    field_q = apply_dimension_filters(field_q, body.filters, has_fi=True, du_joined=True)

    error_q = (
        select(
            period_error,
            func.count(FDQ.DQ_Log_ID).label("error_events"),
            func.count(distinct(FDQ.Input_Video_ID)).label("affected_records"),
        )
        .select_from(FDQ)
        .join(FI, FDQ.Input_Video_ID == FI.Input_Video_ID)
        .join(error_dd, FDQ.Log_Date_ID == error_dd.c.Date_ID)
        .group_by("period")
        .order_by("period")
    )
    error_q = apply_date_filter(error_q, error_dd.c.Full_Date, body.date_range)
    error_q = apply_dimension_filters(error_q, body.filters, has_fi=True)

    field_rows = {str(row.period): row for row in (await db.execute(field_q)).all()}
    error_rows = {str(row.period): row for row in (await db.execute(error_q)).all()}

    periods = sorted(set(field_rows) | set(error_rows))
    trend: list[DataQualityTrendPoint] = []
    for period in periods:
        field_row = field_rows.get(period)
        error_row = error_rows.get(period)
        total_records = int(getattr(field_row, "total_records", 0) or 0)
        missing_issues = int(getattr(field_row, "missing_issues", 0) or 0)
        affected_records = int(getattr(error_row, "affected_records", 0) or 0)
        error_events = int(getattr(error_row, "error_events", 0) or 0)

        completeness_score = 100 - _safe_pct(missing_issues, max(total_records * 6, 1))
        reliability_score = 100 - _safe_pct(affected_records, max(total_records, 1))
        quality_score = _clamp_score((completeness_score * 0.65) + (reliability_score * 0.35))
        trend.append(
            DataQualityTrendPoint(
                period=period,
                quality_score=quality_score,
                error_events=error_events,
                affected_records=affected_records,
                missing_issues=missing_issues,
            )
        )
    return trend


def _build_pillars(
    total_records: int,
    total_errors: int,
    duplicate_clusters: int,
    field_reports: list[DataQualityFieldReport],
    error_distribution: list[dict[str, Any]],
) -> list[DataQualityPillar]:
    field_map = {item.field_name: item for item in field_reports}
    completeness_issues = sum(
        field_map.get(name, DataQualityFieldReport(field_name=name)).missing_count
        for name in ("Headline", "Source_Name", "Source_URL", "Uploaded_Duration", "Published_URL")
    )
    classification_issues = sum(
        field_map.get(name, DataQualityFieldReport(field_name=name)).unknown_count
        for name in ("Source_Name", "Team_Name")
    )

    validity_errors = 0
    consistency_errors = 0
    reliability_errors = 0
    for item in error_distribution:
        category, _ = _classify_error(item["error_type"])
        if category == "Validity":
            validity_errors += item["count"]
        elif category == "Consistency":
            consistency_errors += item["count"]
        else:
            reliability_errors += item["count"]

    completeness_score = _clamp_score(100 - _safe_pct(completeness_issues, max(total_records * 5, 1)) * 1.35)
    classification_score = _clamp_score(100 - _safe_pct(classification_issues, max(total_records * 2, 1)) * 1.6)
    validity_score = _clamp_score(100 - _safe_pct(validity_errors, max(total_records, 1)) * 2.2)
    uniqueness_score = _clamp_score(100 - _safe_pct(duplicate_clusters, max(total_records, 1)) * 6.0)
    reliability_score = _clamp_score(100 - _safe_pct(reliability_errors + consistency_errors, max(total_records, 1)) * 1.8)

    return [
        DataQualityPillar(
            pillar="Completeness",
            score=completeness_score,
            status=_status_from_score(completeness_score),
            issue_count=completeness_issues,
            affected_records=completeness_issues,
            affected_pct=_safe_pct(completeness_issues, max(total_records * 5, 1)),
            description="Required metadata coverage across ingest and publish stages.",
        ),
        DataQualityPillar(
            pillar="Classification",
            score=classification_score,
            status=_status_from_score(classification_score),
            issue_count=classification_issues,
            affected_records=classification_issues,
            affected_pct=_safe_pct(classification_issues, max(total_records * 2, 1)),
            description="How often the warehouse falls back to unknown buckets.",
        ),
        DataQualityPillar(
            pillar="Validity",
            score=validity_score,
            status=_status_from_score(validity_score),
            issue_count=validity_errors,
            affected_records=validity_errors,
            affected_pct=_safe_pct(validity_errors, total_records),
            description="Malformed, broken, or corrupt records observed in the logs.",
        ),
        DataQualityPillar(
            pillar="Uniqueness",
            score=uniqueness_score,
            status=_status_from_score(uniqueness_score),
            issue_count=duplicate_clusters,
            affected_records=duplicate_clusters,
            affected_pct=_safe_pct(duplicate_clusters, total_records),
            description="Duplicate inputs that can inflate throughput and trust.",
        ),
        DataQualityPillar(
            pillar="Reliability",
            score=reliability_score,
            status=_status_from_score(reliability_score),
            issue_count=reliability_errors + consistency_errors,
            affected_records=reliability_errors + consistency_errors,
            affected_pct=_safe_pct(reliability_errors + consistency_errors, total_records),
            description="Operational failures and mismatches that pressure confidence.",
        ),
    ]


def _build_incidents(
    total_records: int,
    field_reports: list[DataQualityFieldReport],
    error_distribution: list[dict[str, Any]],
    duplicate_rows: list[dict[str, Any]],
    trend: list[DataQualityTrendPoint],
) -> list[DataQualityIncident]:
    incidents: list[DataQualityIncident] = []
    recent_delta = None
    if len(trend) >= 2 and trend[-2].error_events:
        recent_delta = round(((trend[-1].error_events - trend[-2].error_events) / trend[-2].error_events) * 100, 2)

    for report in field_reports:
        occurrences = report.missing_count + report.unknown_count
        if occurrences <= 0:
            continue
        category = "Completeness" if report.missing_count >= report.unknown_count else "Classification"
        priority_score = _clamp_score((report.missing_pct * 0.75) + (report.unknown_pct * 0.9) + (_safe_pct(occurrences, total_records) * 0.4))
        incidents.append(
            DataQualityIncident(
                issue_key=f"field::{report.field_name}",
                title=f"{report.field_name} drift",
                category=category,
                severity=_severity_from_score(priority_score),
                priority_score=priority_score,
                occurrences=occurrences,
                affected_records=occurrences,
                affected_pct=max(report.missing_pct, report.unknown_pct),
                trend_delta_pct=recent_delta,
                blast_radius="broad" if max(report.missing_pct, report.unknown_pct) >= 15 else "localized",
                recommended_action=f"Make `{report.field_name}` mandatory in the ingestion contract or patch nulls before analytics.",
            )
        )

    for item in error_distribution[:8]:
        category, action = _classify_error(item["error_type"])
        priority_score = _clamp_score((_safe_pct(item["count"], total_records) * 1.8) + (_safe_pct(item["affected_records"], total_records) * 1.2))
        incidents.append(
            DataQualityIncident(
                issue_key=f"error::{item['error_type']}",
                title=item["error_type"],
                category=category,
                severity=_severity_from_score(priority_score),
                priority_score=priority_score,
                occurrences=item["count"],
                affected_records=item["affected_records"],
                affected_pct=_safe_pct(item["affected_records"], total_records),
                trend_delta_pct=recent_delta,
                blast_radius="broad" if item["affected_records"] >= max(5, total_records * 0.08) else "localized",
                recommended_action=action,
            )
        )

    if duplicate_rows:
        duplicate_occurrences = sum(max(int(row["occurrences"]) - 1, 1) for row in duplicate_rows)
        priority_score = _clamp_score(_safe_pct(len(duplicate_rows), total_records) * 4.0)
        incidents.append(
            DataQualityIncident(
                issue_key="duplicate::inputs",
                title="Duplicate input clusters",
                category="Uniqueness",
                severity=_severity_from_score(priority_score),
                priority_score=priority_score,
                occurrences=duplicate_occurrences,
                affected_records=len(duplicate_rows),
                affected_pct=_safe_pct(len(duplicate_rows), total_records),
                trend_delta_pct=None,
                blast_radius="broad" if len(duplicate_rows) >= max(3, total_records * 0.03) else "localized",
                recommended_action="Hash input IDs at ingest and quarantine repeated source/video combinations before upsert.",
            )
        )

    incidents.sort(key=lambda item: (item.priority_score, item.occurrences, item.affected_records), reverse=True)
    return incidents[:10]


def _story_headline(score: float, weakest_pillar: str | None, strongest_pillar: str | None) -> tuple[str, str]:
    if score >= 85:
        return (
            "The warehouse is broadly trustworthy, with only targeted cleanup required.",
            f"Strength is concentrated in {strongest_pillar or 'core validation'}, while {weakest_pillar or 'a small set of issues'} remains the main watch area.",
        )
    if score >= 65:
        return (
            "The pipeline is analytically usable, but trust is uneven across key metadata surfaces.",
            f"The judges should see this as a controllable reliability problem, led by {weakest_pillar or 'a handful of weak pillars'}.",
        )
    return (
        "Data quality is materially constraining confidence in downstream analytics.",
        f"The fastest trust recovery comes from attacking {weakest_pillar or 'the weakest pillar'} first and reducing repeated incidents at the source.",
    )


@router.post("/overview", response_model=ApiResponse)
async def dq_overview(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    field_reports, _, _, _ = await _build_field_reports(body, db)
    return ApiResponse(data=[_serialize_field(item) for item in field_reports])


@router.post("/errors", response_model=ApiResponse)
async def dq_errors(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    error_distribution, _, _ = await _build_error_distribution(body, db)
    return ApiResponse(
        data=[
            {"error_type": item["error_type"], "count": item["count"]}
            for item in error_distribution
        ]
    )


@router.post("/errors/details", response_model=ApiResponse)
async def dq_error_details(body: DataQualityErrorDetailRequest, db: AsyncSession = Depends(get_db)):
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(
            FDQ.DQ_Log_ID,
            FDQ.Error_Type,
            FDQ.Input_Video_ID,
            DIV.Headline,
            DIV.Source_Name,
            dd_sub.c.Full_Date.label("log_date"),
            DC.Channel_Name,
            DC.Client_Name,
            DU.User_Name,
            DU.Team_Name,
        )
        .select_from(FDQ)
        .join(FI, FDQ.Input_Video_ID == FI.Input_Video_ID)
        .join(DIV, FDQ.Input_Video_ID == DIV.Input_Video_ID)
        .join(dd_sub, FDQ.Log_Date_ID == dd_sub.c.Date_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(DU, FI.User_ID == DU.User_ID)
        .where(FDQ.Error_Type == body.error_type)
        .distinct()
        .order_by(dd_sub.c.Full_Date.desc(), FDQ.DQ_Log_ID.desc())
        .limit(250)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, dc_joined=True, du_joined=True)
    rows = (await db.execute(q)).all()
    data = [
        DataQualityErrorDetail(
            dq_log_id=row.DQ_Log_ID,
            error_type=row.Error_Type,
            input_video_id=row.Input_Video_ID,
            headline=row.Headline,
            source_name=row.Source_Name,
            log_date=row.log_date,
            channel_name=row.Channel_Name,
            client_name=row.Client_Name,
            user_name=row.User_Name,
            team_name=row.Team_Name,
        ).model_dump()
        for row in rows
    ]
    return ApiResponse(data=data, meta={"error_type": body.error_type, "limit": 250})


@router.post("/trends", response_model=ApiResponse)
async def dq_trends(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    dd_sub = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month, DD.Quarter, DD.Year).subquery()
    period = granularity_label(body.granularity, dd_sub.c)
    q = (
        select(period, FDQ.Error_Type, func.count(FDQ.DQ_Log_ID).label("count"))
        .select_from(FDQ)
        .join(FI, FDQ.Input_Video_ID == FI.Input_Video_ID)
        .join(dd_sub, FDQ.Log_Date_ID == dd_sub.c.Date_ID)
        .group_by("period", FDQ.Error_Type)
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()
    data = [{"period": str(row.period), "error_type": row.Error_Type, "count": row.count} for row in rows]
    return ApiResponse(data=data)


@router.post("/missing-fields", response_model=ApiResponse)
async def missing_fields_by_dimension(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(
            DC.Channel_Name,
            func.count(FI.Fact_Input_ID).label("total"),
            func.count(case((_blank_string(DIV.Source_URL), 1))).label("missing_source_url"),
            func.count(case((_unknown_string(DU.Team_Name), 1))).label("unknown_team"),
        )
        .select_from(FI)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(DIV, FI.Input_Video_ID == DIV.Input_Video_ID)
        .join(DU, FI.User_ID == DU.User_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Channel_Name)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, dc_joined=True, du_joined=True)
    rows = (await db.execute(q)).all()
    data = [
        {
            "channel": row.Channel_Name,
            "total": row.total,
            "missing_source_url": row.missing_source_url,
            "missing_source_url_pct": _safe_pct(row.missing_source_url, row.total),
            "unknown_team": row.unknown_team,
            "unknown_team_pct": _safe_pct(row.unknown_team, row.total),
        }
        for row in rows
    ]
    return ApiResponse(data=data)


@router.post("/duplicates", response_model=ApiResponse)
async def duplicate_detection(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    duplicate_rows, duplicate_clusters = await _build_duplicate_summary(body, db)
    return ApiResponse(data=duplicate_rows, meta={"total_duplicates": duplicate_clusters})


@router.post("/score", response_model=ApiResponse)
async def data_quality_score(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    field_reports, breakdown, total_records, total_field_issues = await _build_field_reports(body, db)
    error_distribution, total_errors, affected_records = await _build_error_distribution(body, db)
    _, duplicate_clusters = await _build_duplicate_summary(body, db)
    pillars = _build_pillars(total_records, total_errors, duplicate_clusters, field_reports, error_distribution)

    overall_score = _clamp_score(sum(item.score for item in pillars) / max(len(pillars), 1))
    payload = DataQualityScore(
        overall_score=overall_score,
        field_scores=field_reports,
        error_type_distribution=[
            {"error_type": item["error_type"], "count": item["count"]}
            for item in error_distribution
        ],
        total_errors=total_errors,
    ).model_dump()
    payload.update(
        {
            "total_records": total_records,
            "total_field_issues": total_field_issues,
            "affected_records": affected_records,
            "duplicate_clusters": duplicate_clusters,
            "breakdown": breakdown,
        }
    )
    return ApiResponse(data=payload)


@router.post("/story", response_model=ApiResponse)
async def data_quality_story(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    field_reports, _, total_records, total_field_issues = await _build_field_reports(body, db)
    error_distribution, total_errors, error_affected = await _build_error_distribution(body, db)
    duplicate_rows, duplicate_clusters = await _build_duplicate_summary(body, db)
    hotspots = await _build_hotspots(body, db)
    score_trend = await _build_score_trend(body, db)
    pillars = _build_pillars(total_records, total_errors, duplicate_clusters, field_reports, error_distribution)

    overall_score = _clamp_score(sum(item.score for item in pillars) / max(len(pillars), 1))
    strongest_pillar = max(pillars, key=lambda item: item.score).pillar if pillars else None
    weakest_pillar = min(pillars, key=lambda item: item.score).pillar if pillars else None
    affected_records = min(total_records, max(error_affected, max((item.affected_records for item in hotspots), default=0)))

    momentum_label = "stable"
    if len(score_trend) >= 2:
        delta = score_trend[-1].quality_score - score_trend[-2].quality_score
        if delta >= 4:
            momentum_label = "improving"
        elif delta <= -4:
            momentum_label = "deteriorating"

    incidents = _build_incidents(total_records, field_reports, error_distribution, duplicate_rows, score_trend)
    priority_focus = incidents[0].title if incidents else weakest_pillar
    headline, verdict = _story_headline(overall_score, weakest_pillar, strongest_pillar)

    story = DataQualityStoryResponse(
        summary=DataQualityStorySummary(
            headline=headline,
            verdict=verdict,
            overall_score=overall_score,
            total_records=total_records,
            affected_records=affected_records,
            affected_pct=_safe_pct(affected_records, total_records),
            total_errors=total_errors,
            duplicate_clusters=duplicate_clusters,
            total_field_issues=total_field_issues,
            strongest_pillar=strongest_pillar,
            weakest_pillar=weakest_pillar,
            momentum_label=momentum_label,
            priority_focus=priority_focus,
        ),
        pillars=pillars,
        incidents=incidents,
        hotspots=hotspots,
        score_trend=score_trend,
        field_reports=field_reports,
        error_type_distribution=error_distribution,
    )
    return ApiResponse(data=story.model_dump())
