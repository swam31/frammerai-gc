"""User analytics endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import AnalyticsRequest, ApiResponse, TrendRequest
from app.services.analytics_service import (
    FI, FO, FP, DD, DU,
    apply_date_filter, apply_dimension_filters, granularity_label, build_published_input_subquery,
)

router = APIRouter(prefix="/users", tags=["User Analytics"])


@router.post("/performance", response_model=ApiResponse)
async def user_performance(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Per-user KPIs."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    uq = (
        select(DU.User_ID, DU.User_Name, DU.Team_Name,
               func.count(FI.Fact_Input_ID).label("uploaded_count"),
               func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("uploaded_dur"))
        .join(DU, FI.User_ID == DU.User_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DU.User_ID, DU.User_Name, DU.Team_Name)
    )
    uq = apply_date_filter(uq, dd_sub.c.Full_Date, body.date_range)
    uq = apply_dimension_filters(uq, body.filters, has_fi=True, du_joined=True)
    u_rows = (await db.execute(uq)).all()
    u_map = {r.User_ID: r for r in u_rows}

    pub_sub = build_published_input_subquery(body.date_range, body.filters, dimension="user", date_basis="upload")
    pbq = (
        select(
            pub_sub.c.dimension_id.label("user_id"),
            func.count(pub_sub.c.input_fact_id).label("published_count"),
        )
        .group_by(pub_sub.c.dimension_id)
    )
    pb_rows = (await db.execute(pbq)).all()
    pb_map = {r.user_id: r.published_count for r in pb_rows}

    data = []
    for uid, ur in u_map.items():
        pub = pb_map.get(uid, 0)
        data.append({
            "user_id": uid, "user_name": ur.User_Name, "team_name": ur.Team_Name,
            "uploaded_count": ur.uploaded_count,
            "uploaded_duration_hours": round(ur.uploaded_dur / 3600, 2),
            "published_count": pub,
            "publish_rate_pct": round(pub / ur.uploaded_count * 100, 2) if ur.uploaded_count else 0,
        })
    data.sort(key=lambda x: x["uploaded_count"], reverse=True)
    return ApiResponse(data=data)


@router.post("/activity", response_model=ApiResponse)
async def user_activity(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """User activity over time."""
    dd_sub = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month,
                    DD.Quarter, DD.Year).subquery()
    period = granularity_label(body.granularity, dd_sub.c)
    q = (
        select(DU.User_Name, period,
               func.count(FI.Fact_Input_ID).label("count"))
        .join(DU, FI.User_ID == DU.User_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DU.User_Name, "period")
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, du_joined=True)
    rows = (await db.execute(q)).all()
    data = [{"user": r.User_Name, "period": str(r.period), "count": r.count} for r in rows]
    return ApiResponse(data=data)


@router.post("/ranking", response_model=ApiResponse)
async def user_ranking(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Top contributors by uploaded count."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(DU.User_ID, DU.User_Name, DU.Team_Name,
               func.count(FI.Fact_Input_ID).label("count"),
               func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"))
        .join(DU, FI.User_ID == DU.User_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DU.User_ID, DU.User_Name, DU.Team_Name)
        .order_by(func.count(FI.Fact_Input_ID).desc())
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, du_joined=True)
    rows = (await db.execute(q)).all()
    data = [{"rank": i + 1, "user_id": r.User_ID, "user_name": r.User_Name,
             "team_name": r.Team_Name, "count": r.count,
             "duration_hours": round(r.dur / 3600, 2)} for i, r in enumerate(rows)]
    return ApiResponse(data=data)


@router.post("/underutilized", response_model=ApiResponse)
async def underutilized_users(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Users with high upload but low publish rates."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    uq = (
        select(DU.User_ID, DU.User_Name, DU.Team_Name,
               func.count(FI.Fact_Input_ID).label("uploaded_count"))
        .join(DU, FI.User_ID == DU.User_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DU.User_ID, DU.User_Name, DU.Team_Name)
    )
    uq = apply_date_filter(uq, dd_sub.c.Full_Date, body.date_range)
    uq = apply_dimension_filters(uq, body.filters, has_fi=True, du_joined=True)
    u_rows = (await db.execute(uq)).all()
    u_map = {r.User_ID: r for r in u_rows}

    pub_sub = build_published_input_subquery(body.date_range, body.filters, dimension="user", date_basis="upload")
    pbq = (
        select(
            pub_sub.c.dimension_id.label("user_id"),
            func.count(pub_sub.c.input_fact_id).label("published_count"),
        )
        .group_by(pub_sub.c.dimension_id)
    )
    pb_rows = (await db.execute(pbq)).all()
    pb_map = {r.user_id: r.published_count for r in pb_rows}

    data = []
    for uid, ur in u_map.items():
        pub = pb_map.get(uid, 0)
        rate = round(pub / ur.uploaded_count * 100, 2) if ur.uploaded_count else 0
        if rate < 50:  # flag users with <50% publish rate
            data.append({
                "user_id": uid, "user_name": ur.User_Name, "team_name": ur.Team_Name,
                "uploaded_count": ur.uploaded_count, "published_count": pub,
                "publish_rate_pct": rate,
            })
    data.sort(key=lambda x: x["publish_rate_pct"])
    return ApiResponse(data=data)
