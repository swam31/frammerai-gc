"""KPI summary, comparison, and output-type card endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import (
    AnalyticsRequest, ComparisonRequest, ApiResponse,
    KPISummaryResponse, KPIComparisonResponse, OutputTypeCard,
)
from app.services.analytics_service import (
    compute_kpi_summary, compute_delta,
    FI, FO, FP, DD, DOT,
    apply_date_filter, apply_dimension_filters, build_published_output_subquery,
)

router = APIRouter(prefix="/kpi", tags=["KPI Summary"])


@router.post("/summary", response_model=ApiResponse)
async def kpi_summary(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Top-level KPI block: Uploaded / Processed / Published (count + duration + published subset)."""
    result = await compute_kpi_summary(db, body.date_range, body.filters)
    return ApiResponse(data=result.model_dump())


@router.post("/comparison", response_model=ApiResponse)
async def kpi_comparison(body: ComparisonRequest, db: AsyncSession = Depends(get_db)):
    """KPI summary for current vs previous period with delta & % change."""
    current = await compute_kpi_summary(db, body.date_range.current, body.filters)
    result: dict = {"current": current.model_dump()}

    if body.date_range.previous:
        previous = await compute_kpi_summary(db, body.date_range.previous, body.filters)
        delta, pct = compute_delta(current.model_dump(), previous.model_dump())
        result["previous"] = previous.model_dump()
        result["delta"] = delta
        result["pct_change"] = pct
    return ApiResponse(data=result)


@router.post("/cards", response_model=ApiResponse)
async def output_type_cards(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Per-output-type cards: count, duration, published count, published duration, publish rate."""

    upload_dd = select(DD.Date_ID, DD.Full_Date).subquery("up_dd")
    create_dd = select(DD.Date_ID, DD.Full_Date).subquery("create_dd")

    total_fi_q = (
        select(
            FI.Output_Type_ID.label("output_type_id"),
            DOT.Output_Type.label("output_type"),
            func.count(FI.Fact_Input_ID).label("cnt"),
            func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(DOT, FI.Output_Type_ID == DOT.Output_Type_ID)
        .join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
        .group_by(FI.Output_Type_ID, DOT.Output_Type)
    )
    total_fi_q = apply_date_filter(total_fi_q, upload_dd.c.Full_Date, body.date_range)
    total_fi_q = apply_dimension_filters(total_fi_q, body.filters, has_fi=True)

    total_fo_q = (
        select(
            FO.Output_Type_ID.label("output_type_id"),
            DOT.Output_Type.label("output_type"),
            func.count(FO.Fact_Output_ID).label("cnt"),
            func.coalesce(func.extract('epoch', func.sum(FO.Created_Duration)), 0).label("dur"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DOT, FO.Output_Type_ID == DOT.Output_Type_ID)
        .join(create_dd, FO.Create_Date_ID == create_dd.c.Date_ID)
        .group_by(FO.Output_Type_ID, DOT.Output_Type)
    )
    total_fo_q = apply_date_filter(total_fo_q, create_dd.c.Full_Date, body.date_range)
    total_fo_q = apply_dimension_filters(total_fo_q, body.filters, has_fi=True, has_fo=True)

    total_union = union_all(total_fi_q, total_fo_q).subquery("total_union")
    total_q = (
        select(
            total_union.c.output_type_id,
            total_union.c.output_type,
            func.sum(total_union.c.cnt).label("cnt"),
            func.sum(total_union.c.dur).label("dur"),
        )
        .select_from(total_union)
        .group_by(total_union.c.output_type_id, total_union.c.output_type)
    )
    total_rows = (await db.execute(total_q)).all()
    total_map = {r.output_type_id: r for r in total_rows}

    pub_sub = build_published_output_subquery(body.date_range, body.filters, dimension="output_type", date_basis="published")
    pub_q = (
        select(
            pub_sub.c.dimension_id.label("output_type_id"),
            func.count(pub_sub.c.output_id).label("pub_cnt"),
            func.coalesce(func.sum(pub_sub.c.published_duration_seconds), 0).label("pub_dur"),
        )
        .group_by(pub_sub.c.dimension_id)
    )
    pub_rows = (await db.execute(pub_q)).all()
    pub_map = {r.output_type_id: r for r in pub_rows}

    cards = []
    for ot_id, tot in total_map.items():
        pub = pub_map.get(ot_id)
        pub_cnt = pub.pub_cnt if pub else 0
        pub_dur = pub.pub_dur if pub else 0
        cards.append(OutputTypeCard(
            output_type_id=ot_id,
            output_type=tot.output_type,
            total_count=tot.cnt,
            total_duration_hours=round(tot.dur / 3600, 2),
            published_count=pub_cnt,
            published_duration_hours=round(pub_dur / 3600, 2),
            publish_rate_pct=round(pub_cnt / tot.cnt * 100, 2) if tot.cnt else 0.0,
        ))
    cards.sort(key=lambda c: c.total_count, reverse=True)
    return ApiResponse(data=[c.model_dump() for c in cards])
