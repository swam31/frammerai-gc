"""Video-level detail / explorer endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import get_db
from app.schemas.common import ApiResponse, VideoSearchRequest, VideoDetailItem
from app.services.analytics_service import (
    FI, FO, FP, DD, DC, DU, DIV, DOV, DIT, DOT, DL, DP,
    apply_date_filter, apply_dimension_filters, build_published_input_subquery,
)

router = APIRouter(prefix="/videos", tags=["Video Explorer"])


def _build_video_query():
    """Base query joining all tables for full video detail."""
    upload_dd = select(DD.Date_ID, DD.Full_Date).subquery("upload_dd")
    create_dd = select(DD.Date_ID, DD.Full_Date).subquery("create_dd")
    pub_dd = select(DD.Date_ID, DD.Full_Date).subquery("pub_dd")

    q = (
        select(
            FI.Fact_Input_ID,
            DIV.Input_Video_ID,
            DIV.Headline.label("headline"),
            DIV.Source_Name.label("source_name"),
            DIV.Source_URL.label("source_url"),
            DC.Channel_Name.label("channel_name"),
            DC.Client_Name.label("client_name"),
            DU.User_Name.label("user_name"),
            DU.Team_Name.label("team_name"),
            DL.Language_Name.label("language"),
            DIT.Input_Type.label("input_type"),
            DOT.Output_Type.label("output_type"),
            func.extract('epoch', FI.Uploaded_Duration).label("uploaded_duration_seconds"),
            upload_dd.c.Full_Date.label("upload_date"),
            FO.Fact_Output_ID,
            DOV.Output_Video_ID.label("output_video_id"),
            DOV.Headline.label("output_headline"),
            func.extract('epoch', FO.Created_Duration).label("created_duration_seconds"),
            create_dd.c.Full_Date.label("create_date"),
            FP.Fact_Publish_ID,
            DP.Platform_Name.label("published_platform"),
            FP.Published_URL.label("published_url"),
            pub_dd.c.Full_Date.label("published_date"),
            func.extract('epoch', FP.Published_Duration).label("published_duration_seconds"),
            FP.Is_Billable.label("is_billable"),
        )
        .join(DIV, FI.Input_Video_ID == DIV.Input_Video_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(DU, FI.User_ID == DU.User_ID)
        .join(DL, FI.Language_ID == DL.Language_ID)
        .join(DIT, FI.Input_Type_ID == DIT.Input_Type_ID)
        .join(DOT, FI.Output_Type_ID == DOT.Output_Type_ID)
        .join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
        .outerjoin(FO, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .outerjoin(DOV, FO.Output_Video_ID == DOV.Output_Video_ID)
        .outerjoin(create_dd, FO.Create_Date_ID == create_dd.c.Date_ID)
        .outerjoin(FP, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .outerjoin(DP, FP.Platform_ID == DP.Platform_ID)
        .outerjoin(pub_dd, FP.Published_Date_ID == pub_dd.c.Date_ID)
    )
    return q, upload_dd


@router.post("/search", response_model=ApiResponse)
async def search_videos(body: VideoSearchRequest, db: AsyncSession = Depends(get_db)):
    """Full-text search + filter + paginate video details."""
    q, upload_dd = _build_video_query()

    # Date filter
    q = apply_date_filter(q, upload_dd.c.Full_Date, body.date_range)

    # Dimension filters
    q = apply_dimension_filters(q, body.filters, has_fi=True, has_fp=True,
                                dc_joined=True, du_joined=True)

    # Text search
    if body.search_query:
        pattern = f"%{body.search_query}%"
        q = q.where(or_(
            DIV.Headline.ilike(pattern),
            DIV.Source_Name.ilike(pattern),
            DOV.Headline.ilike(pattern),
        ))

    # Published filter
    if body.published_only is True:
        q = q.where(FP.Fact_Publish_ID.isnot(None))
    elif body.published_only is False:
        q = q.where(FP.Fact_Publish_ID.is_(None))

    # Count total
    from sqlalchemy import text as sa_text
    count_sub = q.subquery()
    count_q = select(func.count()).select_from(count_sub)
    total = (await db.execute(count_q)).scalar() or 0

    # Sort
    sort_map = {
        "upload_date": upload_dd.c.Full_Date,
        "headline": DIV.Headline,
        "duration": FI.Uploaded_Duration,
        "channel": DC.Channel_Name,
    }
    sort_col = sort_map.get(body.sort_by, upload_dd.c.Full_Date)
    if body.sort_order.value == "desc":
        q = q.order_by(sort_col.desc())
    else:
        q = q.order_by(sort_col.asc())

    # Paginate
    q = q.offset(body.pagination.offset).limit(body.pagination.page_size)
    rows = (await db.execute(q)).all()

    items = []
    for r in rows:
        items.append({
            "input_video_id": r.Input_Video_ID,
            "headline": r.headline,
            "source_name": r.source_name,
            "source_url": r.source_url,
            "channel_name": r.channel_name,
            "client_name": r.client_name,
            "user_name": r.user_name,
            "team_name": r.team_name,
            "language": r.language,
            "input_type": r.input_type,
            "output_type": r.output_type,
            "uploaded_duration_seconds": r.uploaded_duration_seconds,
            "upload_date": str(r.upload_date) if r.upload_date else None,
            "output_video_id": r.output_video_id,
            "output_headline": r.output_headline,
            "created_duration_seconds": r.created_duration_seconds,
            "create_date": str(r.create_date) if r.create_date else None,
            "is_published": r.Fact_Publish_ID is not None,
            "published_platform": r.published_platform,
            "published_url": r.published_url,
            "published_date": str(r.published_date) if r.published_date else None,
            "published_duration_seconds": r.published_duration_seconds,
            "is_billable": r.is_billable,
        })

    total_pages = (total + body.pagination.page_size - 1) // body.pagination.page_size
    return ApiResponse(data={
        "items": items,
        "total": total,
        "page": body.pagination.page,
        "page_size": body.pagination.page_size,
        "total_pages": total_pages,
    })


@router.get("/detail/{input_video_id}", response_model=ApiResponse)
async def video_detail(input_video_id: str, db: AsyncSession = Depends(get_db)):
    """Full lifecycle of a single input video."""
    q, _ = _build_video_query()
    q = q.where(DIV.Input_Video_ID == input_video_id)
    rows = (await db.execute(q)).all()
    if not rows:
        return ApiResponse(success=False, message="Video not found")

    items = []
    for r in rows:
        items.append({
            "input_video_id": r.Input_Video_ID,
            "headline": r.headline,
            "source_name": r.source_name,
            "source_url": r.source_url,
            "channel_name": r.channel_name,
            "client_name": r.client_name,
            "user_name": r.user_name,
            "team_name": r.team_name,
            "language": r.language,
            "input_type": r.input_type,
            "output_type": r.output_type,
            "uploaded_duration_seconds": r.uploaded_duration_seconds,
            "upload_date": str(r.upload_date) if r.upload_date else None,
            "output_video_id": r.output_video_id,
            "output_headline": r.output_headline,
            "created_duration_seconds": r.created_duration_seconds,
            "create_date": str(r.create_date) if r.create_date else None,
            "is_published": r.Fact_Publish_ID is not None,
            "published_platform": r.published_platform,
            "published_url": r.published_url,
            "published_date": str(r.published_date) if r.published_date else None,
            "published_duration_seconds": r.published_duration_seconds,
            "is_billable": r.is_billable,
        })
    return ApiResponse(data=items)


@router.post("/export", response_model=ApiResponse)
async def export_videos(body: VideoSearchRequest, db: AsyncSession = Depends(get_db)):
    """Export-ready flat data (no pagination, up to 10 000 rows)."""
    body.pagination.page = 1
    body.pagination.page_size = 500
    # Override to get large dataset
    q, upload_dd = _build_video_query()
    q = apply_date_filter(q, upload_dd.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, has_fp=True,
                                dc_joined=True, du_joined=True)
    if body.search_query:
        pattern = f"%{body.search_query}%"
        q = q.where(or_(DIV.Headline.ilike(pattern), DIV.Source_Name.ilike(pattern)))
    if body.published_only is True:
        q = q.where(FP.Fact_Publish_ID.isnot(None))
    elif body.published_only is False:
        q = q.where(FP.Fact_Publish_ID.is_(None))

    q = q.order_by(upload_dd.c.Full_Date.desc()).limit(10000)
    rows = (await db.execute(q)).all()

    items = []
    for r in rows:
        items.append({
            "input_video_id": r.Input_Video_ID,
            "headline": r.headline,
            "source_name": r.source_name,
            "channel_name": r.channel_name,
            "client_name": r.client_name,
            "user_name": r.user_name,
            "team_name": r.team_name,
            "language": r.language,
            "input_type": r.input_type,
            "output_type": r.output_type,
            "uploaded_duration_seconds": r.uploaded_duration_seconds,
            "upload_date": str(r.upload_date) if r.upload_date else None,
            "is_published": r.Fact_Publish_ID is not None,
            "published_platform": r.published_platform,
            "published_url": r.published_url,
            "published_date": str(r.published_date) if r.published_date else None,
            "is_billable": r.is_billable,
        })
    return ApiResponse(data=items, meta={"total_exported": len(items)})


@router.post("/bulk-stats", response_model=ApiResponse)
async def bulk_stats(body: VideoSearchRequest, db: AsyncSession = Depends(get_db)):
    """Aggregate stats for the current filtered video set."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    q = (
        select(
            func.count(FI.Fact_Input_ID).label("total_uploaded"),
            func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("total_dur"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    r = (await db.execute(q)).one()

    # Published count
    pub_sub = build_published_input_subquery(body.date_range, body.filters, date_basis="upload")
    pub_q = select(func.count(pub_sub.c.input_fact_id).label("pub_c"))
    pub_r = (await db.execute(pub_q)).one()

    total = r.total_uploaded or 0
    published = pub_r.pub_c or 0

    return ApiResponse(data={
        "total_videos": total,
        "total_duration_hours": round(r.total_dur / 3600, 2),
        "published_count": published,
        "publish_rate_pct": round(published / total * 100, 2) if total else 0,
    })

