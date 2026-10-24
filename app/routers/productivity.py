"""Productivity, efficiency, and velocity analytics endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import (
    AnalyticsRequest, TrendRequest, ApiResponse,
    UserProductivity, TeamEfficiency, PipelineVelocityPoint, PlatformReachItem,
)
from app.services.analytics_service import (
    FI, FO, FP, DD, DC, DU, DP,
    apply_date_filter, apply_dimension_filters,
    granularity_label, build_processed_input_subquery, build_published_output_subquery,
)

router = APIRouter(prefix="/productivity", tags=["Productivity & Efficiency"])


@router.post("/user-efficiency", response_model=ApiResponse)
async def user_efficiency(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Per-user productivity metrics with composite score."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    # Uploads per user
    up_q = (
        select(
            DU.User_ID, DU.User_Name, DU.Team_Name,
            func.count(FI.Fact_Input_ID).label("uploads"),
            func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("up_dur"),
        )
        .join(DU, FI.User_ID == DU.User_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DU.User_ID, DU.User_Name, DU.Team_Name)
    )
    up_q = apply_date_filter(up_q, dd_sub.c.Full_Date, body.date_range)
    up_q = apply_dimension_filters(up_q, body.filters, has_fi=True, du_joined=True)
    up_rows = (await db.execute(up_q)).all()
    up_map = {r.User_ID: r for r in up_rows}

    # Outputs per user
    out_q = (
        select(
            FI.User_ID,
            func.count(FO.Fact_Output_ID).label("outputs"),
            func.coalesce(func.extract('epoch', func.sum(FO.Created_Duration)), 0).label("out_dur"),
        )
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_sub, FO.Create_Date_ID == dd_sub.c.Date_ID)
        .group_by(FI.User_ID)
    )
    out_q = apply_date_filter(out_q, dd_sub.c.Full_Date, body.date_range)
    out_rows = (await db.execute(out_q)).all()
    out_map = {r.User_ID: r for r in out_rows}

    # Published per user
    pub_sub = build_published_output_subquery(body.date_range, body.filters, dimension="user")
    pub_q = (
        select(
            pub_sub.c.dimension_id.label("user_id"),
            func.count(pub_sub.c.output_id).label("published"),
        )
        .group_by(pub_sub.c.dimension_id)
    )
    pub_rows = (await db.execute(pub_q)).all()
    pub_map = {r.user_id: r.published for r in pub_rows}

    items = []
    for uid, ur in up_map.items():
        outr = out_map.get(uid)
        outputs = outr.outputs if outr else 0
        published = pub_map.get(uid, 0)
        clips_per = round(outputs / ur.uploads, 2) if ur.uploads else 0.0
        pub_rate = round(published / outputs * 100, 2) if outputs else 0.0
        # Productivity score: weighted combo of volume, clip rate, and publish rate
        score = round(
            (ur.uploads * 0.3) + (clips_per * 20) + (pub_rate * 0.5), 1
        )
        items.append(UserProductivity(
            user_id=uid,
            user_name=ur.User_Name,
            team_name=ur.Team_Name,
            uploads=ur.uploads,
            outputs=outputs,
            published=published,
            clips_per_upload=clips_per,
            publish_rate_pct=pub_rate,
            total_input_hours=round(ur.up_dur / 3600, 2),
            total_output_hours=round((outr.out_dur if outr else 0) / 3600, 2),
            productivity_score=score,
        ).model_dump())
    items.sort(key=lambda x: x["productivity_score"], reverse=True)
    return ApiResponse(data=items)


@router.post("/team-efficiency", response_model=ApiResponse)
async def team_efficiency(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Per-team efficiency metrics with composite score."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    # Team uploads
    up_q = (
        select(
            DU.Team_ID, DU.Team_Name,
            func.count(FI.Fact_Input_ID).label("uploads"),
            func.count(distinct(DU.User_ID)).label("members"),
        )
        .join(DU, FI.User_ID == DU.User_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DU.Team_ID, DU.Team_Name)
    )
    up_q = apply_date_filter(up_q, dd_sub.c.Full_Date, body.date_range)
    up_q = apply_dimension_filters(up_q, body.filters, has_fi=True, du_joined=True)
    up_rows = (await db.execute(up_q)).all()
    up_map = {r.Team_ID: r for r in up_rows}

    # Team outputs
    out_q = (
        select(
            DU.Team_ID,
            func.count(FO.Fact_Output_ID).label("outputs"),
        )
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DU, FI.User_ID == DU.User_ID)
        .join(dd_sub, FO.Create_Date_ID == dd_sub.c.Date_ID)
        .group_by(DU.Team_ID)
    )
    out_q = apply_date_filter(out_q, dd_sub.c.Full_Date, body.date_range)
    out_rows = (await db.execute(out_q)).all()
    out_map = {r.Team_ID: r.outputs for r in out_rows}

    # Team published
    pub_sub = build_published_output_subquery(body.date_range, body.filters, dimension="team")
    pub_q = (
        select(
            pub_sub.c.dimension_id.label("team_id"),
            func.count(pub_sub.c.output_id).label("published"),
        )
        .group_by(pub_sub.c.dimension_id)
    )
    pub_rows = (await db.execute(pub_q)).all()
    pub_map = {r.team_id: r.published for r in pub_rows}

    items = []
    for tid, ur in up_map.items():
        outputs = out_map.get(tid, 0)
        published = pub_map.get(tid, 0)
        clips_per = round(outputs / ur.uploads, 2) if ur.uploads else 0.0
        pub_rate = round(published / outputs * 100, 2) if outputs else 0.0
        ups_per_member = round(ur.uploads / ur.members, 1) if ur.members else 0.0
        score = round(
            (ups_per_member * 0.4) + (clips_per * 15) + (pub_rate * 0.45), 1
        )
        items.append(TeamEfficiency(
            team_id=tid,
            team_name=ur.Team_Name,
            member_count=ur.members,
            uploads=ur.uploads,
            outputs=outputs,
            published=published,
            uploads_per_member=ups_per_member,
            clips_per_upload=clips_per,
            publish_rate_pct=pub_rate,
            efficiency_score=score,
        ).model_dump())
    items.sort(key=lambda x: x["efficiency_score"], reverse=True)
    return ApiResponse(data=items)


@router.post("/pipeline-velocity", response_model=ApiResponse)
async def pipeline_velocity(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Pipeline velocity over time — avg days between stages per period."""
    dd_up = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month,
                   DD.Quarter, DD.Year).subquery("dd_up")
    dd_cr = select(DD.Date_ID, DD.Full_Date).subquery("dd_cr")
    dd_pb = select(DD.Date_ID, DD.Full_Date).subquery("dd_pb")

    period_label = granularity_label(body.granularity, dd_up.c)

    # Upload-to-process velocity per period uses source-video grain.
    processed_input_sub = build_processed_input_subquery(body.date_range, body.filters, date_basis="upload")
    vel_q = (
        select(
            period_label,
            func.avg(
                func.greatest(
                    func.extract('epoch', dd_cr.c.Full_Date) - func.extract('epoch', dd_up.c.Full_Date),
                    0,
                )
            ).label("avg_up_to_proc"),
            func.coalesce(func.sum(processed_input_sub.c.output_count), 0).label("throughput"),
        )
        .select_from(processed_input_sub)
        .join(dd_up, processed_input_sub.c.upload_date_id == dd_up.c.Date_ID)
        .join(dd_cr, processed_input_sub.c.first_create_date_id == dd_cr.c.Date_ID)
        .group_by("period")
        .order_by("period")
    )
    vel_rows = (await db.execute(vel_q)).all()
    vel_map = {str(r.period): r for r in vel_rows}

    # Process-to-publish velocity per period uses output grain and first publish.
    published_output_sub = build_published_output_subquery(body.date_range, body.filters)
    pub_vel_q = (
        select(
            period_label,
            func.avg(
                func.greatest(
                    func.extract('epoch', dd_pb.c.Full_Date) - func.extract('epoch', dd_cr.c.Full_Date),
                    0,
                )
            ).label("avg_proc_to_pub"),
        )
        .select_from(published_output_sub)
        .join(dd_up, published_output_sub.c.upload_date_id == dd_up.c.Date_ID)
        .join(dd_cr, published_output_sub.c.create_date_id == dd_cr.c.Date_ID)
        .join(dd_pb, published_output_sub.c.first_published_date_id == dd_pb.c.Date_ID)
        .group_by("period")
        .order_by("period")
    )
    pub_vel_rows = (await db.execute(pub_vel_q)).all()
    pub_vel_map = {str(r.period): r for r in pub_vel_rows}

    data = []
    for period, vr in vel_map.items():
        pvr = pub_vel_map.get(period)
        up2proc = round(float(vr.avg_up_to_proc or 0) / 86400, 1)
        proc2pub = round(float(pvr.avg_proc_to_pub or 0) / 86400, 1) if pvr else 0.0
        data.append(PipelineVelocityPoint(
            period=period,
            avg_days_upload_to_process=up2proc,
            avg_days_process_to_publish=proc2pub,
            avg_days_end_to_end=round(up2proc + proc2pub, 1),
            throughput_count=vr.throughput,
        ).model_dump())
    return ApiResponse(data=data)


@router.post("/platform-reach", response_model=ApiResponse)
async def platform_reach(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Multi-platform reach per channel — how many platforms each channel publishes to."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    q = (
        select(
            DC.Channel_ID.label("eid"),
            DC.Channel_Name.label("ename"),
            func.count(FP.Fact_Publish_ID).label("total_pub"),
            func.count(distinct(FP.Platform_ID)).label("plat_cnt"),
            func.array_agg(distinct(DP.Platform_Name)).label("plat_names"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(DP, FP.Platform_ID == DP.Platform_ID)
        .join(dd_sub, FP.Published_Date_ID == dd_sub.c.Date_ID)
        .group_by(DC.Channel_ID, DC.Channel_Name)
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True, has_fp=True, dc_joined=True)
    rows = (await db.execute(q)).all()

    total_platforms = (await db.execute(select(func.count(DP.Platform_ID)))).scalar() or 1

    items = []
    for r in rows:
        items.append(PlatformReachItem(
            entity_id=r.eid,
            entity_name=r.ename,
            total_published=r.total_pub,
            platforms_used=r.plat_cnt,
            platform_names=r.plat_names or [],
            reach_score=round(r.plat_cnt / total_platforms * 100, 1),
        ).model_dump())
    items.sort(key=lambda x: x["reach_score"], reverse=True)
    return ApiResponse(data=items)
