"""Team analytics endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import AnalyticsRequest, ApiResponse
from app.services.analytics_service import (
    FI, FO, FP, DD, DU,
    apply_date_filter, apply_dimension_filters, build_published_input_subquery,
)

router = APIRouter(prefix="/teams", tags=["Team Analytics"])


@router.post("/performance", response_model=ApiResponse)
async def team_performance(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Per-team KPIs."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    uq = (
        select(DU.Team_ID, DU.Team_Name,
               func.count(FI.Fact_Input_ID).label("uploaded_count"),
               func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("uploaded_dur"))
        .join(DU, FI.User_ID == DU.User_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DU.Team_ID, DU.Team_Name)
    )
    uq = apply_date_filter(uq, dd_sub.c.Full_Date, body.date_range)
    uq = apply_dimension_filters(uq, body.filters, has_fi=True, du_joined=True)
    u_rows = (await db.execute(uq)).all()
    u_map = {r.Team_ID: r for r in u_rows}

    pub_sub = build_published_input_subquery(body.date_range, body.filters, dimension="team", date_basis="upload")
    pbq = (
        select(
            pub_sub.c.dimension_id.label("team_id"),
            func.count(pub_sub.c.input_fact_id).label("published_count"),
            func.coalesce(func.sum(pub_sub.c.uploaded_duration_seconds), 0).label("published_dur"),
        )
        .group_by(pub_sub.c.dimension_id)
    )
    pb_rows = (await db.execute(pbq)).all()
    pb_map = {r.team_id: r for r in pb_rows}

    data = []
    for tid, ur in u_map.items():
        pb = pb_map.get(tid)
        data.append({
            "team_id": tid, "team_name": ur.Team_Name,
            "uploaded_count": ur.uploaded_count,
            "uploaded_duration_hours": round(ur.uploaded_dur / 3600, 2),
            "published_count": pb.published_count if pb else 0,
            "published_duration_hours": round(pb.published_dur / 3600, 2) if pb else 0,
            "publish_rate_pct": round((pb.published_count if pb else 0) / ur.uploaded_count * 100, 2) if ur.uploaded_count else 0,
        })
    data.sort(key=lambda x: x["uploaded_count"], reverse=True)
    return ApiResponse(data=data)


@router.post("/comparison", response_model=ApiResponse)
async def team_comparison(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Team vs team — same as performance (filter team_ids for comparison)."""
    return await team_performance(body, db)


@router.post("/member-breakdown", response_model=ApiResponse)
async def team_member_breakdown(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Users within each team with counts."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(DU.Team_ID, DU.Team_Name, DU.User_ID, DU.User_Name,
               func.count(FI.Fact_Input_ID).label("count"),
               func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"))
        .join(DU, FI.User_ID == DU.User_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DU.Team_ID, DU.Team_Name, DU.User_ID, DU.User_Name)
        .order_by(DU.Team_Name, func.count(FI.Fact_Input_ID).desc())
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, du_joined=True)
    rows = (await db.execute(q)).all()
    data = [{
        "team_id": r.Team_ID, "team_name": r.Team_Name,
        "user_id": r.User_ID, "user_name": r.User_Name,
        "count": r.count, "duration_hours": round(r.dur / 3600, 2),
    } for r in rows]
    return ApiResponse(data=data)
