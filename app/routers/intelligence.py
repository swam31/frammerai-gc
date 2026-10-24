"""Control Tower, Lost Value Engine, and Peer DNA endpoints."""

from __future__ import annotations

import math
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import case, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import AnalyticsRequest, ApiResponse, ScenarioSimulationRequest
from app.services.analytics_service import (
    DC,
    DD,
    FDQ,
    FI,
    FO,
    FP,
    apply_date_filter,
    apply_dimension_filters,
    get_dimension_cols,
)

router = APIRouter(prefix="/intelligence", tags=["Control Tower"])


def _safe_pct(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return round(numerator / denominator * 100, 2)


def _safe_div(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return round(numerator / denominator, 4)


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return round(sum(values) / len(values), 2)


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if not left_norm or not right_norm:
        return 0.0
    return round(numerator / (left_norm * right_norm), 4)


def _normalize_feature_vectors(rows: list[dict], feature_keys: list[str]) -> list[dict]:
    if not rows:
        return rows

    stats = {}
    for key in feature_keys:
        values = [float(row.get(key, 0) or 0) for row in rows]
        stats[key] = (min(values), max(values))

    for row in rows:
        vector = []
        for key in feature_keys:
            min_val, max_val = stats[key]
            raw_value = float(row.get(key, 0) or 0)
            if max_val == min_val:
                vector.append(0.5 if max_val else 0.0)
            else:
                vector.append((raw_value - min_val) / (max_val - min_val))
        row["feature_vector"] = vector
    return rows


def _attach_normalized_fields(
    rows: list[dict],
    field_keys: list[str],
    prefix: str = "norm::",
) -> list[dict]:
    if not rows:
        return rows

    stats = {}
    for key in field_keys:
        values = [float(row.get(key, 0) or 0) for row in rows]
        stats[key] = (min(values), max(values))

    for row in rows:
        for key in field_keys:
            min_val, max_val = stats[key]
            raw_value = float(row.get(key, 0) or 0)
            if max_val == min_val:
                normalized = 0.5 if max_val else 0.0
            else:
                normalized = (raw_value - min_val) / (max_val - min_val)
            row[f"{prefix}{key}"] = normalized
    return rows


def _billable_share_expr():
    return func.avg(case((FP.Is_Billable.is_(True), 1.0), else_=0.0))


def _missing_url_case():
    return case((or_(FP.Published_URL.is_(None), FP.Published_URL == ""), 1), else_=0)


def _non_negative_publish_lag(created_date_col, published_date_col):
    return func.greatest(
        func.extract("epoch", published_date_col) - func.extract("epoch", created_date_col),
        0,
    )


def _published_output_subquery_for_channel(body: AnalyticsRequest):
    dd_cr = select(DD.Date_ID, DD.Full_Date).subquery("dd_cr")
    dd_pb = select(DD.Date_ID, DD.Full_Date).subquery("dd_pb")

    stmt = (
        select(
            DC.Channel_ID.label("channel_id"),
            FO.Fact_Output_ID.label("output_id"),
            func.max(func.extract("epoch", FO.Created_Duration)).label("output_seconds"),
            _billable_share_expr().label("billable_share"),
            func.max(_missing_url_case()).label("has_missing_url"),
            func.min(
                _non_negative_publish_lag(dd_cr.c.Full_Date, dd_pb.c.Full_Date)
            ).label("first_publish_lag"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
        .group_by(DC.Channel_ID, FO.Fact_Output_ID)
    )
    stmt = apply_date_filter(stmt, dd_pb.c.Full_Date, body.date_range)
    stmt = apply_dimension_filters(stmt, body.filters, has_fi=True, has_fp=True, dc_joined=True)
    return stmt.subquery("published_output_channel")


def _published_output_subquery_for_dimension(body: AnalyticsRequest, dimension: str):
    join_table, join_condition, id_col, label_col = get_dimension_cols(dimension)
    dd_cr = select(DD.Date_ID, DD.Full_Date).subquery("dd_cr")
    dd_pb = select(DD.Date_ID, DD.Full_Date).subquery("dd_pb")

    stmt = (
        select(
            id_col.label("dimension_id"),
            label_col.label("dimension_label"),
            FO.Fact_Output_ID.label("output_id"),
            func.max(func.extract("epoch", FO.Created_Duration)).label("output_seconds"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(join_table, join_condition)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
        .group_by(id_col, label_col, FO.Fact_Output_ID)
    )
    stmt = apply_date_filter(stmt, dd_pb.c.Full_Date, body.date_range)
    stmt = apply_dimension_filters(
        stmt,
        body.filters,
        has_fi=True,
        has_fp=True,
        dc_joined=dimension in {"channel", "client"},
        du_joined=dimension in {"user", "team"},
    )
    return stmt.subquery(f"published_output_{dimension}")


def _published_output_subquery_baseline(body: AnalyticsRequest):
    dd_cr = select(DD.Date_ID, DD.Full_Date).subquery("dd_cr")
    dd_pb = select(DD.Date_ID, DD.Full_Date).subquery("dd_pb")

    stmt = (
        select(
            FO.Fact_Output_ID.label("output_id"),
            func.max(func.extract("epoch", FO.Created_Duration)).label("output_seconds"),
            _billable_share_expr().label("billable_share"),
            func.min(
                _non_negative_publish_lag(dd_cr.c.Full_Date, dd_pb.c.Full_Date)
            ).label("first_publish_lag"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
        .group_by(FO.Fact_Output_ID)
    )
    stmt = apply_date_filter(stmt, dd_pb.c.Full_Date, body.date_range)
    stmt = apply_dimension_filters(stmt, body.filters, has_fi=True, has_fp=True)
    return stmt.subquery("published_output_baseline")


async def _channel_rollup(body: AnalyticsRequest, db: AsyncSession) -> list[dict]:
    dd_up = select(DD.Date_ID, DD.Full_Date).subquery("dd_up")
    dd_cr = select(DD.Date_ID, DD.Full_Date).subquery("dd_cr")
    dd_pb = select(DD.Date_ID, DD.Full_Date).subquery("dd_pb")
    dd_dq = select(DD.Date_ID, DD.Full_Date).subquery("dd_dq")

    uploads_q = (
        select(
            DC.Channel_ID.label("channel_id"),
            DC.Channel_Name.label("channel_name"),
            DC.Client_ID.label("client_id"),
            DC.Client_Name.label("client_name"),
            func.count(FI.Fact_Input_ID).label("uploads"),
            func.count(distinct(FI.User_ID)).label("active_users"),
            func.count(distinct(FI.Language_ID)).label("languages"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("input_seconds"),
        )
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
        .group_by(DC.Channel_ID, DC.Channel_Name, DC.Client_ID, DC.Client_Name)
    )
    uploads_q = apply_date_filter(uploads_q, dd_up.c.Full_Date, body.date_range)
    uploads_q = apply_dimension_filters(uploads_q, body.filters, has_fi=True, dc_joined=True)
    uploads_rows = (await db.execute(uploads_q)).all()

    outputs_q = (
        select(
            DC.Channel_ID.label("channel_id"),
            func.count(FO.Fact_Output_ID).label("outputs"),
            func.count(distinct(FI.Fact_Input_ID)).label("unique_inputs"),
            func.coalesce(func.extract("epoch", func.sum(FO.Created_Duration)), 0).label("output_seconds"),
            func.avg(
                func.greatest(
                    func.extract("epoch", dd_cr.c.Full_Date) - func.extract("epoch", dd_up.c.Full_Date),
                    0,
                )
            ).label("avg_upload_to_process"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
        .group_by(DC.Channel_ID)
    )
    outputs_q = apply_date_filter(outputs_q, dd_cr.c.Full_Date, body.date_range)
    outputs_q = apply_dimension_filters(outputs_q, body.filters, has_fi=True, dc_joined=True)
    outputs_rows = (await db.execute(outputs_q)).all()

    published_output_sub = _published_output_subquery_for_channel(body)
    published_q = (
        select(
            published_output_sub.c.channel_id,
            func.count(published_output_sub.c.output_id).label("published"),
            func.coalesce(func.sum(published_output_sub.c.output_seconds), 0).label("published_seconds"),
            func.coalesce(func.sum(published_output_sub.c.billable_share), 0).label("billable_published"),
            func.coalesce(
                func.sum(published_output_sub.c.billable_share * published_output_sub.c.output_seconds),
                0,
            ).label("billable_seconds"),
            func.coalesce(func.sum(published_output_sub.c.has_missing_url), 0).label("missing_urls"),
            func.avg(published_output_sub.c.first_publish_lag).label("avg_process_to_publish"),
        )
        .group_by(published_output_sub.c.channel_id)
    )
    published_rows = (await db.execute(published_q)).all()

    platform_q = (
        select(
            DC.Channel_ID.label("channel_id"),
            func.count(distinct(FP.Platform_ID)).label("platforms"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
        .group_by(DC.Channel_ID)
    )
    platform_q = apply_date_filter(platform_q, dd_pb.c.Full_Date, body.date_range)
    platform_q = apply_dimension_filters(platform_q, body.filters, has_fi=True, has_fp=True, dc_joined=True)
    platform_rows = (await db.execute(platform_q)).all()
    platform_map = {row.channel_id: int(row.platforms or 0) for row in platform_rows}

    quality_q = (
        select(
            DC.Channel_ID.label("channel_id"),
            func.count(FDQ.DQ_Log_ID).label("error_count"),
        )
        .select_from(FDQ)
        .join(FI, FDQ.Input_Video_ID == FI.Input_Video_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_dq, FDQ.Log_Date_ID == dd_dq.c.Date_ID)
        .group_by(DC.Channel_ID)
    )
    quality_q = apply_date_filter(quality_q, dd_dq.c.Full_Date, body.date_range)
    quality_q = apply_dimension_filters(quality_q, body.filters, has_fi=True, dc_joined=True)
    quality_rows = (await db.execute(quality_q)).all()

    rollup: dict[str, dict] = {}
    for row in uploads_rows:
        rollup[row.channel_id] = {
            "entity_id": row.channel_id,
            "entity_name": row.channel_name,
            "client_id": row.client_id,
            "client_name": row.client_name,
            "uploads": int(row.uploads or 0),
            "active_users": int(row.active_users or 0),
            "languages": int(row.languages or 0),
            "input_hours": round(float(row.input_seconds or 0) / 3600, 2),
            "outputs": 0,
            "unique_inputs": 0,
            "output_hours": 0.0,
            "published": 0,
            "published_hours": 0.0,
            "billable_published": 0,
            "billable_hours": 0.0,
            "platforms": 0,
            "missing_urls": 0,
            "dq_errors": 0,
            "avg_upload_to_process_days": 0.0,
            "avg_process_to_publish_days": 0.0,
        }

    for row in outputs_rows:
        item = rollup.setdefault(
            row.channel_id,
            {
                "entity_id": row.channel_id,
                "entity_name": row.channel_id,
                "client_id": None,
                "client_name": "Unknown",
                "uploads": 0,
                "active_users": 0,
                "languages": 0,
                "input_hours": 0.0,
                "published": 0,
                "published_hours": 0.0,
                "billable_published": 0,
                "billable_hours": 0.0,
                "platforms": 0,
                "missing_urls": 0,
                "dq_errors": 0,
                "avg_process_to_publish_days": 0.0,
            },
        )
        item["outputs"] = int(row.outputs or 0)
        item["unique_inputs"] = int(row.unique_inputs or 0)
        item["output_hours"] = round(float(row.output_seconds or 0) / 3600, 2)
        item["avg_upload_to_process_days"] = round(float(row.avg_upload_to_process or 0) / 86400, 2)

    for row in published_rows:
        item = rollup.setdefault(
            row.channel_id,
            {
                "entity_id": row.channel_id,
                "entity_name": row.channel_id,
                "client_id": None,
                "client_name": "Unknown",
                "uploads": 0,
                "active_users": 0,
                "languages": 0,
                "input_hours": 0.0,
                "outputs": 0,
                "unique_inputs": 0,
                "output_hours": 0.0,
                "dq_errors": 0,
                "avg_upload_to_process_days": 0.0,
            },
        )
        item["published"] = int(row.published or 0)
        item["published_hours"] = round(float(row.published_seconds or 0) / 3600, 2)
        item["billable_published"] = round(float(row.billable_published or 0), 2)
        item["billable_hours"] = round(float(row.billable_seconds or 0) / 3600, 2)
        item["platforms"] = platform_map.get(row.channel_id, 0)
        item["missing_urls"] = int(row.missing_urls or 0)
        item["avg_process_to_publish_days"] = round(float(row.avg_process_to_publish or 0) / 86400, 2)

    for row in quality_rows:
        item = rollup.setdefault(
            row.channel_id,
            {
                "entity_id": row.channel_id,
                "entity_name": row.channel_id,
                "client_id": None,
                "client_name": "Unknown",
                "uploads": 0,
                "active_users": 0,
                "languages": 0,
                "input_hours": 0.0,
                "outputs": 0,
                "unique_inputs": 0,
                "output_hours": 0.0,
                "published": 0,
                "published_hours": 0.0,
                "billable_published": 0,
                "billable_hours": 0.0,
                "platforms": 0,
                "missing_urls": 0,
                "avg_upload_to_process_days": 0.0,
                "avg_process_to_publish_days": 0.0,
            },
        )
        item["dq_errors"] = int(row.error_count or 0)

    rows = list(rollup.values())
    if not rows:
        return rows

    max_uploads = max((row["uploads"] for row in rows), default=1) or 1
    max_users = max((row["active_users"] for row in rows), default=1) or 1
    max_languages = max((row["languages"] for row in rows), default=1) or 1
    max_platforms = max((row["platforms"] for row in rows), default=1) or 1

    for row in rows:
        publish_rate = _safe_pct(row["published"], row["outputs"])
        billable_rate = _safe_pct(row["billable_published"], row["published"])
        clip_rate = _safe_div(row["outputs"], row["unique_inputs"])
        missing_url_pct = _safe_pct(row["missing_urls"], row["published"])
        adoption_score = _clamp(row["uploads"] / max_uploads * 100)
        conversion_score = publish_rate
        velocity_score = _clamp(100 - min(row["avg_process_to_publish_days"], 7) / 7 * 100)
        coverage_score = _clamp(
            (row["active_users"] / max_users) * 45
            + (row["languages"] / max_languages) * 25
            + (row["platforms"] / max_platforms) * 30
        )
        data_quality_score = _clamp(100 - (row["dq_errors"] * 12) - (missing_url_pct * 0.65))
        health_score = round(
            adoption_score * 0.30
            + conversion_score * 0.25
            + velocity_score * 0.20
            + coverage_score * 0.15
            + data_quality_score * 0.10,
            1,
        )
        lost_outputs = max(row["outputs"] - row["published"], 0)
        lost_hours = round(max(row["output_hours"] - row["published_hours"], 0.0), 2)
        recoverable_billable_hours = round(lost_hours * (billable_rate / 100), 2)

        weakest_component = min(
            [
                ("conversion", conversion_score),
                ("velocity", velocity_score),
                ("coverage", coverage_score),
                ("data_quality", data_quality_score),
            ],
            key=lambda item: item[1],
        )[0]
        if weakest_component == "conversion":
            primary_issue = "Publish conversion bottleneck"
            recommended_action = f"Audit publishing workflow for {row['entity_name']} and tighten processed-to-published handoff."
        elif weakest_component == "velocity":
            primary_issue = "Publishing latency"
            recommended_action = f"Prioritize faster publish approval on {row['entity_name']} to reduce idle processed output."
        elif weakest_component == "data_quality":
            primary_issue = "Metadata quality leakage"
            recommended_action = f"Fix missing URLs and recurring quality logs on {row['entity_name']} before more volume is routed there."
        else:
            primary_issue = "Under-adopted workspace"
            recommended_action = f"Expand user and platform coverage on {row['entity_name']} to unlock more output capacity."

        row.update(
            {
                "publish_rate_pct": publish_rate,
                "billable_rate_pct": billable_rate,
                "clip_rate": round(clip_rate, 2),
                "missing_url_pct": missing_url_pct,
                "adoption_score": round(adoption_score, 1),
                "conversion_score": round(conversion_score, 1),
                "velocity_score": round(velocity_score, 1),
                "coverage_score": round(coverage_score, 1),
                "data_quality_score": round(data_quality_score, 1),
                "health_score": health_score,
                "lost_outputs": lost_outputs,
                "lost_hours": lost_hours,
                "recoverable_billable_hours": recoverable_billable_hours,
                "primary_issue": primary_issue,
                "recommended_action": recommended_action,
            }
        )

    rows.sort(key=lambda item: item["health_score"], reverse=True)
    return rows


async def _dimension_gap_rows(body: AnalyticsRequest, db: AsyncSession, dimension: str) -> list[dict]:
    join_table, join_condition, id_col, label_col = get_dimension_cols(dimension)
    dd_cr = select(DD.Date_ID, DD.Full_Date).subquery("dd_cr")
    dd_pb = select(DD.Date_ID, DD.Full_Date).subquery("dd_pb")

    outputs_q = (
        select(
            id_col.label("dimension_id"),
            label_col.label("dimension_label"),
            func.count(FO.Fact_Output_ID).label("outputs"),
            func.coalesce(func.extract("epoch", func.sum(FO.Created_Duration)), 0).label("output_seconds"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(join_table, join_condition)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
        .group_by(id_col, label_col)
    )
    outputs_q = apply_date_filter(outputs_q, dd_cr.c.Full_Date, body.date_range)
    outputs_q = apply_dimension_filters(
        outputs_q,
        body.filters,
        has_fi=True,
        dc_joined=dimension in {"channel", "client"},
        du_joined=dimension in {"user", "team"},
    )
    output_rows = (await db.execute(outputs_q)).all()

    published_output_sub = _published_output_subquery_for_dimension(body, dimension)
    published_q = (
        select(
            published_output_sub.c.dimension_id,
            published_output_sub.c.dimension_label,
            func.count(published_output_sub.c.output_id).label("published"),
            func.coalesce(func.sum(published_output_sub.c.output_seconds), 0).label("published_seconds"),
        )
        .group_by(published_output_sub.c.dimension_id, published_output_sub.c.dimension_label)
    )
    published_rows = (await db.execute(published_q)).all()

    published_map = {
        row.dimension_id: {
            "published": int(row.published or 0),
            "published_hours": round(float(row.published_seconds or 0) / 3600, 2),
        }
        for row in published_rows
    }

    items = []
    for row in output_rows:
        published = published_map.get(row.dimension_id, {})
        outputs = int(row.outputs or 0)
        output_hours = round(float(row.output_seconds or 0) / 3600, 2)
        published_count = int(published.get("published", 0))
        published_hours = float(published.get("published_hours", 0))
        items.append(
            {
                "dimension": dimension,
                "dimension_id": str(row.dimension_id),
                "dimension_label": row.dimension_label,
                "outputs": outputs,
                "published": published_count,
                "output_hours": output_hours,
                "published_hours": published_hours,
                "gap_count": max(outputs - published_count, 0),
                "gap_hours": round(max(output_hours - published_hours, 0.0), 2),
                "publish_rate_pct": _safe_pct(published_count, outputs),
            }
        )

    items.sort(key=lambda item: (item["gap_hours"], item["gap_count"]), reverse=True)
    return items


async def _baseline_metrics(body: AnalyticsRequest, db: AsyncSession) -> dict:
    dd_up = select(DD.Date_ID, DD.Full_Date).subquery("dd_up")
    dd_cr = select(DD.Date_ID, DD.Full_Date).subquery("dd_cr")
    outputs_q = (
        select(
            func.count(FO.Fact_Output_ID).label("outputs"),
            func.coalesce(func.extract("epoch", func.sum(FO.Created_Duration)), 0).label("output_seconds"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
    )
    outputs_q = apply_date_filter(outputs_q, dd_cr.c.Full_Date, body.date_range)
    outputs_q = apply_dimension_filters(outputs_q, body.filters, has_fi=True)
    outputs = (await db.execute(outputs_q)).one()

    published_output_sub = _published_output_subquery_baseline(body)
    published_q = select(
        func.count(published_output_sub.c.output_id).label("published"),
        func.coalesce(func.sum(published_output_sub.c.output_seconds), 0).label("published_seconds"),
        func.coalesce(func.sum(published_output_sub.c.billable_share), 0).label("billable_published"),
        func.avg(published_output_sub.c.first_publish_lag).label("avg_process_to_publish"),
    )
    published = (await db.execute(published_q)).one()

    users_q = (
        select(func.count(distinct(FI.User_ID)).label("active_users"))
        .select_from(FI)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
    )
    users_q = apply_date_filter(users_q, dd_up.c.Full_Date, body.date_range)
    users_q = apply_dimension_filters(users_q, body.filters, has_fi=True)
    active_users = int((await db.execute(users_q)).scalar() or 0)

    processed_count = int(outputs.outputs or 0)
    published_count = int(published.published or 0)
    output_hours = round(float(outputs.output_seconds or 0) / 3600, 2)
    published_hours = round(float(published.published_seconds or 0) / 3600, 2)
    billable_rate = _safe_pct(float(published.billable_published or 0), published_count)
    return {
        "processed_count": processed_count,
        "published_count": published_count,
        "output_hours": output_hours,
        "published_hours": published_hours,
        "active_users": active_users,
        "publish_rate_pct": _safe_pct(published_count, processed_count),
        "billable_rate_pct": billable_rate,
        "avg_process_to_publish_days": round(float(published.avg_process_to_publish or 0) / 86400, 2),
    }


@router.post("/control-tower", response_model=ApiResponse)
async def control_tower(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    channel_rows = await _channel_rollup(body, db)
    dimension_drivers = []
    for dimension in ["channel", "team", "language", "output_type"]:
        dimension_drivers.extend((await _dimension_gap_rows(body, db, dimension))[:2])

    total_gap_hours = sum(item["gap_hours"] for item in dimension_drivers) or 1
    drivers = [
        {
            **item,
            "share_of_gap_pct": round(item["gap_hours"] / total_gap_hours * 100, 1),
        }
        for item in sorted(dimension_drivers, key=lambda row: row["gap_hours"], reverse=True)[:8]
    ]

    opportunities = sorted(
        channel_rows,
        key=lambda row: row["lost_hours"] * 10 + row["lost_outputs"] * 2 + (100 - row["health_score"]),
        reverse=True,
    )[:8]
    opportunity_cards = [
        {
            "entity_id": row["entity_id"],
            "entity_name": row["entity_name"],
            "client_name": row["client_name"],
            "recoverable_published_hours": row["lost_hours"],
            "recoverable_billable_hours": row["recoverable_billable_hours"],
            "likely_impact_score": round(
                row["lost_hours"] * 10 + row["lost_outputs"] * 2 + (100 - row["health_score"]),
                1,
            ),
            "primary_issue": row["primary_issue"],
            "recommended_action": row["recommended_action"],
        }
        for row in opportunities
    ]

    action_cards = []
    for row in opportunities[:5]:
        action_cards.append(
            {
                "title": f"Recover publish leakage on {row['entity_name']}",
                "detail": (
                    f"{row['entity_name']} is sitting on {row['lost_hours']} recoverable hours and "
                    f"{row['lost_outputs']} stalled outputs. {row['recommended_action']}"
                ),
                "severity": "high" if row["health_score"] < 45 else "medium",
                "owner": "Operations",
                "metric": "Recoverable published hours",
                "value": row["lost_hours"],
            }
        )

    if drivers:
        top_driver = drivers[0]
        action_cards.append(
            {
                "title": f"Intervene on {top_driver['dimension_label']}",
                "detail": (
                    f"{top_driver['dimension'].replace('_', ' ').title()} {top_driver['dimension_label']} is driving "
                    f"{top_driver['share_of_gap_pct']}% of the current publish gap."
                ),
                "severity": "high",
                "owner": "Client Success",
                "metric": "Gap hours",
                "value": top_driver["gap_hours"],
            }
        )

    summary = {
        "overall_health_score": round(_mean([row["health_score"] for row in channel_rows]), 1),
        "tracked_channels": len(channel_rows),
        "tracked_clients": len({row["client_id"] for row in channel_rows if row["client_id"]}),
        "avg_publish_rate_pct": round(_mean([row["publish_rate_pct"] for row in channel_rows]), 1),
        "avg_velocity_days": round(_mean([row["avg_process_to_publish_days"] for row in channel_rows]), 2),
        "avg_data_quality_score": round(_mean([row["data_quality_score"] for row in channel_rows]), 1),
        "recoverable_published_hours": round(sum(row["lost_hours"] for row in channel_rows), 2),
        "recoverable_billable_hours": round(sum(row["recoverable_billable_hours"] for row in channel_rows), 2),
    }

    return ApiResponse(
        data={
            "summary": summary,
            "health_scores": channel_rows,
            "drivers": drivers,
            "opportunities": opportunity_cards,
            "action_cards": action_cards[:6],
        }
    )


@router.post("/scenario-simulator", response_model=ApiResponse)
async def scenario_simulator(body: ScenarioSimulationRequest, db: AsyncSession = Depends(get_db)):
    baseline = await _baseline_metrics(body, db)

    current_gap = max(baseline["processed_count"] - baseline["published_count"], 0)
    recoverable_hours = max(baseline["output_hours"] - baseline["published_hours"], 0.0)
    baseline_velocity = max(baseline["avg_process_to_publish_days"], 0.5)

    recovery_from_publish = current_gap * (body.publish_rate_uplift_pct / 100)
    recovery_from_velocity = current_gap * min(body.process_to_publish_days_improvement / baseline_velocity, 1) * 0.35
    recovery_from_activation = current_gap * (body.active_users_uplift_pct / 100) * 0.25
    total_recovered_outputs = min(current_gap, round(recovery_from_publish + recovery_from_velocity + recovery_from_activation))

    projected_published_count = baseline["published_count"] + total_recovered_outputs
    recovered_share = _safe_div(total_recovered_outputs, current_gap) if current_gap else 0.0
    projected_published_hours = round(baseline["published_hours"] + recoverable_hours * recovered_share, 2)
    projected_billable_rate = min(100.0, baseline["billable_rate_pct"] + body.billable_rate_uplift_pct)
    projected_billable_hours = round(projected_published_hours * projected_billable_rate / 100, 2)

    return ApiResponse(
        data={
            "baseline": baseline,
            "inputs": {
                "publish_rate_uplift_pct": body.publish_rate_uplift_pct,
                "process_to_publish_days_improvement": body.process_to_publish_days_improvement,
                "active_users_uplift_pct": body.active_users_uplift_pct,
                "billable_rate_uplift_pct": body.billable_rate_uplift_pct,
            },
            "projection": {
                "projected_published_count": projected_published_count,
                "projected_published_hours": projected_published_hours,
                "projected_billable_hours": projected_billable_hours,
                "projected_billable_rate_pct": round(projected_billable_rate, 2),
                "projected_process_to_publish_days": round(max(baseline["avg_process_to_publish_days"] - body.process_to_publish_days_improvement, 0.2), 2),
                "net_new_published_outputs": total_recovered_outputs,
                "net_new_published_hours": round(projected_published_hours - baseline["published_hours"], 2),
            },
            "assumptions": [
                "Recovered output is capped by the current processed-versus-published gap.",
                "Velocity improvements unlock at most 35% of the current gap on their own.",
                "User activation improvements only monetize if there is already unused processed output.",
                "Billable uplift is applied after projected published hours are estimated.",
            ],
        }
    )


@router.post("/lost-value", response_model=ApiResponse)
async def lost_value_engine(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    baseline = await _baseline_metrics(body, db)
    by_client = await _dimension_gap_rows(body, db, "client")
    by_output_type = await _dimension_gap_rows(body, db, "output_type")
    by_channel = await _dimension_gap_rows(body, db, "channel")

    recoverable_hours = round(max(baseline["output_hours"] - baseline["published_hours"], 0.0), 2)
    recoverable_billable_hours = round(recoverable_hours * baseline["billable_rate_pct"] / 100, 2)

    return ApiResponse(
        data={
            "summary": {
                "processed_outputs": baseline["processed_count"],
                "published_outputs": baseline["published_count"],
                "stalled_outputs": max(baseline["processed_count"] - baseline["published_count"], 0),
                "recoverable_hours": recoverable_hours,
                "recoverable_billable_hours": recoverable_billable_hours,
                "current_publish_rate_pct": baseline["publish_rate_pct"],
                "avg_process_to_publish_days": baseline["avg_process_to_publish_days"],
            },
            "waterfall": [
                {"stage": "Processed Hours", "value": baseline["output_hours"]},
                {"stage": "Published Hours", "value": baseline["published_hours"]},
                {"stage": "Recoverable Hours", "value": recoverable_hours},
                {"stage": "Billable Opportunity", "value": recoverable_billable_hours},
            ],
            "by_client": by_client[:10],
            "by_output_type": by_output_type[:10],
            "by_channel": by_channel[:10],
        }
    )


@router.post("/peer-dna", response_model=ApiResponse)
async def peer_dna(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    channel_rows = await _channel_rollup(body, db)
    candidate_rows = sorted(channel_rows, key=lambda row: row["outputs"], reverse=True)[:12]
    if not candidate_rows:
        return ApiResponse(data={"nodes": [], "edges": [], "playbooks": [], "clusters": []})

    dd_cr = select(DD.Date_ID, DD.Full_Date).subquery("dd_cr")
    mix_q = (
        select(
            DC.Channel_ID.label("channel_id"),
            FI.Output_Type_ID.label("output_type_id"),
            func.count(FO.Fact_Output_ID).label("outputs"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
        .group_by(DC.Channel_ID, FI.Output_Type_ID)
    )
    mix_q = apply_date_filter(mix_q, dd_cr.c.Full_Date, body.date_range)
    mix_q = apply_dimension_filters(mix_q, body.filters, has_fi=True, dc_joined=True)
    mix_rows = (await db.execute(mix_q)).all()

    totals_by_type = defaultdict(int)
    mix_by_channel: dict[str, dict[str, int]] = defaultdict(dict)
    for row in mix_rows:
        totals_by_type[row.output_type_id] += int(row.outputs or 0)
        mix_by_channel[row.channel_id][row.output_type_id] = int(row.outputs or 0)

    top_mix_types = [type_id for type_id, _ in sorted(totals_by_type.items(), key=lambda item: item[1], reverse=True)[:4]]

    archetype_rows = [dict(row) for row in candidate_rows]
    for row in archetype_rows:
        row["velocity_inverse"] = 1 / max(row["avg_process_to_publish_days"], 1)

    _attach_normalized_fields(
        archetype_rows,
        [
            "uploads",
            "outputs",
            "publish_rate_pct",
            "billable_rate_pct",
            "languages",
            "platforms",
            "coverage_score",
            "velocity_inverse",
            "health_score",
            "lost_hours",
            "clip_rate",
        ],
    )

    cluster_assignments: dict[str, str] = {}
    for row in archetype_rows:
        publish_norm = row["norm::publish_rate_pct"]
        platforms_norm = row["norm::platforms"]
        velocity_norm = row["norm::velocity_inverse"]
        billable_norm = row["norm::billable_rate_pct"]
        languages_norm = row["norm::languages"]
        coverage_norm = row["norm::coverage_score"]
        outputs_norm = row["norm::outputs"]
        uploads_norm = row["norm::uploads"]
        lost_norm = row["norm::lost_hours"]
        health_norm = row["norm::health_score"]
        clip_norm = row["norm::clip_rate"]

        archetype_scores = {
            "High-conversion syndicators": (
                publish_norm * 0.38
                + platforms_norm * 0.20
                + velocity_norm * 0.18
                + billable_norm * 0.14
                + health_norm * 0.10
            ),
            "Volume without finish": (
                outputs_norm * 0.34
                + uploads_norm * 0.22
                + lost_norm * 0.26
                + (1 - publish_norm) * 0.18
            ),
            "Multilingual specialists": (
                languages_norm * 0.42
                + coverage_norm * 0.24
                + platforms_norm * 0.14
                + billable_norm * 0.10
                + clip_norm * 0.10
            ),
            "Emerging workspaces": (
                (1 - outputs_norm) * 0.30
                + (1 - uploads_norm) * 0.22
                + (1 - health_norm) * 0.24
                + (1 - platforms_norm) * 0.12
                + (1 - publish_norm) * 0.12
            ),
        }

        cluster_assignments[row["entity_id"]] = max(
            archetype_scores.items(),
            key=lambda item: item[1],
        )[0]

    unique_clusters = set(cluster_assignments.values())
    if len(unique_clusters) < 2 and len(archetype_rows) >= 4:
        ranked_rows = sorted(
            archetype_rows,
            key=lambda row: (
                row["health_score"] * 0.45
                + row["publish_rate_pct"] * 0.30
                + row["coverage_score"] * 0.15
                + row["outputs"] * 0.10
            ),
            reverse=True,
        )
        fallback_labels = [
            "High-conversion syndicators",
            "Multilingual specialists",
            "Volume without finish",
            "Emerging workspaces",
        ]
        bucket_size = max(1, math.ceil(len(ranked_rows) / len(fallback_labels)))
        for idx, row in enumerate(ranked_rows):
            label_idx = min(idx // bucket_size, len(fallback_labels) - 1)
            cluster_assignments[row["entity_id"]] = fallback_labels[label_idx]

    feature_rows = []
    for row in candidate_rows:
        feature_row = dict(row)
        feature_row["cluster"] = cluster_assignments.get(
            row["entity_id"],
            "Emerging workspaces",
        )
        feature_row["velocity_inverse"] = 1 / max(row["avg_process_to_publish_days"], 1)
        for output_type_id in top_mix_types:
            feature_row[f"mix::{output_type_id}"] = _safe_div(
                mix_by_channel.get(row["entity_id"], {}).get(output_type_id, 0),
                row["outputs"],
            )
        feature_rows.append(feature_row)

    feature_keys = [
        "uploads",
        "outputs",
        "published",
        "publish_rate_pct",
        "clip_rate",
        "platforms",
        "languages",
        "billable_rate_pct",
        "velocity_inverse",
    ] + [f"mix::{output_type_id}" for output_type_id in top_mix_types]
    feature_rows = _normalize_feature_vectors(feature_rows, feature_keys)

    edges = []
    seen_pairs = set()
    for row in feature_rows:
        peer_scores = []
        for peer in feature_rows:
            if row["entity_id"] == peer["entity_id"]:
                continue
            peer_scores.append((peer, _cosine_similarity(row["feature_vector"], peer["feature_vector"])))
        peer_scores.sort(key=lambda item: item[1], reverse=True)
        for peer, similarity in peer_scores[:2]:
            pair_key = tuple(sorted([row["entity_id"], peer["entity_id"]]))
            if similarity < 0.68 or pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)
            edges.append(
                {
                    "source": row["entity_id"],
                    "target": peer["entity_id"],
                    "similarity_pct": round(similarity * 100, 1),
                }
            )

    playbooks = []
    for row in feature_rows:
        nearest = None
        for peer in feature_rows:
            if row["entity_id"] == peer["entity_id"] or peer["health_score"] <= row["health_score"]:
                continue
            similarity = _cosine_similarity(row["feature_vector"], peer["feature_vector"])
            if nearest is None or similarity > nearest[1]:
                nearest = (peer, similarity)
        if nearest:
            peer, similarity = nearest
            playbooks.append(
                {
                    "entity_id": row["entity_id"],
                    "entity_name": row["entity_name"],
                    "peer_id": peer["entity_id"],
                    "peer_name": peer["entity_name"],
                    "similarity_pct": round(similarity * 100, 1),
                    "performance_gap": round(peer["health_score"] - row["health_score"], 1),
                    "playbook": (
                        f"Borrow the operating pattern of {peer['entity_name']}: it converts "
                        f"{peer['publish_rate_pct']}% of outputs and runs at {peer['avg_process_to_publish_days']} days."
                    ),
                }
            )
    playbooks.sort(key=lambda item: item["performance_gap"], reverse=True)

    cluster_counts = defaultdict(int)
    for row in feature_rows:
        cluster_counts[row["cluster"]] += 1

    nodes = [
        {
            "entity_id": row["entity_id"],
            "entity_name": row["entity_name"],
            "client_name": row["client_name"],
            "cluster": row["cluster"],
            "health_score": row["health_score"],
            "outputs": row["outputs"],
            "published": row["published"],
            "publish_rate_pct": row["publish_rate_pct"],
            "avg_process_to_publish_days": row["avg_process_to_publish_days"],
            "lost_hours": row["lost_hours"],
        }
        for row in feature_rows
    ]

    clusters = [
        {"cluster": cluster, "count": count}
        for cluster, count in sorted(cluster_counts.items(), key=lambda item: item[1], reverse=True)
    ]

    return ApiResponse(data={"nodes": nodes, "edges": edges, "playbooks": playbooks[:8], "clusters": clusters})
