"""Anomaly detection & threshold alerting endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import statistics

from app.database import get_db
from app.schemas.common import ApiResponse, AnalyticsRequest, AnomalyAlert
from app.services.analytics_service import (
    FI, FO, FP, DD, DC,
    apply_date_filter, apply_dimension_filters,
    build_published_input_subquery,
)

router = APIRouter(prefix="/alerts", tags=["Alerts & Anomalies"])


@router.post("/anomalies", response_model=ApiResponse)
async def detect_anomalies(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Detect statistical outliers in daily uploaded video counts.
    Uses z-score approach: flag days > 2 standard deviations from mean."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    q = (
        select(
            func.to_char(dd_sub.c.Full_Date, 'YYYY-MM-DD').label("day"),
            func.count(FI.Fact_Input_ID).label("count"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(dd_sub.c.Full_Date)
        .order_by(dd_sub.c.Full_Date)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()

    if len(rows) < 5:
        return ApiResponse(data=[], meta={"message": "Not enough data points for anomaly detection"})

    counts = [r.count for r in rows]
    mean = statistics.mean(counts)
    stdev = statistics.stdev(counts) if len(counts) > 1 else 0

    alerts = []
    for r in rows:
        if stdev == 0:
            continue
        z = (r.count - mean) / stdev
        if abs(z) > 2:
            severity = "high" if abs(z) > 3 else "medium" if abs(z) > 2.5 else "low"
            direction = "spike" if z > 0 else "drop"
            alerts.append(AnomalyAlert(
                metric="daily_uploaded_count",
                current_value=r.count,
                expected_value=round(mean, 1),
                deviation_pct=round((r.count - mean) / mean * 100, 1) if mean else 0,
                severity=severity,
                message=f"{direction.capitalize()} on {r.day}: {r.count} videos (expected ~{round(mean)})",
            ).model_dump())

    return ApiResponse(data=alerts, meta={"mean": round(mean, 1), "stdev": round(stdev, 1), "days_analyzed": len(rows)})


@router.post("/thresholds", response_model=ApiResponse)
async def threshold_alerts(
    body: AnalyticsRequest,
    min_daily_uploads: Optional[int] = 0,
    max_daily_uploads: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    """Flag days where uploaded count is above/below user-set thresholds."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(
            func.to_char(dd_sub.c.Full_Date, 'YYYY-MM-DD').label("day"),
            func.count(FI.Fact_Input_ID).label("count"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(dd_sub.c.Full_Date)
        .order_by(dd_sub.c.Full_Date)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()

    alerts = []
    for r in rows:
        if min_daily_uploads and r.count < min_daily_uploads:
            alerts.append({
                "day": r.day, "count": r.count,
                "alert": f"Below minimum threshold ({min_daily_uploads})",
                "severity": "medium",
            })
        if max_daily_uploads and r.count > max_daily_uploads:
            alerts.append({
                "day": r.day, "count": r.count,
                "alert": f"Above maximum threshold ({max_daily_uploads})",
                "severity": "high",
            })
    return ApiResponse(data=alerts)


@router.post("/drop-offs", response_model=ApiResponse)
async def drop_off_alerts(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Detect sudden drops in daily uploaded counts (>50% day-over-day decrease)."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(
            func.to_char(dd_sub.c.Full_Date, 'YYYY-MM-DD').label("day"),
            func.count(FI.Fact_Input_ID).label("count"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(dd_sub.c.Full_Date)
        .order_by(dd_sub.c.Full_Date)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()

    alerts = []
    for i in range(1, len(rows)):
        prev = rows[i - 1].count
        curr = rows[i].count
        if prev > 0:
            change_pct = round((curr - prev) / prev * 100, 1)
            if change_pct < -50:
                alerts.append({
                    "day": rows[i].day,
                    "current_count": curr,
                    "previous_count": prev,
                    "change_pct": change_pct,
                    "severity": "high" if change_pct < -75 else "medium",
                    "message": f"Drop of {abs(change_pct)}% from {rows[i-1].day} to {rows[i].day}",
                })
    return ApiResponse(data=alerts)


@router.post("/channel-anomalies", response_model=ApiResponse)
async def channel_anomalies(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Detect channels with unusually low publish rates vs overall average."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    uq = (
        select(DC.Channel_ID, DC.Channel_Name,
               func.count(FI.Fact_Input_ID).label("uploaded"))
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Channel_ID, DC.Channel_Name)
    )
    uq = apply_date_filter(uq, dd_sub.c.Full_Date, body.date_range)
    uq = apply_dimension_filters(uq, body.filters, has_fi=True, dc_joined=True)
    u_rows = (await db.execute(uq)).all()
    u_map = {r.Channel_ID: r for r in u_rows}

    pub_sub = build_published_input_subquery(body.date_range, body.filters, dimension="channel", date_basis="upload")
    pbq = (
        select(
            pub_sub.c.dimension_id.label("channel_id"),
            func.count(pub_sub.c.input_fact_id).label("published"),
        )
        .group_by(pub_sub.c.dimension_id)
    )
    pb_rows = (await db.execute(pbq)).all()
    pb_map = {r.channel_id: r.published for r in pb_rows}

    rates = []
    for cid, ur in u_map.items():
        pub = pb_map.get(cid, 0)
        rate = pub / ur.uploaded * 100 if ur.uploaded else 0
        rates.append({"channel_id": cid, "channel_name": ur.Channel_Name,
                       "uploaded": ur.uploaded, "published": pub, "rate": rate})

    if not rates:
        return ApiResponse(data=[])

    avg_rate = statistics.mean([r["rate"] for r in rates])

    alerts = []
    for r in rates:
        if r["rate"] < avg_rate * 0.5 and r["uploaded"] > 5:
            alerts.append({
                "channel_id": r["channel_id"],
                "channel_name": r["channel_name"],
                "uploaded": r["uploaded"],
                "published": r["published"],
                "publish_rate_pct": round(r["rate"], 2),
                "avg_rate_pct": round(avg_rate, 2),
                "severity": "high" if r["rate"] < avg_rate * 0.25 else "medium",
                "message": f"{r['channel_name']} has {round(r['rate'], 1)}% publish rate vs {round(avg_rate, 1)}% average",
            })
    alerts.sort(key=lambda x: x["publish_rate_pct"])
    return ApiResponse(data=alerts)
