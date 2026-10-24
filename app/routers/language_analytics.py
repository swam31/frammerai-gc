"""Language analytics endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import AnalyticsRequest, ApiResponse, TrendRequest
from app.services.analytics_service import (
    FI, DD, DC, DL,
    apply_date_filter, apply_dimension_filters, granularity_label,
)

router = APIRouter(prefix="/languages", tags=["Language Analytics"])


@router.post("/distribution", response_model=ApiResponse)
async def language_distribution(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Language-wise counts & durations."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(DL.Language_ID, DL.Language_Name,
               func.count(FI.Fact_Input_ID).label("count"),
               func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"))
        .join(DL, FI.Language_ID == DL.Language_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DL.Language_ID, DL.Language_Name)
        .order_by(func.count(FI.Fact_Input_ID).desc())
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()
    total = sum(r.count for r in rows) or 1
    data = [{
        "language_id": r.Language_ID, "language": r.Language_Name,
        "count": r.count, "duration_hours": round(r.dur / 3600, 2),
        "share_pct": round(r.count / total * 100, 2),
    } for r in rows]
    return ApiResponse(data=data)


@router.post("/trends", response_model=ApiResponse)
async def language_trends(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Language growth over time."""
    dd_sub = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month,
                    DD.Quarter, DD.Year).subquery()
    period = granularity_label(body.granularity, dd_sub.c)
    q = (
        select(DL.Language_Name, period,
               func.count(FI.Fact_Input_ID).label("count"))
        .join(DL, FI.Language_ID == DL.Language_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DL.Language_Name, "period")
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()
    data = [{"language": r.Language_Name, "period": str(r.period),
             "count": r.count} for r in rows]
    return ApiResponse(data=data)


@router.post("/by-channel", response_model=ApiResponse)
async def language_by_channel(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Language × channel matrix."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(DC.Channel_Name, DL.Language_Name,
               func.count(FI.Fact_Input_ID).label("count"),
               func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"))
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(DL, FI.Language_ID == DL.Language_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Channel_Name, DL.Language_Name)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, dc_joined=True)
    rows = (await db.execute(q)).all()
    data = [{"channel": r.Channel_Name, "language": r.Language_Name,
             "count": r.count, "duration_hours": round(r.dur / 3600, 2)} for r in rows]
    return ApiResponse(data=data)
