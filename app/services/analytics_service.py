"""Core analytics query-building service.

Provides reusable functions for:
- Building filtered queries across the star schema
- Date-range and dimension filtering
- Aggregation helpers (count, sum-duration, grouping by granularity)
- Period-over-period delta computation
"""

from __future__ import annotations

from datetime import date
from typing import Any, Optional, Sequence

from sqlalchemy import select, func, case, and_, Integer, String, literal_column, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.models.dimensions import (
    DimChannelClient, DimDate, DimInputType, DimInputVideo,
    DimLanguage, DimOutputType, DimOutputVideo, DimPlatform, DimUserTeam,
)
from app.models.facts import (
    FactInputVideoOperations, FactOutputVideoOperations,
    FactPublishInformation, FactDataQuality,
)
from app.schemas.common import (
    DateRangeFilter, DimensionFilter, Granularity,
    KPIValue, KPIWithPublished, KPISummaryResponse,
)


# ──────────────────────────────────────────────
# Shorthand aliases
# ──────────────────────────────────────────────
FI = FactInputVideoOperations
FO = FactOutputVideoOperations
FP = FactPublishInformation
FDQ = FactDataQuality
DD = DimDate
DC = DimChannelClient
DU = DimUserTeam
DIT = DimInputType
DOT = DimOutputType
DL = DimLanguage
DP = DimPlatform
DIV = DimInputVideo
DOV = DimOutputVideo


# ──────────────────────────────────────────────
# Filter helpers
# ──────────────────────────────────────────────

def apply_date_filter(stmt: Select, date_col, dr: DateRangeFilter) -> Select:
    """Apply start/end date filter by joining to Dim_Date."""
    if dr.start_date:
        stmt = stmt.where(date_col >= dr.start_date)
    if dr.end_date:
        stmt = stmt.where(date_col <= dr.end_date)
    return stmt


def apply_dimension_filters(stmt: Select, filters: DimensionFilter,
                            *,
                            fi_alias=FI,
                            fo_alias=FO,
                            fp_alias=FP,
                            has_fi: bool = True,
                            has_fo: bool = False,
                            has_fp: bool = False,
                            dc_joined: bool = False,
                            du_joined: bool = False) -> Select:
    """Apply optional dimension ID filters."""
    if filters.client_ids and has_fi:
        if not dc_joined:
            stmt = stmt.join(DC, fi_alias.Channel_ID == DC.Channel_ID)
        stmt = stmt.where(DC.Client_ID.in_(filters.client_ids))
    if filters.channel_ids and has_fi:
        stmt = stmt.where(fi_alias.Channel_ID.in_(filters.channel_ids))
    if filters.user_ids and has_fi:
        stmt = stmt.where(fi_alias.User_ID.in_(filters.user_ids))
    if filters.team_ids and has_fi:
        if not du_joined:
            stmt = stmt.join(DU, fi_alias.User_ID == DU.User_ID)
        stmt = stmt.where(DU.Team_ID.in_(filters.team_ids))
    if filters.language_ids and has_fi:
        stmt = stmt.where(fi_alias.Language_ID.in_(filters.language_ids))
    if filters.input_type_ids and has_fi:
        stmt = stmt.where(fi_alias.Input_Type_ID.in_(filters.input_type_ids))
    if filters.output_type_ids:
        if has_fi and has_fo:
            stmt = stmt.where(or_(
                fi_alias.Output_Type_ID.in_(filters.output_type_ids),
                fo_alias.Output_Type_ID.in_(filters.output_type_ids),
            ))
        elif has_fi:
            stmt = stmt.where(fi_alias.Output_Type_ID.in_(filters.output_type_ids))
        elif has_fo:
            stmt = stmt.where(fo_alias.Output_Type_ID.in_(filters.output_type_ids))
    if filters.platform_ids and has_fp:
        stmt = stmt.where(fp_alias.Platform_ID.in_(filters.platform_ids))
    if filters.is_billable is not None and has_fp:
        stmt = stmt.where(fp_alias.Is_Billable == filters.is_billable)
    return stmt


# ──────────────────────────────────────────────
# Granularity helpers
# ──────────────────────────────────────────────

def granularity_column(granularity: Granularity, date_table=DD):
    """Return the SQLAlchemy column expression for the requested grain."""
    mapping = {
        Granularity.daily: date_table.Full_Date,
        Granularity.weekly: date_table.Week_Number,
        Granularity.monthly: date_table.Month,
        Granularity.quarterly: date_table.Quarter,
        Granularity.yearly: date_table.Year,
    }
    return mapping[granularity]


def granularity_label(granularity: Granularity, date_table=DD):
    """Return a label expression that yields a user-friendly period string."""
    if granularity == Granularity.daily:
        return func.to_char(date_table.Full_Date, 'YYYY-MM-DD').label("period")
    if granularity == Granularity.weekly:
        return func.concat(
            func.cast(date_table.Year, String),
            '-W',
            func.lpad(func.cast(date_table.Week_Number, String), 2, '0'),
        ).label("period")
    if granularity == Granularity.monthly:
        return func.concat(
            func.cast(date_table.Year, String),
            '-',
            func.lpad(func.cast(date_table.Month, String), 2, '0'),
        ).label("period")
    if granularity == Granularity.quarterly:
        return func.concat(date_table.Year, '-Q', date_table.Quarter).label("period")
    return func.cast(date_table.Year, Integer).label("period")


# ──────────────────────────────────────────────
# Dimension label helpers
# ──────────────────────────────────────────────

DIMENSION_JOIN_MAP = {
    "channel": (DC, FI.Channel_ID == DC.Channel_ID, DC.Channel_ID, DC.Channel_Name),
    "client": (DC, FI.Channel_ID == DC.Channel_ID, DC.Client_ID, DC.Client_Name),
    "user": (DU, FI.User_ID == DU.User_ID, DU.User_ID, DU.User_Name),
    "team": (DU, FI.User_ID == DU.User_ID, DU.Team_ID, DU.Team_Name),
    "language": (DL, FI.Language_ID == DL.Language_ID, DL.Language_ID, DL.Language_Name),
    "input_type": (DIT, FI.Input_Type_ID == DIT.Input_Type_ID, DIT.Input_Type_ID, DIT.Input_Type),
    "output_type": (DOT, FI.Output_Type_ID == DOT.Output_Type_ID, DOT.Output_Type_ID, DOT.Output_Type),
    "platform": (DP, None, DP.Platform_ID, DP.Platform_Name),  # requires FP join
}


def get_dimension_cols(dim_name: str):
    """Return (table, join_condition, id_col, label_col) for a dimension."""
    return DIMENSION_JOIN_MAP[dim_name]


def build_published_output_subquery(
    dr: DateRangeFilter,
    filters: DimensionFilter,
    *,
    dimension: str | None = None,
    date_basis: str = "published",
):
    """Distinct processed outputs that were published at least once in the filtered period."""
    date_dd = select(DD.Date_ID, DD.Full_Date).subquery(f"{date_basis}_dd")

    columns = [
        FO.Fact_Output_ID.label("output_id"),
        func.max(FI.Upload_Date_ID).label("upload_date_id"),
        func.max(FO.Create_Date_ID).label("create_date_id"),
        func.min(FP.Published_Date_ID).label("first_published_date_id"),
        func.max(func.extract('epoch', FO.Created_Duration)).label("output_duration_seconds"),
        func.max(func.extract('epoch', FP.Published_Duration)).label("published_duration_seconds"),
        func.max(case((FP.Is_Billable.is_(True), 1), else_=0)).label("billable_output"),
        func.coalesce(func.sum(case((FP.Is_Billable.is_(True), 1), else_=0)), 0).label("billable_publish_events"),
        func.count(FP.Fact_Publish_ID).label("publish_events"),
    ]
    group_cols = [FO.Fact_Output_ID]
    stmt = (
        select(*columns)
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
    )
    if date_basis == "upload":
        stmt = stmt.join(date_dd, FI.Upload_Date_ID == date_dd.c.Date_ID)
    elif date_basis == "create":
        stmt = stmt.join(date_dd, FO.Create_Date_ID == date_dd.c.Date_ID)
    else:
        stmt = stmt.join(date_dd, FP.Published_Date_ID == date_dd.c.Date_ID)

    dc_joined = False
    du_joined = False
    if dimension:
        table, join_cond, id_col, label_col = get_dimension_cols(dimension)
        if dimension == "platform":
            stmt = stmt.join(table, FP.Platform_ID == table.Platform_ID)
        elif dimension == "output_type":
            stmt = stmt.join(table, FO.Output_Type_ID == table.Output_Type_ID)
        else:
            stmt = stmt.join(table, join_cond)
            dc_joined = dimension in {"channel", "client"}
            du_joined = dimension in {"user", "team"}
        stmt = stmt.add_columns(id_col.label("dimension_id"), label_col.label("dimension_label"))
        group_cols.extend([id_col, label_col])

    stmt = stmt.group_by(*group_cols)
    stmt = apply_date_filter(stmt, date_dd.c.Full_Date, dr)
    stmt = apply_dimension_filters(
        stmt,
        filters,
        has_fi=True,
        has_fp=True,
        dc_joined=dc_joined,
        du_joined=du_joined,
    )
    return stmt.subquery("published_outputs")


def build_published_input_subquery(
    dr: DateRangeFilter,
    filters: DimensionFilter,
    *,
    dimension: str | None = None,
    date_basis: str = "published",
):
    """Distinct uploaded inputs that produced at least one published output in the filtered period."""
    date_dd = select(DD.Date_ID, DD.Full_Date).subquery(f"pub_input_{date_basis}_dd")

    columns = [
        FI.Fact_Input_ID.label("input_fact_id"),
        func.max(FI.Upload_Date_ID).label("upload_date_id"),
        func.max(func.extract('epoch', FI.Uploaded_Duration)).label("uploaded_duration_seconds"),
    ]
    group_cols = [FI.Fact_Input_ID]
    stmt = (
        select(*columns)
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
    )
    if date_basis == "upload":
        stmt = stmt.join(date_dd, FI.Upload_Date_ID == date_dd.c.Date_ID)
    elif date_basis == "create":
        stmt = stmt.join(date_dd, FO.Create_Date_ID == date_dd.c.Date_ID)
    else:
        stmt = stmt.join(date_dd, FP.Published_Date_ID == date_dd.c.Date_ID)

    dc_joined = False
    du_joined = False
    if dimension:
        table, join_cond, id_col, label_col = get_dimension_cols(dimension)
        if dimension == "platform":
            stmt = stmt.join(table, FP.Platform_ID == table.Platform_ID)
        elif dimension == "output_type":
            stmt = stmt.join(table, FO.Output_Type_ID == table.Output_Type_ID)
        else:
            stmt = stmt.join(table, join_cond)
            dc_joined = dimension in {"channel", "client"}
            du_joined = dimension in {"user", "team"}
        stmt = stmt.add_columns(id_col.label("dimension_id"), label_col.label("dimension_label"))
        group_cols.extend([id_col, label_col])

    stmt = stmt.group_by(*group_cols)
    stmt = apply_date_filter(stmt, date_dd.c.Full_Date, dr)
    stmt = apply_dimension_filters(
        stmt,
        filters,
        has_fi=True,
        has_fp=True,
        dc_joined=dc_joined,
        du_joined=du_joined,
    )
    return stmt.subquery("published_inputs")


def build_processed_input_subquery(
    dr: DateRangeFilter,
    filters: DimensionFilter,
    *,
    dimension: str | None = None,
    date_basis: str = "create",
):
    """Distinct uploaded inputs that produced at least one processed output in the filtered period."""
    date_dd = select(DD.Date_ID, DD.Full_Date).subquery(f"proc_input_{date_basis}_dd")

    columns = [
        FI.Fact_Input_ID.label("input_fact_id"),
        func.max(FI.Upload_Date_ID).label("upload_date_id"),
        func.min(FO.Create_Date_ID).label("first_create_date_id"),
        func.max(func.extract('epoch', FI.Uploaded_Duration)).label("uploaded_duration_seconds"),
        func.count(FO.Fact_Output_ID).label("output_count"),
    ]
    group_cols = [FI.Fact_Input_ID]
    stmt = (
        select(*columns)
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
    )
    if date_basis == "upload":
        stmt = stmt.join(date_dd, FI.Upload_Date_ID == date_dd.c.Date_ID)
    else:
        stmt = stmt.join(date_dd, FO.Create_Date_ID == date_dd.c.Date_ID)

    dc_joined = False
    du_joined = False
    if dimension:
        table, join_cond, id_col, label_col = get_dimension_cols(dimension)
        if dimension == "platform":
            stmt = stmt.join(FP, FP.Fact_Output_ID == FO.Fact_Output_ID)
            stmt = stmt.join(table, FP.Platform_ID == table.Platform_ID)
        elif dimension == "output_type":
            stmt = stmt.join(table, FO.Output_Type_ID == table.Output_Type_ID)
        else:
            stmt = stmt.join(table, join_cond)
            dc_joined = dimension in {"channel", "client"}
            du_joined = dimension in {"user", "team"}
        stmt = stmt.add_columns(id_col.label("dimension_id"), label_col.label("dimension_label"))
        group_cols.extend([id_col, label_col])

    stmt = stmt.group_by(*group_cols)
    stmt = apply_date_filter(stmt, date_dd.c.Full_Date, dr)
    stmt = apply_dimension_filters(
        stmt,
        filters,
        has_fi=True,
        dc_joined=dc_joined,
        du_joined=du_joined,
    )
    return stmt.subquery("processed_inputs")


# ──────────────────────────────────────────────
# KPI computation
# ──────────────────────────────────────────────

async def compute_kpi_summary(
    db: AsyncSession,
    dr: DateRangeFilter,
    filters: DimensionFilter,
) -> KPISummaryResponse:
    """Compute the top-level KPI summary (Uploaded / Processed / Published)."""

    # --- Uploaded ---
    upload_dd = select(DD.Date_ID, DD.Full_Date).subquery("upload_dd")
    uploaded_q = (
        select(
            func.count(FI.Fact_Input_ID).label("cnt"),
            func.coalesce(func.extract('epoch', func.sum(FI.Uploaded_Duration)), 0).label("dur"),
        )
        .join(upload_dd, FI.Upload_Date_ID == upload_dd.c.Date_ID)
    )
    uploaded_q = apply_date_filter(uploaded_q, upload_dd.c.Full_Date, dr)
    uploaded_q = apply_dimension_filters(uploaded_q, filters, has_fi=True)
    up_res = (await db.execute(uploaded_q)).one()

    up_pub_sub = build_published_input_subquery(dr, filters, date_basis="upload")
    up_pub_q = select(
        func.count(up_pub_sub.c.input_fact_id).label("cnt"),
        func.coalesce(func.sum(up_pub_sub.c.uploaded_duration_seconds), 0).label("dur"),
    )
    up_pub_res = (await db.execute(up_pub_q)).one()

    uploaded = KPIWithPublished(
        total=KPIValue(count=up_res.cnt, duration_seconds=up_res.dur,
                       duration_hours=round(up_res.dur / 3600, 2)),
        published=KPIValue(count=up_pub_res.cnt, duration_seconds=up_pub_res.dur,
                           duration_hours=round(up_pub_res.dur / 3600, 2)),
        publish_rate_pct=round(up_pub_res.cnt / up_res.cnt * 100, 2) if up_res.cnt else 0.0,
    )

    # --- Processed (output videos) ---
    create_dd = select(DD.Date_ID, DD.Full_Date).subquery("create_dd")
    proc_q = (
        select(
            func.count(FO.Fact_Output_ID).label("cnt"),
            func.coalesce(func.extract('epoch', func.sum(FO.Created_Duration)), 0).label("dur"),
        )
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(create_dd, FO.Create_Date_ID == create_dd.c.Date_ID)
    )
    proc_q = apply_date_filter(proc_q, create_dd.c.Full_Date, dr)
    proc_q = apply_dimension_filters(proc_q, filters, has_fi=True)
    proc_res = (await db.execute(proc_q)).one()

    proc_pub_sub = build_published_output_subquery(dr, filters, date_basis="create")
    proc_pub_q = select(
        func.count(proc_pub_sub.c.output_id).label("cnt"),
        func.coalesce(func.sum(proc_pub_sub.c.output_duration_seconds), 0).label("dur"),
    )
    proc_pub_res = (await db.execute(proc_pub_q)).one()

    processed = KPIWithPublished(
        total=KPIValue(count=proc_res.cnt, duration_seconds=proc_res.dur,
                       duration_hours=round(proc_res.dur / 3600, 2)),
        published=KPIValue(count=proc_pub_res.cnt, duration_seconds=proc_pub_res.dur,
                           duration_hours=round(proc_pub_res.dur / 3600, 2)),
        publish_rate_pct=round(proc_pub_res.cnt / proc_res.cnt * 100, 2) if proc_res.cnt else 0.0,
    )

    # --- Published ---
    pub_sub = build_published_output_subquery(dr, filters)
    pub_q = select(
        func.count(pub_sub.c.output_id).label("cnt"),
        func.coalesce(func.sum(pub_sub.c.output_duration_seconds), 0).label("dur"),
    )
    pub_res = (await db.execute(pub_q)).one()

    published = KPIValue(
        count=pub_res.cnt,
        duration_seconds=pub_res.dur,
        duration_hours=round(pub_res.dur / 3600, 2),
    )

    return KPISummaryResponse(uploaded=uploaded, processed=processed, published=published)


def compute_delta(current: dict, previous: dict) -> tuple[dict, dict]:
    """Return (delta, pct_change) dicts comparing two KPI dicts."""
    delta = {}
    pct = {}
    for key in current:
        if isinstance(current[key], dict):
            d, p = compute_delta(current[key], previous.get(key, {}))
            delta[key] = d
            pct[key] = p
        elif isinstance(current[key], (int, float)):
            prev_val = previous.get(key, 0)
            delta[key] = round(current[key] - prev_val, 4)
            pct[key] = round((current[key] - prev_val) / prev_val * 100, 2) if prev_val else None
        else:
            delta[key] = None
            pct[key] = None
    return delta, pct
