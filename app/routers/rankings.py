"""Top-N / Bottom-N / Movers ranking endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import ApiResponse, TopNRequest, ComparisonRequest, DimensionEnum
from app.services.analytics_service import (
    FI, FO, FP, DD,
    apply_date_filter, apply_dimension_filters,
    get_dimension_cols,
)

router = APIRouter(prefix="/rankings", tags=["Rankings"])


async def _ranked_by_dim(body: TopNRequest, db: AsyncSession, order_desc: bool = True):
    dim_name = body.dimension.value
    table, join_cond, id_col, label_col = get_dimension_cols(dim_name)
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    q = (
        select(
            id_col.label("did"), label_col.label("dlabel"),
            func.count(FI.Fact_Input_ID).label("count"),
            func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
    )
    if join_cond is not None:
        q = q.join(table, join_cond)
    if dim_name == "platform":
        q = q.join(FO, FO.Fact_Input_ID == FI.Fact_Input_ID)
        q = q.join(FP, FP.Fact_Output_ID == FO.Fact_Output_ID)
        q = q.join(table, FP.Platform_ID == table.Platform_ID)

    q = q.group_by(id_col, label_col)
    q = apply_date_filter(q, dd_sub.c.Full_Date, body.date_range)
    q = apply_dimension_filters(q, body.filters, has_fi=True)

    if order_desc:
        q = q.order_by(func.count(FI.Fact_Input_ID).desc())
    else:
        q = q.order_by(func.count(FI.Fact_Input_ID).asc())
    q = q.limit(body.n)
    return (await db.execute(q)).all()


@router.post("/top-n", response_model=ApiResponse)
async def top_n(body: TopNRequest, db: AsyncSession = Depends(get_db)):
    """Top N entities by uploaded count."""
    rows = await _ranked_by_dim(body, db, order_desc=True)
    data = [{"rank": i + 1, "id": r.did, "label": str(r.dlabel),
             "count": r.count, "duration_hours": round(r.dur / 3600, 2)}
            for i, r in enumerate(rows)]
    return ApiResponse(data=data)


@router.post("/bottom-n", response_model=ApiResponse)
async def bottom_n(body: TopNRequest, db: AsyncSession = Depends(get_db)):
    """Bottom N entities by uploaded count."""
    rows = await _ranked_by_dim(body, db, order_desc=False)
    data = [{"rank": i + 1, "id": r.did, "label": str(r.dlabel),
             "count": r.count, "duration_hours": round(r.dur / 3600, 2)}
            for i, r in enumerate(rows)]
    return ApiResponse(data=data)


@router.post("/movers", response_model=ApiResponse)
async def movers(body: ComparisonRequest, db: AsyncSession = Depends(get_db)):
    """Biggest gainers & losers vs prior period (by channel)."""
    dd_curr = select(DD.Date_ID, DD.Full_Date).subquery("dd_curr")
    dd_prev = select(DD.Date_ID, DD.Full_Date).subquery("dd_prev")
    from app.services.analytics_service import DC

    # Current period
    cq = (
        select(DC.Channel_ID, DC.Channel_Name,
               func.count(FI.Fact_Input_ID).label("curr_count"))
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_curr, FI.Upload_Date_ID == dd_curr.c.Date_ID)
        .group_by(DC.Channel_ID, DC.Channel_Name)
    )
    cq = apply_date_filter(cq, dd_curr.c.Full_Date, body.date_range.current)
    c_rows = (await db.execute(cq)).all()
    c_map = {r.Channel_ID: r for r in c_rows}

    if body.date_range.previous:
        pq = (
            select(DC.Channel_ID,
                   func.count(FI.Fact_Input_ID).label("prev_count"))
            .join(DC, FI.Channel_ID == DC.Channel_ID)
            .join(dd_prev, FI.Upload_Date_ID == dd_prev.c.Date_ID)
            .group_by(DC.Channel_ID)
        )
        pq = apply_date_filter(pq, dd_prev.c.Full_Date, body.date_range.previous)
        p_rows = (await db.execute(pq)).all()
        p_map = {r.Channel_ID: r.prev_count for r in p_rows}
    else:
        p_map = {}

    movers_data = []
    for cid, cr in c_map.items():
        prev = p_map.get(cid, 0)
        delta = cr.curr_count - prev
        pct = round(delta / prev * 100, 2) if prev else None
        movers_data.append({
            "channel_id": cid, "channel_name": cr.Channel_Name,
            "current_count": cr.curr_count, "previous_count": prev,
            "delta": delta, "pct_change": pct,
        })
    movers_data.sort(key=lambda x: x["delta"], reverse=True)
    gainers = movers_data[:10]
    losers = list(reversed(movers_data[-10:]))
    return ApiResponse(data={"gainers": gainers, "losers": losers})
