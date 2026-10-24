"""Platform analytics endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import AnalyticsRequest, ApiResponse, TrendRequest
from app.services.analytics_service import (
    FI, FO, FP, DD, DP, DOT,
    apply_date_filter, apply_dimension_filters, granularity_label,
)

router = APIRouter(prefix="/platforms", tags=["Platform Analytics"])


@router.post("/distribution", response_model=ApiResponse)
async def platform_distribution(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Platform-wise publish counts & durations."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(DP.Platform_ID, DP.Platform_Name,
               func.count(FP.Fact_Publish_ID).label("count"),
               func.coalesce(func.extract('epoch', func.sum(FP.Published_Duration)), 0).label("dur"))
        .join(DP, FP.Platform_ID == DP.Platform_ID)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_sub, FP.Published_Date_ID == dd_sub.c.Date_ID)
        .group_by(DP.Platform_ID, DP.Platform_Name)
        .order_by(func.count(FP.Fact_Publish_ID).desc())
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, has_fo=True, has_fp=True)
    rows = (await db.execute(q)).all()
    total = sum(r.count for r in rows) or 1
    data = [{
        "platform_id": r.Platform_ID, "platform": r.Platform_Name,
        "count": r.count, "duration_hours": round(r.dur / 3600, 2),
        "share_pct": round(r.count / total * 100, 2),
    } for r in rows]
    return ApiResponse(data=data)


@router.post("/trends", response_model=ApiResponse)
async def platform_trends(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Platform publish trends."""
    dd_sub = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month,
                    DD.Quarter, DD.Year).subquery()
    period = granularity_label(body.granularity, dd_sub.c)
    q = (
        select(DP.Platform_Name, period,
               func.count(FP.Fact_Publish_ID).label("count"))
        .join(DP, FP.Platform_ID == DP.Platform_ID)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_sub, FP.Published_Date_ID == dd_sub.c.Date_ID)
        .group_by(DP.Platform_Name, "period")
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, has_fp=True)
    rows = (await db.execute(q)).all()
    data = [{"platform": r.Platform_Name, "period": str(r.period),
             "count": r.count} for r in rows]
    return ApiResponse(data=data)


@router.post("/by-type", response_model=ApiResponse)
async def platform_by_type(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Platform × output type matrix."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(DP.Platform_Name, DOT.Output_Type,
               func.count(FP.Fact_Publish_ID).label("count"),
               func.coalesce(func.extract('epoch', func.sum(FP.Published_Duration)), 0).label("dur"))
        .join(DP, FP.Platform_ID == DP.Platform_ID)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DOT, FO.Output_Type_ID == DOT.Output_Type_ID)
        .join(dd_sub, FP.Published_Date_ID == dd_sub.c.Date_ID)
        .group_by(DP.Platform_Name, DOT.Output_Type)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, has_fp=True)
    rows = (await db.execute(q)).all()
    data = [{"platform": r.Platform_Name, "output_type": r.Output_Type,
             "count": r.count, "duration_hours": round(r.dur / 3600, 2)} for r in rows]
    return ApiResponse(data=data)
