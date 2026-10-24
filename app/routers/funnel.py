"""Publishing funnel & conversion endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import (
    AnalyticsRequest, ApiResponse, FunnelStage, FunnelDimensionItem,
    DimensionEnum, TopNRequest,
)
from app.services.analytics_service import (
    FI, FO, FP, DD, DC, DU, DIT, DOT, DL,
    apply_date_filter, apply_dimension_filters, get_dimension_cols,
    build_processed_input_subquery, build_published_input_subquery,
)

router = APIRouter(prefix="/funnel", tags=["Publishing Funnel"])


@router.post("/overview", response_model=ApiResponse)
async def funnel_overview(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Uploaded → Processed → Published funnel with counts, durations, drop-off %."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    # Uploaded
    uq = (select(func.count(FI.Fact_Input_ID).label("c"),
                 func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("d"))
          .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID))
    uq = apply_date_filter(uq, dd_sub.c.Full_Date, body.date_range)
    uq = apply_dimension_filters(uq, body.filters, has_fi=True)
    u = (await db.execute(uq)).one()

    # Processed inputs (uploads that produced at least one output)
    proc_sub = build_processed_input_subquery(body.date_range, body.filters, date_basis="upload")
    pq = select(
        func.count(proc_sub.c.input_fact_id).label("c"),
        func.coalesce(func.sum(proc_sub.c.uploaded_duration_seconds), 0).label("d"),
    )
    p = (await db.execute(pq)).one()

    # Published inputs (uploads that produced at least one published output)
    pb_sub = build_published_input_subquery(body.date_range, body.filters, date_basis="upload")
    pbq = select(
        func.count(pb_sub.c.input_fact_id).label("c"),
        func.coalesce(func.sum(pb_sub.c.uploaded_duration_seconds), 0).label("d"),
    )
    pb = (await db.execute(pbq)).one()

    stages = [
        FunnelStage(stage="Uploaded", count=u.c, duration_hours=round(u.d / 3600, 2)),
        FunnelStage(stage="Processed", count=p.c, duration_hours=round(p.d / 3600, 2),
                    drop_off_pct=round((1 - p.c / u.c) * 100, 2) if u.c else 0),
        FunnelStage(stage="Published", count=pb.c, duration_hours=round(pb.d / 3600, 2),
                    drop_off_pct=round((1 - pb.c / p.c) * 100, 2) if p.c else 0),
    ]
    return ApiResponse(data=[s.model_dump() for s in stages])


@router.post("/by-dimension", response_model=ApiResponse)
async def funnel_by_dimension(
    body: TopNRequest,
    db: AsyncSession = Depends(get_db),
):
    """Funnel per dimension value (e.g., per channel, per team)."""
    dim_name = body.dimension.value
    table, join_cond, id_col, label_col = get_dimension_cols(dim_name)

    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    # Uploaded per dimension
    uq = (
        select(id_col.label("did"), label_col.label("dlabel"),
               func.count(FI.Fact_Input_ID).label("up_c"))
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
    )
    if join_cond is not None:
        uq = uq.join(table, join_cond)
    uq = uq.group_by(id_col, label_col)
    uq = apply_date_filter(uq, dd_sub.c.Full_Date, body.date_range)
    uq = apply_dimension_filters(
        uq,
        body.filters,
        has_fi=True,
        dc_joined=dim_name in {"channel", "client"},
        du_joined=dim_name in {"user", "team"},
    )
    u_rows = (await db.execute(uq)).all()
    u_map = {r.did: r for r in u_rows}

    # Processed per dimension (distinct uploaded inputs with >=1 output)
    proc_sub = build_processed_input_subquery(body.date_range, body.filters, dimension=dim_name, date_basis="upload")
    pq = (
        select(
            proc_sub.c.dimension_id.label("did"),
            func.count(proc_sub.c.input_fact_id).label("pr_c"),
        )
        .group_by(proc_sub.c.dimension_id)
    )
    p_rows = (await db.execute(pq)).all()
    p_map = {r.did: r.pr_c for r in p_rows}

    # Published per dimension (distinct uploaded inputs with >=1 published output)
    pb_sub = build_published_input_subquery(body.date_range, body.filters, dimension=dim_name, date_basis="upload")
    pbq = (
        select(
            pb_sub.c.dimension_id.label("did"),
            func.count(pb_sub.c.input_fact_id).label("pb_c"),
        )
        .group_by(pb_sub.c.dimension_id)
    )
    pb_rows = (await db.execute(pbq)).all()
    pb_map = {r.did: r.pb_c for r in pb_rows}

    items = []
    for did, ur in u_map.items():
        pr = p_map.get(did, 0)
        pb = pb_map.get(did, 0)
        items.append(FunnelDimensionItem(
            dimension_id=did,
            dimension_label=str(ur.dlabel),
            uploaded_count=ur.up_c,
            processed_count=pr,
            published_count=pb,
            upload_to_process_pct=round(pr / ur.up_c * 100, 2) if ur.up_c else 0,
            process_to_publish_pct=round(pb / pr * 100, 2) if pr else 0,
        ).model_dump())
    items.sort(key=lambda x: x["uploaded_count"], reverse=True)
    return ApiResponse(data=items[:body.n])


@router.post("/conversion-rates", response_model=ApiResponse)
async def conversion_rates(
    body: TopNRequest,
    db: AsyncSession = Depends(get_db),
):
    """Publish conversion % by any dimension, sorted by rate."""
    dim_name = body.dimension.value
    table, join_cond, id_col, label_col = get_dimension_cols(dim_name)
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    # Processed inputs by dimension
    proc_sub = build_processed_input_subquery(body.date_range, body.filters, dimension=dim_name, date_basis="upload")
    pq = (
        select(
            proc_sub.c.dimension_id.label("did"),
            proc_sub.c.dimension_label.label("dlabel"),
            func.count(proc_sub.c.input_fact_id).label("pr_c"),
        )
        .group_by(proc_sub.c.dimension_id, proc_sub.c.dimension_label)
    )
    p_rows = (await db.execute(pq)).all()
    p_map = {r.did: r for r in p_rows}

    # Published inputs by dimension
    pb_sub = build_published_input_subquery(body.date_range, body.filters, dimension=dim_name, date_basis="upload")
    pbq = (
        select(
            pb_sub.c.dimension_id.label("did"),
            func.count(pb_sub.c.input_fact_id).label("pb_c"),
        )
        .group_by(pb_sub.c.dimension_id)
    )
    pb_rows = (await db.execute(pbq)).all()
    pb_map = {r.did: r.pb_c for r in pb_rows}

    result = []
    for did, pr in p_map.items():
        pb = pb_map.get(did, 0)
        rate = round(pb / pr.pr_c * 100, 2) if pr.pr_c else 0
        result.append({
            "dimension_id": did,
            "dimension_label": str(pr.dlabel),
            "processed_count": pr.pr_c,
            "published_count": pb,
            "conversion_rate_pct": rate,
        })
    result.sort(key=lambda x: x["conversion_rate_pct"],
                reverse=(body.sort == "desc"))
    return ApiResponse(data=result[:body.n])


@router.post("/bottlenecks", response_model=ApiResponse)
async def bottlenecks(
    body: TopNRequest,
    db: AsyncSession = Depends(get_db),
):
    """Identify biggest processed-vs-published drop-off segments."""
    dim_name = body.dimension.value
    table, join_cond, id_col, label_col = get_dimension_cols(dim_name)
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    proc_sub = build_processed_input_subquery(body.date_range, body.filters, dimension=dim_name, date_basis="upload")
    pq = (
        select(
            proc_sub.c.dimension_id.label("did"),
            proc_sub.c.dimension_label.label("dlabel"),
            func.count(proc_sub.c.input_fact_id).label("pr_c"),
        )
        .group_by(proc_sub.c.dimension_id, proc_sub.c.dimension_label)
    )
    p_rows = (await db.execute(pq)).all()
    p_map = {r.did: r for r in p_rows}

    pb_sub = build_published_input_subquery(body.date_range, body.filters, dimension=dim_name, date_basis="upload")
    pbq = (
        select(
            pb_sub.c.dimension_id.label("did"),
            func.count(pb_sub.c.input_fact_id).label("pb_c"),
        )
        .group_by(pb_sub.c.dimension_id)
    )
    pb_rows = (await db.execute(pbq)).all()
    pb_map = {r.did: r.pb_c for r in pb_rows}

    result = []
    for did, pr in p_map.items():
        pb = pb_map.get(did, 0)
        gap = pr.pr_c - pb
        gap_pct = round(gap / pr.pr_c * 100, 2) if pr.pr_c else 0
        result.append({
            "dimension_id": did,
            "dimension_label": str(pr.dlabel),
            "processed_count": pr.pr_c,
            "published_count": pb,
            "gap_count": gap,
            "gap_pct": gap_pct,
        })
    result.sort(key=lambda x: x["gap_count"], reverse=True)
    return ApiResponse(data=result[:body.n])
