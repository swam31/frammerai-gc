"""Content mix endpoints - output type & input type distribution and trends."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import AnalyticsRequest, ApiResponse, TrendRequest
from app.services.analytics_service import (
    DC,
    DD,
    DIT,
    DOT,
    FI,
    FO,
    apply_date_filter,
    apply_dimension_filters,
    granularity_label,
)

router = APIRouter(prefix="/content", tags=["Content Mix"])


@router.post("/output-type-mix", response_model=ApiResponse)
async def output_type_mix(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Output type distribution using both input- and output-side output types."""
    upload_dd = select(DD.Date_ID, DD.Full_Date).subquery("upload_dd")
    create_dd = select(DD.Date_ID, DD.Full_Date).subquery("create_dd")

    fi_q = (
        select(
            FI.Output_Type_ID.label("output_type_id"),
            DOT.Output_Type.label("output_type"),
            func.count(FI.Fact_Input_ID).label("count"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(DOT, FI.Output_Type_ID == DOT.Output_Type_ID)
        .join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
        .group_by(FI.Output_Type_ID, DOT.Output_Type)
    )
    fi_q = apply_date_filter(fi_q, upload_dd.c.Full_Date, body.date_range)
    fi_q = apply_dimension_filters(fi_q, body.filters, has_fi=True)

    fo_q = (
        select(
            FO.Output_Type_ID.label("output_type_id"),
            DOT.Output_Type.label("output_type"),
            func.count(FO.Fact_Output_ID).label("count"),
            func.coalesce(func.extract("epoch", func.sum(FO.Created_Duration)), 0).label("dur"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DOT, FO.Output_Type_ID == DOT.Output_Type_ID)
        .join(create_dd, FO.Create_Date_ID == create_dd.c.Date_ID)
        .group_by(FO.Output_Type_ID, DOT.Output_Type)
    )
    fo_q = apply_date_filter(fo_q, create_dd.c.Full_Date, body.date_range)
    fo_q = apply_dimension_filters(fo_q, body.filters, has_fi=True, has_fo=True)

    combined = union_all(fi_q, fo_q).subquery("output_type_mix_union")
    q = (
        select(
            combined.c.output_type_id,
            combined.c.output_type,
            func.sum(combined.c.count).label("count"),
            func.sum(combined.c.dur).label("dur"),
        )
        .group_by(combined.c.output_type_id, combined.c.output_type)
        .order_by(func.sum(combined.c.count).desc())
    )
    rows = (await db.execute(q)).all()
    total = sum(r.count for r in rows) or 1
    data = [{
        "output_type_id": r.output_type_id,
        "output_type": r.output_type,
        "count": r.count,
        "duration_hours": round(r.dur / 3600, 2),
        "share_pct": round(r.count / total * 100, 2),
    } for r in rows]
    return ApiResponse(data=data)


@router.post("/input-type-mix", response_model=ApiResponse)
async def input_type_mix(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Input type distribution."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()
    q = (
        select(
            DIT.Input_Type_ID,
            DIT.Input_Type,
            func.count(FI.Fact_Input_ID).label("count"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(DIT, FI.Input_Type_ID == DIT.Input_Type_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DIT.Input_Type_ID, DIT.Input_Type)
        .order_by(func.count(FI.Fact_Input_ID).desc())
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()
    total = sum(r.count for r in rows) or 1
    data = [{
        "input_type_id": r.Input_Type_ID,
        "input_type": r.Input_Type,
        "count": r.count,
        "duration_hours": round(r.dur / 3600, 2),
        "share_pct": round(r.count / total * 100, 2),
    } for r in rows]
    return ApiResponse(data=data)


@router.post("/type-trends", response_model=ApiResponse)
async def type_trends(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Output type trends over time using both input- and output-side output types."""
    upload_dd = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month, DD.Quarter, DD.Year).subquery("upload_dd")
    create_dd = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month, DD.Quarter, DD.Year).subquery("create_dd")
    upload_period = granularity_label(body.granularity, upload_dd.c)
    create_period = granularity_label(body.granularity, create_dd.c)

    fi_q = (
        select(
            DOT.Output_Type.label("output_type"),
            upload_period,
            func.count(FI.Fact_Input_ID).label("count"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(DOT, FI.Output_Type_ID == DOT.Output_Type_ID)
        .join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
        .group_by(DOT.Output_Type, "period")
    )
    fi_q = apply_date_filter(fi_q, upload_dd.c.Full_Date, body.date_range)
    fi_q = apply_dimension_filters(fi_q, body.filters, has_fi=True)

    fo_q = (
        select(
            DOT.Output_Type.label("output_type"),
            create_period,
            func.count(FO.Fact_Output_ID).label("count"),
            func.coalesce(func.extract("epoch", func.sum(FO.Created_Duration)), 0).label("dur"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DOT, FO.Output_Type_ID == DOT.Output_Type_ID)
        .join(create_dd, FO.Create_Date_ID == create_dd.c.Date_ID)
        .group_by(DOT.Output_Type, "period")
    )
    fo_q = apply_date_filter(fo_q, create_dd.c.Full_Date, body.date_range)
    fo_q = apply_dimension_filters(fo_q, body.filters, has_fi=True, has_fo=True)

    combined = union_all(fi_q, fo_q).subquery("output_type_trends_union")
    q = (
        select(
            combined.c.output_type,
            combined.c.period,
            func.sum(combined.c.count).label("count"),
            func.sum(combined.c.dur).label("dur"),
        )
        .group_by(combined.c.output_type, combined.c.period)
        .order_by(combined.c.period)
    )
    rows = (await db.execute(q)).all()
    data = [{
        "output_type": r.output_type,
        "period": str(r.period),
        "count": r.count,
        "duration_hours": round(r.dur / 3600, 2),
    } for r in rows]
    return ApiResponse(data=data)


@router.post("/input-type-trends", response_model=ApiResponse)
async def input_type_trends(body: TrendRequest, db: AsyncSession = Depends(get_db)):
    """Input type trends over time."""
    dd_sub = select(DD.Date_ID, DD.Full_Date, DD.Week_Number, DD.Month, DD.Quarter, DD.Year).subquery()
    period = granularity_label(body.granularity, dd_sub.c)
    q = (
        select(
            DIT.Input_Type,
            period,
            func.count(FI.Fact_Input_ID).label("count"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(DIT, FI.Input_Type_ID == DIT.Input_Type_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DIT.Input_Type, "period")
        .order_by("period")
    )
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)
    rows = (await db.execute(q)).all()
    data = [{
        "input_type": r.Input_Type,
        "period": str(r.period),
        "count": r.count,
        "duration_hours": round(r.dur / 3600, 2),
    } for r in rows]
    return ApiResponse(data=data)


@router.post("/type-channel-matrix", response_model=ApiResponse)
async def type_channel_matrix(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Which channels produce which output types using both FI and FO output types."""
    upload_dd = select(DD.Date_ID, DD.Full_Date).subquery("upload_dd")
    create_dd = select(DD.Date_ID, DD.Full_Date).subquery("create_dd")

    fi_q = (
        select(
            DC.Channel_Name.label("channel_name"),
            DOT.Output_Type.label("output_type"),
            func.count(FI.Fact_Input_ID).label("count"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(DOT, FI.Output_Type_ID == DOT.Output_Type_ID)
        .join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
        .group_by(DC.Channel_Name, DOT.Output_Type)
    )
    fi_q = apply_date_filter(fi_q, upload_dd.c.Full_Date, body.date_range)
    fi_q = apply_dimension_filters(fi_q, body.filters, has_fi=True, dc_joined=True)

    fo_q = (
        select(
            DC.Channel_Name.label("channel_name"),
            DOT.Output_Type.label("output_type"),
            func.count(FO.Fact_Output_ID).label("count"),
            func.coalesce(func.extract("epoch", func.sum(FO.Created_Duration)), 0).label("dur"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(DOT, FO.Output_Type_ID == DOT.Output_Type_ID)
        .join(create_dd, FO.Create_Date_ID == create_dd.c.Date_ID)
        .group_by(DC.Channel_Name, DOT.Output_Type)
    )
    fo_q = apply_date_filter(fo_q, create_dd.c.Full_Date, body.date_range)
    fo_q = apply_dimension_filters(fo_q, body.filters, has_fi=True, has_fo=True, dc_joined=True)

    combined = union_all(fi_q, fo_q).subquery("type_channel_union")
    q = (
        select(
            combined.c.channel_name,
            combined.c.output_type,
            func.sum(combined.c.count).label("count"),
            func.sum(combined.c.dur).label("dur"),
        )
        .group_by(combined.c.channel_name, combined.c.output_type)
    )
    rows = (await db.execute(q)).all()

    matrix: dict[str, dict] = {}
    types: set[str] = set()
    for r in rows:
        types.add(r.output_type)
        if r.channel_name not in matrix:
            matrix[r.channel_name] = {"channel": r.channel_name}
        matrix[r.channel_name][r.output_type] = {
            "count": r.count,
            "duration_hours": round(r.dur / 3600, 2),
        }

    return ApiResponse(data={"output_types": sorted(types), "rows": list(matrix.values())})
