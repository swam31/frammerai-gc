"""Client analytics endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import AnalyticsRequest, ApiResponse, TrendRequest
from app.services.analytics_service import (
    FI, FO, FP, DD, DC,
    apply_date_filter, apply_dimension_filters, granularity_label, build_published_input_subquery,
)

router = APIRouter(prefix="/clients", tags=["Client Analytics"])


@router.post("/performance", response_model=ApiResponse)
async def client_performance(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Per-client KPIs: uploaded, processed, published."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    uq = (
        select(DC.Client_ID, DC.Client_Name,
               func.count(FI.Fact_Input_ID).label("uploaded_count"),
               func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("uploaded_dur"))
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Client_ID, DC.Client_Name)
    )
    uq = apply_date_filter(uq, dd_sub.c.Full_Date, body.date_range)
    uq = apply_dimension_filters(uq, body.filters, has_fi=True, dc_joined=True)
    u_rows = (await db.execute(uq)).all()
    u_map = {r.Client_ID: r for r in u_rows}

    pub_sub = build_published_input_subquery(body.date_range, body.filters, dimension="client", date_basis="upload")
    pbq = (
        select(
            pub_sub.c.dimension_id.label("client_id"),
            func.count(pub_sub.c.input_fact_id).label("published_count"),
            func.coalesce(func.sum(pub_sub.c.uploaded_duration_seconds), 0).label("published_dur"),
        )
        .group_by(pub_sub.c.dimension_id)
    )
    pb_rows = (await db.execute(pbq)).all()
    pb_map = {r.client_id: r for r in pb_rows}

    data = []
    for cid, ur in u_map.items():
        pb = pb_map.get(cid)
        data.append({
            "client_id": cid,
            "client_name": ur.Client_Name,
            "uploaded_count": ur.uploaded_count,
            "uploaded_duration_hours": round(ur.uploaded_dur / 3600, 2),
            "published_count": pb.published_count if pb else 0,
            "published_duration_hours": round(pb.published_dur / 3600, 2) if pb else 0,
            "publish_rate_pct": round((pb.published_count if pb else 0) / ur.uploaded_count * 100, 2) if ur.uploaded_count else 0,
        })
    data.sort(key=lambda x: x["uploaded_count"], reverse=True)
    return ApiResponse(data=data)


@router.post("/channel-breakdown", response_model=ApiResponse)
async def client_channel_breakdown(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Channels within each client with counts."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(DC.Client_ID, DC.Client_Name, DC.Channel_ID, DC.Channel_Name,
               func.count(FI.Fact_Input_ID).label("count"),
               func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"))
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Client_ID, DC.Client_Name, DC.Channel_ID, DC.Channel_Name)
        .order_by(DC.Client_Name, func.count(FI.Fact_Input_ID).desc())
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, dc_joined=True)
    rows = (await db.execute(q)).all()
    data = [{
        "client_id": r.Client_ID, "client_name": r.Client_Name,
        "channel_id": r.Channel_ID, "channel_name": r.Channel_Name,
        "count": r.count, "duration_hours": round(r.dur / 3600, 2),
    } for r in rows]
    return ApiResponse(data=data)


@router.post("/trends", response_model=ApiResponse)
async def client_trends(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Per-client time-series."""
    dd_sub = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month,
                    DD.Quarter, DD.Year).subquery()
    period = granularity_label(body.granularity, dd_sub.c)
    q = (
        select(DC.Client_Name, period,
               func.count(FI.Fact_Input_ID).label("count"),
               func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"))
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Client_Name, "period")
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, dc_joined=True)
    rows = (await db.execute(q)).all()
    data = [{"client": r.Client_Name, "period": str(r.period),
             "count": r.count, "duration_hours": round(r.dur / 3600, 2)} for r in rows]
    return ApiResponse(data=data)


@router.post("/usage-distribution", response_model=ApiResponse)
async def usage_distribution(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Client share of total volume — pie/donut chart data."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(DC.Client_Name,
               func.count(FI.Fact_Input_ID).label("count"),
               func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"))
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Client_Name)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, dc_joined=True)
    rows = (await db.execute(q)).all()

    total_count = sum(r.count for r in rows) or 1
    data = [{"client": r.Client_Name, "count": r.count,
             "duration_hours": round(r.dur / 3600, 2),
             "share_pct": round(r.count / total_count * 100, 2)} for r in rows]
    data.sort(key=lambda x: x["count"], reverse=True)
    return ApiResponse(data=data)
