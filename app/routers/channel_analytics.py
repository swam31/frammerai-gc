"""Channel analytics endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import AnalyticsRequest, ApiResponse, TrendRequest, Granularity
from app.services.analytics_service import (
    FI, FO, FP, DD, DC,
    apply_date_filter, apply_dimension_filters, granularity_label,
    build_processed_input_subquery, build_published_input_subquery,
)

router = APIRouter(prefix="/channels", tags=["Channel Analytics"])


@router.post("/performance", response_model=ApiResponse)
async def channel_performance(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Per-channel KPIs: uploaded, processed, published counts & durations."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    # Uploaded
    uq = (
        select(
            DC.Channel_ID, DC.Channel_Name, DC.Client_Name,
            func.count(FI.Fact_Input_ID).label("uploaded_count"),
            func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("uploaded_dur"),
        )
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Channel_ID, DC.Channel_Name, DC.Client_Name)
    )
    uq = apply_date_filter(uq, dd_sub.c.Full_Date, body.date_range)
    uq = apply_dimension_filters(uq, body.filters, has_fi=True, dc_joined=True)
    u_rows = (await db.execute(uq)).all()
    u_map = {r.Channel_ID: r for r in u_rows}

    # Processed
    proc_sub = build_processed_input_subquery(body.date_range, body.filters, dimension="channel", date_basis="upload")
    pq = (
        select(
            proc_sub.c.dimension_id.label("channel_id"),
            func.count(proc_sub.c.input_fact_id).label("processed_count"),
            func.coalesce(func.sum(proc_sub.c.uploaded_duration_seconds), 0).label("processed_dur"),
        )
        .group_by(proc_sub.c.dimension_id)
    )
    p_rows = (await db.execute(pq)).all()
    p_map = {r.channel_id: r for r in p_rows}

    # Published
    pub_sub = build_published_input_subquery(body.date_range, body.filters, dimension="channel", date_basis="upload")
    pbq = (
        select(
            pub_sub.c.dimension_id.label("channel_id"),
            func.count(pub_sub.c.input_fact_id).label("published_count"),
            func.coalesce(func.sum(pub_sub.c.uploaded_duration_seconds), 0).label("published_dur"),
        )
        .group_by(pub_sub.c.dimension_id)
    )
    pb_rows = (await db.execute(pbq)).all()
    pb_map = {r.channel_id: r for r in pb_rows}

    data = []
    for cid, ur in u_map.items():
        pr = p_map.get(cid)
        pb = pb_map.get(cid)
        data.append({
            "channel_id": cid,
            "channel_name": ur.Channel_Name,
            "client_name": ur.Client_Name,
            "uploaded_count": ur.uploaded_count,
            "uploaded_duration_hours": round(ur.uploaded_dur / 3600, 2),
            "processed_count": pr.processed_count if pr else 0,
            "processed_duration_hours": round(pr.processed_dur / 3600, 2) if pr else 0,
            "published_count": pb.published_count if pb else 0,
            "published_duration_hours": round(pb.published_dur / 3600, 2) if pb else 0,
            "publish_rate_pct": round((pb.published_count if pb else 0) / ur.uploaded_count * 100, 2) if ur.uploaded_count else 0,
        })
    data.sort(key=lambda x: x["uploaded_count"], reverse=True)
    return ApiResponse(data=data)


@router.post("/comparison", response_model=ApiResponse)
async def channel_comparison(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Compare selected channels side-by-side (pass channel_ids in filters)."""
    return await channel_performance(body, db)


@router.post("/trends", response_model=ApiResponse)
async def channel_trends(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Per-channel time-series of uploaded video counts."""
    dd_sub = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month,
                    DD.Quarter, DD.Year).subquery()
    period = granularity_label(body.granularity, dd_sub.c)

    q = (
        select(
            DC.Channel_Name,
            period,
            func.count(FI.Fact_Input_ID).label("count"),
            func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Channel_Name, "period")
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, dc_joined=True)
    rows = (await db.execute(q)).all()

    data = [{"channel": r.Channel_Name, "period": str(r.period),
             "count": r.count, "duration_hours": round(r.dur / 3600, 2)} for r in rows]
    return ApiResponse(data=data)


@router.post("/ranking", response_model=ApiResponse)
async def channel_ranking(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Channels ranked by total uploaded count (descending)."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    q = (
        select(
            DC.Channel_ID, DC.Channel_Name,
            func.count(FI.Fact_Input_ID).label("count"),
            func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Channel_ID, DC.Channel_Name)
        .order_by(func.count(FI.Fact_Input_ID).desc())
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, dc_joined=True)
    rows = (await db.execute(q)).all()
    data = [{"rank": i + 1, "channel_id": r.Channel_ID, "channel_name": r.Channel_Name,
             "count": r.count, "duration_hours": round(r.dur / 3600, 2)} for i, r in enumerate(rows)]
    return ApiResponse(data=data)
