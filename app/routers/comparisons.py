"""Segment & period comparison endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import ApiResponse, ComparisonRequest, AnalyticsRequest
from app.services.analytics_service import (
    FI, FO, FP, DD,
    apply_date_filter, apply_dimension_filters,
    compute_kpi_summary, compute_delta,
)

router = APIRouter(prefix="/compare", tags=["Comparisons"])


@router.post("/periods", response_model=ApiResponse)
async def compare_periods(body: ComparisonRequest, db: AsyncSession = Depends(get_db)):
    """Any metric, two date ranges, side-by-side with delta & % change."""
    current = await compute_kpi_summary(db, body.date_range.current, body.filters)
    result: dict = {"current": current.model_dump()}
    if body.date_range.previous:
        previous = await compute_kpi_summary(db, body.date_range.previous, body.filters)
        delta, pct = compute_delta(current.model_dump(), previous.model_dump())
        result["previous"] = previous.model_dump()
        result["delta"] = delta
        result["pct_change"] = pct
    return ApiResponse(data=result)


@router.post("/segments", response_model=ApiResponse)
async def compare_segments(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Compare two segments on all metrics. Pass two channel_ids or client_ids in filters.
    Returns KPI summaries for each segment separately."""
    channel_ids = body.filters.channel_ids or []
    if len(channel_ids) < 2:
        return ApiResponse(success=False, message="Provide at least 2 channel_ids for segment comparison.")

    results = {}
    from app.schemas.common import DimensionFilter, DateRangeFilter
    for cid in channel_ids[:5]:  # limit to 5 segments
        seg_filter = body.filters.model_copy()
        seg_filter.channel_ids = [cid]
        kpi = await compute_kpi_summary(db, body.date_range, seg_filter)
        results[f"channel_{cid}"] = kpi.model_dump()

    return ApiResponse(data=results)


@router.post("/benchmarks", response_model=ApiResponse)
async def compare_benchmarks(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Segment vs overall average."""
    # Overall
    from app.schemas.common import DimensionFilter
    overall = await compute_kpi_summary(db, body.date_range, DimensionFilter())
    segment = await compute_kpi_summary(db, body.date_range, body.filters)
    delta, pct = compute_delta(segment.model_dump(), overall.model_dump())
    return ApiResponse(data={
        "segment": segment.model_dump(),
        "overall": overall.model_dump(),
        "delta_vs_overall": delta,
        "pct_vs_overall": pct,
    })
