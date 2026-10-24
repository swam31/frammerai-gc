"""Time-series, cumulative, and growth-rate trend endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import (
    TrendRequest, ComparisonRequest, AnalyticsRequest,
    ApiResponse, TrendPoint, Granularity,
)
from app.services.analytics_service import (
    FI, FO, FP, DD,
    apply_date_filter, apply_dimension_filters,
    granularity_label,
)

router = APIRouter(prefix="/trends", tags=["Trends & Time-Series"])


@router.post("/timeseries", response_model=ApiResponse)
async def timeseries(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Day/week/month/quarter/year video counts & total duration."""
    dd_sub = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month,
                    DD.Quarter, DD.Year).subquery("dd")
    period_label = granularity_label(body.granularity, dd_sub.c)

    q = (
        select(
            period_label,
            func.count(FI.Fact_Input_ID).label("count"),
            func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by("period")
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()
    data = [TrendPoint(period=str(r.period), count=r.count,
                       duration_hours=round(r.dur / 3600, 2)).model_dump() for r in rows]
    return ApiResponse(data=data)


@router.post("/processed-timeseries", response_model=ApiResponse)
async def processed_timeseries(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Processed (output) video trends."""
    dd_sub = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month,
                    DD.Quarter, DD.Year).subquery("dd")
    period_label = granularity_label(body.granularity, dd_sub.c)

    q = (
        select(
            period_label,
            func.count(FO.Fact_Output_ID).label("count"),
            func.coalesce(func.extract('epoch', func.sum(FO.Created_Duration)), 0).label("dur"),
        )
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_sub, FO.Create_Date_ID == dd_sub.c.Date_ID)
        .group_by("period")
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()
    data = [TrendPoint(period=str(r.period), count=r.count,
                       duration_hours=round(r.dur / 3600, 2)).model_dump() for r in rows]
    return ApiResponse(data=data)


@router.post("/published-timeseries", response_model=ApiResponse)
async def published_timeseries(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Published video trends."""
    dd_sub = select(
        DD.Date_ID,
        DD.Full_Date,
        DD.Week_Number,
        DD.Month,
        DD.Quarter,
        DD.Year,
    ).subquery("dd")
    period_label = granularity_label(body.granularity, dd_sub.c)

    first_publish_sub = (
        select(
            FO.Fact_Output_ID.label("output_id"),
            func.max(func.extract('epoch', FO.Created_Duration)).label("dur"),
            func.min(FP.Published_Date_ID).label("first_published_date_id"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .group_by(FO.Fact_Output_ID)
    )
    first_publish_sub = apply_dimension_filters(first_publish_sub, body.filters, has_fi=True, has_fp=True)
    first_publish_sub = first_publish_sub.subquery("first_published_outputs")

    q = (
        select(
            period_label,
            func.count(first_publish_sub.c.output_id).label("count"),
            func.coalesce(func.sum(first_publish_sub.c.dur), 0).label("dur"),
        )
        .select_from(first_publish_sub)
        .join(dd_sub, first_publish_sub.c.first_published_date_id == dd_sub.c.Date_ID)
        .group_by("period")
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    rows = (await db.execute(q)).all()
    data = [TrendPoint(period=str(r.period), count=r.count,
                       duration_hours=round(r.dur / 3600, 2)).model_dump() for r in rows]
    return ApiResponse(data=data)


@router.post("/comparison", response_model=ApiResponse)
async def trend_comparison(body: ComparisonRequest, db: AsyncSession = Depends(get_db)):
    """Overlay current vs previous period uploaded counts (daily grain)."""
    async def _get_series(dr):
        dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
        q = (
            select(
                func.to_char(dd_sub.c.Full_Date, 'YYYY-MM-DD').label("period"),
                func.count(FI.Fact_Input_ID).label("count"),
                func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"),
            )
            .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
            .group_by("period").order_by("period")
        )
        q = apply_date_filter(q, dd_sub.c.Full_Date, dr)
        q = apply_dimension_filters(q, body.filters, has_fi=True)
        return (await db.execute(q)).all()

    current = await _get_series(body.date_range.current)
    result = {"current": [{"period": str(r.period), "count": r.count,
                           "duration_hours": round(r.dur / 3600, 2)} for r in current]}
    if body.date_range.previous:
        previous = await _get_series(body.date_range.previous)
        result["previous"] = [{"period": str(r.period), "count": r.count,
                               "duration_hours": round(r.dur / 3600, 2)} for r in previous]
    return ApiResponse(data=result)


@router.post("/cumulative", response_model=ApiResponse)
async def cumulative(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Running total of uploaded video count & duration."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(
            func.to_char(dd_sub.c.Full_Date, 'YYYY-MM-DD').label("period"),
            func.count(FI.Fact_Input_ID).label("count"),
            func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(dd_sub.c.Full_Date)
        .order_by(dd_sub.c.Full_Date)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()

    cumulative_data = []
    running_count = 0
    running_dur = 0
    for r in rows:
        running_count += r.count
        running_dur += r.dur
        cumulative_data.append({
            "period": str(r.period),
            "cumulative_count": running_count,
            "cumulative_duration_hours": round(running_dur / 3600, 2),
        })
    return ApiResponse(data=cumulative_data)


@router.post("/growth-rate", response_model=ApiResponse)
async def growth_rate(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Period-over-period growth % in uploaded video count."""
    dd_sub = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month,
                    DD.Quarter, DD.Year).subquery()
    period_label = granularity_label(body.granularity, dd_sub.c)

    q = (
        select(
            period_label,
            func.count(FI.Fact_Input_ID).label("count"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by("period")
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()

    growth = []
    for i, r in enumerate(rows):
        if i == 0:
            growth.append({"period": str(r.period), "count": r.count, "growth_pct": None})
        else:
            prev_count = rows[i - 1].count
            pct = round((r.count - prev_count) / prev_count * 100, 2) if prev_count else None
            growth.append({"period": str(r.period), "count": r.count, "growth_pct": pct})
    return ApiResponse(data=growth)
