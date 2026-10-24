"""Multi-dimensional drill-down endpoints (single, double, pivot, heatmap)."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import (
    ApiResponse,
    CrossDimensionCell,
    DimensionBreakdownItem,
    MultiDimensionRequest,
)
from app.services.analytics_service import (
    DC,
    DD,
    DIT,
    DL,
    DOT,
    DP,
    DU,
    FI,
    FO,
    FP,
    apply_date_filter,
    apply_dimension_filters,
    build_published_input_subquery,
    get_dimension_cols,
)

router = APIRouter(prefix="/dimensions", tags=["Multi-Dimensional Analysis"])


def _join_dim(q, dim_name, fi_alias=FI, already_joined=None):
    """Join the dimension table onto the query if not already joined."""
    already = already_joined or set()
    table, join_cond, id_col, label_col = get_dimension_cols(dim_name)
    tname = table.__tablename__
    if tname not in already:
        if dim_name == "platform":
            q = q.join(FO, FO.Fact_Input_ID == fi_alias.Fact_Input_ID)
            q = q.join(FP, FP.Fact_Output_ID == FO.Fact_Output_ID)
            q = q.join(table, FP.Platform_ID == table.Platform_ID)
        else:
            q = q.join(table, join_cond)
        already.add(tname)
    return q, id_col, label_col, already


def _output_type_other_dim_cols(dim_name: str, source: str):
    if dim_name == "channel":
        return DC.Channel_ID, DC.Channel_Name, lambda q: q.join(DC, FI.Channel_ID == DC.Channel_ID), True, False
    if dim_name == "client":
        return DC.Client_ID, DC.Client_Name, lambda q: q.join(DC, FI.Channel_ID == DC.Channel_ID), True, False
    if dim_name == "user":
        return DU.User_ID, DU.User_Name, lambda q: q.join(DU, FI.User_ID == DU.User_ID), False, True
    if dim_name == "team":
        return DU.Team_ID, DU.Team_Name, lambda q: q.join(DU, FI.User_ID == DU.User_ID), False, True
    if dim_name == "language":
        if source == "fo":
            return DL.Language_ID, DL.Language_Name, lambda q: q.join(DL, FO.Language_ID == DL.Language_ID), False, False
        return DL.Language_ID, DL.Language_Name, lambda q: q.join(DL, FI.Language_ID == DL.Language_ID), False, False
    if dim_name == "input_type":
        return DIT.Input_Type_ID, DIT.Input_Type, lambda q: q.join(DIT, FI.Input_Type_ID == DIT.Input_Type_ID), False, False
    raise ValueError(f"Unsupported dimension pairing with output_type: {dim_name}")


async def _combined_output_type_rows(body: MultiDimensionRequest, db: AsyncSession):
    if not body.dimension2:
        return []

    dims = {body.dimension1.value, body.dimension2.value}
    if "output_type" not in dims:
        return []

    other_dim = body.dimension2.value if body.dimension1.value == "output_type" else body.dimension1.value
    if other_dim not in {"channel", "client", "user", "team", "language", "input_type"}:
        return []

    upload_dd = select(DD.Date_ID, DD.Full_Date).subquery("upload_dd")
    create_dd = select(DD.Date_ID, DD.Full_Date).subquery("create_dd")

    fi_other_id, fi_other_label, fi_joiner, fi_dc_joined, fi_du_joined = _output_type_other_dim_cols(other_dim, "fi")
    fo_other_id, fo_other_label, fo_joiner, fo_dc_joined, fo_du_joined = _output_type_other_dim_cols(other_dim, "fo")

    fi_q = (
        select(
            fi_other_id.label("other_id"),
            fi_other_label.label("other_label"),
            FI.Output_Type_ID.label("output_type_id"),
            DOT.Output_Type.label("output_type_label"),
            func.count(FI.Fact_Input_ID).label("cnt"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .select_from(FI)
    )
    fi_q = fi_joiner(fi_q)
    fi_q = fi_q.join(DOT, FI.Output_Type_ID == DOT.Output_Type_ID)
    fi_q = fi_q.join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
    fi_q = fi_q.group_by(fi_other_id, fi_other_label, FI.Output_Type_ID, DOT.Output_Type)
    fi_q = apply_date_filter(fi_q, upload_dd.c.Full_Date, body.date_range)
    fi_q = apply_dimension_filters(fi_q, body.filters, has_fi=True, dc_joined=fi_dc_joined, du_joined=fi_du_joined)

    fo_q = (
        select(
            fo_other_id.label("other_id"),
            fo_other_label.label("other_label"),
            FO.Output_Type_ID.label("output_type_id"),
            DOT.Output_Type.label("output_type_label"),
            func.count(FO.Fact_Output_ID).label("cnt"),
            func.coalesce(func.extract("epoch", func.sum(FO.Created_Duration)), 0).label("dur"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
    )
    fo_q = fo_joiner(fo_q)
    fo_q = fo_q.join(DOT, FO.Output_Type_ID == DOT.Output_Type_ID)
    fo_q = fo_q.join(create_dd, FO.Create_Date_ID == create_dd.c.Date_ID)
    fo_q = fo_q.group_by(fo_other_id, fo_other_label, FO.Output_Type_ID, DOT.Output_Type)
    fo_q = apply_date_filter(fo_q, create_dd.c.Full_Date, body.date_range)
    fo_q = apply_dimension_filters(fo_q, body.filters, has_fi=True, has_fo=True, dc_joined=fo_dc_joined, du_joined=fo_du_joined)

    combined = union_all(fi_q, fo_q).subquery("combined_output_type")
    q = (
        select(
            combined.c.other_id,
            combined.c.other_label,
            combined.c.output_type_id,
            combined.c.output_type_label,
            func.sum(combined.c.cnt).label("cnt"),
            func.sum(combined.c.dur).label("dur"),
        )
        .group_by(
            combined.c.other_id,
            combined.c.other_label,
            combined.c.output_type_id,
            combined.c.output_type_label,
        )
    )
    return (await db.execute(q)).all()


@router.post("/single", response_model=ApiResponse)
async def single_dimension(body: MultiDimensionRequest, db: AsyncSession = Depends(get_db)):
    """Breakdown by a single dimension: count, duration, published count, publish rate."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery("dd")
    already: set = set()

    q = (
        select(
            func.count(FI.Fact_Input_ID).label("cnt"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
    )

    q, id_col, label_col, already = _join_dim(q, body.dimension1.value, already_joined=already)
    q = q.add_columns(id_col.label("dim_id"), label_col.label("dim_label"))
    q = q.group_by(id_col, label_col)
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(
        q,
        body.filters,
        has_fi=True,
        dc_joined="Dim_Channel_Client" in already,
        du_joined="Dim_User_Team" in already,
    )
    rows = (await db.execute(q)).all()

    pub_sub = build_published_input_subquery(body.date_range, body.filters, dimension=body.dimension1.value, date_basis="upload")
    pub_q = (
        select(
            pub_sub.c.dimension_id.label("dim_id"),
            func.count(pub_sub.c.input_fact_id).label("pub_cnt"),
            func.coalesce(func.sum(pub_sub.c.uploaded_duration_seconds), 0).label("pub_dur"),
        )
        .group_by(pub_sub.c.dimension_id)
    )
    pub_rows = (await db.execute(pub_q)).all()
    pub_map = {r.dim_id: r for r in pub_rows}

    data = []
    for r in rows:
        pub = pub_map.get(r.dim_id)
        pub_cnt = pub.pub_cnt if pub else 0
        pub_dur = pub.pub_dur if pub else 0
        data.append(DimensionBreakdownItem(
            dimension_id=r.dim_id,
            dimension_label=str(r.dim_label),
            count=r.cnt,
            duration_hours=round(r.dur / 3600, 2),
            published_count=pub_cnt,
            published_duration_hours=round(pub_dur / 3600, 2),
            publish_rate_pct=round(pub_cnt / r.cnt * 100, 2) if r.cnt else 0.0,
        ).model_dump())
    return ApiResponse(data=data)


@router.post("/double", response_model=ApiResponse)
async def double_dimension(body: MultiDimensionRequest, db: AsyncSession = Depends(get_db)):
    """Cross-tabulation of two dimensions."""
    if not body.dimension2:
        return ApiResponse(success=False, message="dimension2 is required for double-dimension analysis")

    if "output_type" in {body.dimension1.value, body.dimension2.value}:
        rows = await _combined_output_type_rows(body, db)
        data = []
        for r in rows:
            if body.dimension1.value == "output_type":
                data.append(CrossDimensionCell(
                    dim1_id=r.output_type_id,
                    dim1_label=str(r.output_type_label),
                    dim2_id=r.other_id,
                    dim2_label=str(r.other_label),
                    count=r.cnt,
                    duration_hours=round(r.dur / 3600, 2),
                ).model_dump())
            else:
                data.append(CrossDimensionCell(
                    dim1_id=r.other_id,
                    dim1_label=str(r.other_label),
                    dim2_id=r.output_type_id,
                    dim2_label=str(r.output_type_label),
                    count=r.cnt,
                    duration_hours=round(r.dur / 3600, 2),
                ).model_dump())
        return ApiResponse(data=data)

    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery("dd")
    already: set = set()

    q = (
        select(
            func.count(FI.Fact_Input_ID).label("cnt"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
    )

    q, id1, label1, already = _join_dim(q, body.dimension1.value, already_joined=already)
    q, id2, label2, already = _join_dim(q, body.dimension2.value, already_joined=already)
    q = q.add_columns(
        id1.label("dim1_id"),
        label1.label("dim1_label"),
        id2.label("dim2_id"),
        label2.label("dim2_label"),
    )
    q = q.group_by(id1, label1, id2, label2)
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(
        q,
        body.filters,
        has_fi=True,
        dc_joined="Dim_Channel_Client" in already,
        du_joined="Dim_User_Team" in already,
    )
    rows = (await db.execute(q)).all()

    data = [CrossDimensionCell(
        dim1_id=r.dim1_id,
        dim1_label=str(r.dim1_label),
        dim2_id=r.dim2_id,
        dim2_label=str(r.dim2_label),
        count=r.cnt,
        duration_hours=round(r.dur / 3600, 2),
    ).model_dump() for r in rows]
    return ApiResponse(data=data)


@router.post("/pivot", response_model=ApiResponse)
async def pivot_table(body: MultiDimensionRequest, db: AsyncSession = Depends(get_db)):
    """Pivot-table-ready data: rows = dim1, columns = dim2, values = count/duration."""
    if not body.dimension2:
        return ApiResponse(success=False, message="dimension2 is required")

    if "output_type" in {body.dimension1.value, body.dimension2.value}:
        rows = await _combined_output_type_rows(body, db)
        pivot: dict[str, dict] = {}
        col_names: set[str] = set()
        for r in rows:
            row_label = str(r.output_type_label) if body.dimension1.value == "output_type" else str(r.other_label)
            col_label = str(r.other_label) if body.dimension1.value == "output_type" else str(r.output_type_label)
            col_names.add(col_label)
            if row_label not in pivot:
                pivot[row_label] = {"row": row_label}
            pivot[row_label][col_label] = {"count": r.cnt, "duration_hours": round(r.dur / 3600, 2)}
        return ApiResponse(data={"columns": sorted(col_names), "rows": list(pivot.values())})

    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery("dd")
    already: set = set()

    q = (
        select(
            func.count(FI.Fact_Input_ID).label("cnt"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
    )
    q, id1, label1, already = _join_dim(q, body.dimension1.value, already_joined=already)
    q, id2, label2, already = _join_dim(q, body.dimension2.value, already_joined=already)
    q = q.add_columns(label1.label("row_label"), label2.label("col_label"))
    q = q.group_by(label1, label2)
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(
        q,
        body.filters,
        has_fi=True,
        dc_joined="Dim_Channel_Client" in already,
        du_joined="Dim_User_Team" in already,
    )
    rows = (await db.execute(q)).all()

    pivot: dict[str, dict] = {}
    col_names: set[str] = set()
    for r in rows:
        rl = str(r.row_label)
        cl = str(r.col_label)
        col_names.add(cl)
        if rl not in pivot:
            pivot[rl] = {"row": rl}
        pivot[rl][cl] = {"count": r.cnt, "duration_hours": round(r.dur / 3600, 2)}

    return ApiResponse(data={"columns": sorted(col_names), "rows": list(pivot.values())})


@router.post("/heatmap", response_model=ApiResponse)
async def heatmap_data(body: MultiDimensionRequest, db: AsyncSession = Depends(get_db)):
    """Heatmap-ready matrix: list of {x, y, value} cells."""
    if not body.dimension2:
        return ApiResponse(success=False, message="dimension2 is required")

    if "output_type" in {body.dimension1.value, body.dimension2.value}:
        rows = await _combined_output_type_rows(body, db)
        data = []
        for r in rows:
            if body.dimension1.value == "output_type":
                data.append({"x": str(r.output_type_label), "y": str(r.other_label), "value": r.cnt})
            else:
                data.append({"x": str(r.other_label), "y": str(r.output_type_label), "value": r.cnt})
        return ApiResponse(data=data)

    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery("dd")
    already: set = set()

    q = select(func.count(FI.Fact_Input_ID).label("cnt")).join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
    q, id1, label1, already = _join_dim(q, body.dimension1.value, already_joined=already)
    q, id2, label2, already = _join_dim(q, body.dimension2.value, already_joined=already)
    q = q.add_columns(label1.label("x"), label2.label("y"))
    q = q.group_by(label1, label2)
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(
        q,
        body.filters,
        has_fi=True,
        dc_joined="Dim_Channel_Client" in already,
        du_joined="Dim_User_Team" in already,
    )
    rows = (await db.execute(q)).all()
    data = [{"x": str(r.x), "y": str(r.y), "value": r.cnt} for r in rows]
    return ApiResponse(data=data)
