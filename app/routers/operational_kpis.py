"""Operational KPI endpoints - metrics derivable from the pipeline data."""

from fastapi import APIRouter, Depends
from sqlalchemy import String, case, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import AnalyticsRequest, ApiResponse, CategoryPerformance, OperationalKPIs
from app.services.analytics_service import (
    DD,
    DC,
    DL,
    DP,
    DOT,
    DU,
    FDQ,
    FI,
    FO,
    FP,
    apply_date_filter,
    apply_dimension_filters,
    build_processed_input_subquery,
    build_published_output_subquery,
)

router = APIRouter(prefix="/kpi", tags=["Operational KPIs"])


@router.post("/operational", response_model=ApiResponse)
async def operational_kpis(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Composite operational metrics using context-appropriate grains."""
    dd_up = select(DD.Date_ID, DD.Full_Date, DD.Month, DD.Year).subquery("dd_up")
    dd_cr = select(DD.Date_ID, DD.Full_Date).subquery("dd_cr")
    dd_pb = select(DD.Date_ID, DD.Full_Date, DD.Month, DD.Year).subquery("dd_pb")

    active_q = (
        select(
            func.count(distinct(DC.Client_ID)).label("active_clients"),
            func.count(distinct(FI.Channel_ID)).label("active_channels"),
            func.count(distinct(FI.User_ID)).label("active_users"),
            func.count(distinct(FI.Language_ID)).label("active_langs"),
        )
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
    )
    active_q = apply_date_filter(active_q, dd_up.c.Full_Date, body.date_range)
    active_q = apply_dimension_filters(active_q, body.filters, has_fi=True, dc_joined=True)
    ar = (await db.execute(active_q)).one()

    total_clients = (await db.execute(select(func.count(distinct(DC.Client_ID))))).scalar() or 0
    total_users = (await db.execute(select(func.count(distinct(DU.User_ID))))).scalar() or 0
    total_channels = (await db.execute(select(func.count(distinct(DC.Channel_ID))))).scalar() or 0

    # Output production is output-grain by design.
    clip_q = (
        select(
            func.count(distinct(FI.Fact_Input_ID)).label("unique_inputs"),
            func.count(FO.Fact_Output_ID).label("total_outputs"),
            func.coalesce(func.avg(func.extract("epoch", FI.Uploaded_Duration)), 0).label("avg_input_dur"),
            func.coalesce(func.avg(func.extract("epoch", FO.Created_Duration)), 0).label("avg_output_dur"),
        )
        .join(FO, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
    )
    clip_q = apply_date_filter(clip_q, dd_up.c.Full_Date, body.date_range)
    clip_q = apply_dimension_filters(clip_q, body.filters, has_fi=True)
    cr = (await db.execute(clip_q)).one()
    clip_rate = round(cr.total_outputs / cr.unique_inputs, 2) if cr.unique_inputs else 0.0
    compression = round(cr.avg_output_dur / cr.avg_input_dur, 4) if cr.avg_input_dur else 0.0

    # Upload -> process conversion is input-grain.
    total_input_q = (
        select(func.count(FI.Fact_Input_ID).label("c"))
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
    )
    total_input_q = apply_date_filter(total_input_q, dd_up.c.Full_Date, body.date_range)
    total_input_q = apply_dimension_filters(total_input_q, body.filters, has_fi=True)
    total_inputs = (await db.execute(total_input_q)).scalar() or 0

    processed_input_sub = build_processed_input_subquery(body.date_range, body.filters, date_basis="upload")
    inputs_with_output_q = select(func.count(processed_input_sub.c.input_fact_id).label("c"))
    inputs_with_output = (await db.execute(inputs_with_output_q)).scalar() or 0
    conversion_pct = round(inputs_with_output / total_inputs * 100, 2) if total_inputs else 0.0

    # Billing is publish-event grain because that is the natural billing surface.
    bill_q = (
        select(
            func.count(FP.Fact_Publish_ID).label("total_pub"),
            func.coalesce(func.sum(case((FP.Is_Billable.is_(True), 1), else_=0)), 0).label("billable"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
    )
    bill_q = apply_date_filter(bill_q, dd_pb.c.Full_Date, body.date_range)
    bill_q = apply_dimension_filters(bill_q, body.filters, has_fi=True, has_fp=True)
    br = (await db.execute(bill_q)).one()
    billable_pct = round(br.billable / br.total_pub * 100, 2) if br.total_pub else 0.0

    # Velocity uses first downstream event and clamps negative data anomalies.
    velocity_q = (
        select(
            func.avg(
                func.greatest(
                    func.extract("epoch", dd_cr.c.Full_Date) - func.extract("epoch", dd_up.c.Full_Date),
                    0,
                )
            ).label("up_to_proc"),
        )
        .select_from(processed_input_sub)
        .join(dd_up, processed_input_sub.c.upload_date_id == dd_up.c.Date_ID)
        .join(dd_cr, processed_input_sub.c.first_create_date_id == dd_cr.c.Date_ID)
    )
    vr = (await db.execute(velocity_q)).one()
    avg_up_to_proc = round(float(vr.up_to_proc or 0) / 86400, 1)

    published_output_sub = build_published_output_subquery(body.date_range, body.filters)
    velocity_pub_q = (
        select(
            func.avg(
                func.greatest(
                    func.extract("epoch", dd_pb.c.Full_Date) - func.extract("epoch", dd_cr.c.Full_Date),
                    0,
                )
            ).label("proc_to_pub"),
        )
        .select_from(published_output_sub)
        .join(dd_cr, published_output_sub.c.create_date_id == dd_cr.c.Date_ID)
        .join(dd_pb, published_output_sub.c.first_published_date_id == dd_pb.c.Date_ID)
    )
    vpr = (await db.execute(velocity_pub_q)).one()
    avg_proc_to_pub = round(float(vpr.proc_to_pub or 0) / 86400, 1)

    reach_q = (
        select(func.count(distinct(DP.Platform_ID)).label("plat_cnt"))
        .select_from(FP)
        .join(DP, FP.Platform_ID == DP.Platform_ID)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
    )
    reach_q = apply_date_filter(reach_q, dd_pb.c.Full_Date, body.date_range)
    reach_q = apply_dimension_filters(reach_q, body.filters, has_fi=True, has_fp=True)
    unique_platforms = (await db.execute(reach_q)).scalar() or 0

    # Overall data completeness across pipeline fact grains.
    input_records_q = (
        select(func.count(FI.Fact_Input_ID))
        .select_from(FI)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
    )
    input_records_q = apply_date_filter(input_records_q, dd_up.c.Full_Date, body.date_range)
    input_records_q = apply_dimension_filters(input_records_q, body.filters, has_fi=True)
    total_input_records = (await db.execute(input_records_q)).scalar() or 0

    output_records_q = (
        select(func.count(FO.Fact_Output_ID))
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
    )
    output_records_q = apply_date_filter(output_records_q, dd_cr.c.Full_Date, body.date_range)
    output_records_q = apply_dimension_filters(output_records_q, body.filters, has_fi=True)
    total_output_records = (await db.execute(output_records_q)).scalar() or 0

    publish_records_q = (
        select(func.count(FP.Fact_Publish_ID))
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
    )
    publish_records_q = apply_date_filter(publish_records_q, dd_pb.c.Full_Date, body.date_range)
    publish_records_q = apply_dimension_filters(publish_records_q, body.filters, has_fi=True, has_fp=True)
    total_publish_records = (await db.execute(publish_records_q)).scalar() or 0

    dq_q = (
        select(func.count(FDQ.DQ_Log_ID))
        .select_from(FDQ)
        .join(FI, FDQ.Input_Video_ID == FI.Input_Video_ID)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
    )
    dq_q = apply_date_filter(dq_q, dd_up.c.Full_Date, body.date_range)
    dq_q = apply_dimension_filters(dq_q, body.filters, has_fi=True)
    dq_errors = (await db.execute(dq_q)).scalar() or 0

    total_records = total_input_records + total_output_records + total_publish_records
    data_completeness_pct = round(max(total_records - dq_errors, 0) / total_records * 100, 2) if total_records else 0.0

    # Output-level publish leakage.
    output_publish_q = (
        select(
            func.count(distinct(FO.Fact_Output_ID)).label("total_outputs"),
            func.count(distinct(case((FP.Fact_Publish_ID.is_(None), FO.Fact_Output_ID)))).label("outputs_without_publishes"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
        .outerjoin(FP, FP.Fact_Output_ID == FO.Fact_Output_ID)
    )
    output_publish_q = apply_date_filter(output_publish_q, dd_cr.c.Full_Date, body.date_range)
    output_publish_q = apply_dimension_filters(output_publish_q, body.filters, has_fi=True, has_fo=True)
    opr = (await db.execute(output_publish_q)).one()
    publishing_dropout_pct = round(opr.outputs_without_publishes / opr.total_outputs * 100, 2) if opr.total_outputs else 0.0

    translation_rate_q = (
        select(
            func.count(FO.Fact_Output_ID).label("total_outputs"),
            func.count(
                case((FO.Language_ID != FI.Language_ID, 1), else_=None)
            ).label("translated_outputs"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
    )
    translation_rate_q = apply_date_filter(translation_rate_q, dd_cr.c.Full_Date, body.date_range)
    translation_rate_q = apply_dimension_filters(translation_rate_q, body.filters, has_fi=True, has_fo=True)
    trr = (await db.execute(translation_rate_q)).one()
    translation_rate_pct = round(trr.translated_outputs / trr.total_outputs * 100, 2) if trr.total_outputs else 0.0

    published_output_duration_sub = (
        select(
            FO.Fact_Output_ID.label("output_id"),
            func.max(case((FO.Language_ID != FI.Language_ID, 1), else_=0)).label("is_translated"),
            func.max(func.extract("epoch", FP.Published_Duration)).label("published_duration_seconds"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
        .group_by(FO.Fact_Output_ID)
    )
    published_output_duration_sub = apply_date_filter(published_output_duration_sub, dd_pb.c.Full_Date, body.date_range)
    published_output_duration_sub = apply_dimension_filters(published_output_duration_sub, body.filters, has_fi=True, has_fo=True, has_fp=True)
    published_output_duration_sub = published_output_duration_sub.subquery("published_output_duration_sub")

    translation_uplift_q = select(
        func.avg(
            case(
                (published_output_duration_sub.c.is_translated == 1, published_output_duration_sub.c.published_duration_seconds),
                else_=None,
            )
        ).label("translated_avg_published"),
        func.avg(
            case(
                (published_output_duration_sub.c.is_translated == 0, published_output_duration_sub.c.published_duration_seconds),
                else_=None,
            )
        ).label("non_translated_avg_published"),
    )
    tur = (await db.execute(translation_uplift_q)).one()
    translation_duration_uplift = round(float(tur.translated_avg_published or 0) / float(tur.non_translated_avg_published or 0), 2) if tur.non_translated_avg_published else 0.0

    weekend_publish_q = (
        select(
            func.count(FP.Fact_Publish_ID).label("total_publishes"),
            func.coalesce(
                func.sum(
                    case(
                        (func.extract("dow", dd_pb.c.Full_Date).in_([0, 6]), 1),
                        else_=0,
                    )
                ),
                0,
            ).label("weekend_publishes"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
    )
    weekend_publish_q = apply_date_filter(weekend_publish_q, dd_pb.c.Full_Date, body.date_range)
    weekend_publish_q = apply_dimension_filters(weekend_publish_q, body.filters, has_fi=True, has_fo=True, has_fp=True)
    wpr = (await db.execute(weekend_publish_q)).one()
    weekend_publish_rate_pct = round(wpr.weekend_publishes / wpr.total_publishes * 100, 2) if wpr.total_publishes else 0.0

    # Output-type reuse and full repurposing are evaluated per uploaded input.
    input_output_type_sub = (
        select(
            FI.Fact_Input_ID.label("input_id"),
            func.count(distinct(FO.Output_Type_ID)).label("distinct_output_types"),
        )
        .select_from(FI)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
        .outerjoin(FO, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .group_by(FI.Fact_Input_ID)
    )
    input_output_type_sub = apply_date_filter(input_output_type_sub, dd_up.c.Full_Date, body.date_range)
    input_output_type_sub = apply_dimension_filters(input_output_type_sub, body.filters, has_fi=True)
    input_output_type_sub = input_output_type_sub.subquery("input_output_type_sub")

    repurposing_q = select(
        func.coalesce(func.avg(input_output_type_sub.c.distinct_output_types), 0).label("content_reuse_ratio"),
        func.coalesce(
            func.avg(case((input_output_type_sub.c.distinct_output_types == 5, 1.0), else_=0.0)) * 100,
            0,
        ).label("full_repurposing_rate_pct"),
    )
    rr = (await db.execute(repurposing_q)).one()

    # Inference: fragment rate = share of outputs that are not "Full Package".
    mix_fragment_q = (
        select(
            func.count(FO.Fact_Output_ID).label("mix_outputs"),
            func.coalesce(
                func.sum(case((DOT.Output_Type != "Full Package", 1), else_=0)),
                0,
            ).label("mix_fragment_outputs"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DL, FO.Language_ID == DL.Language_ID)
        .join(DOT, FO.Output_Type_ID == DOT.Output_Type_ID)
        .join(dd_cr, FO.Create_Date_ID == dd_cr.c.Date_ID)
        .where(DL.Language_Name == "mix")
    )
    mix_fragment_q = apply_date_filter(mix_fragment_q, dd_cr.c.Full_Date, body.date_range)
    mix_fragment_q = apply_dimension_filters(mix_fragment_q, body.filters, has_fi=True, has_fo=True)
    mfr = (await db.execute(mix_fragment_q)).one()
    mixed_language_fragment_rate = round(mfr.mix_fragment_outputs / mfr.mix_outputs * 100, 2) if mfr.mix_outputs else 0.0

    channel_language_sub = (
        select(
            FI.Channel_ID.label("channel_id"),
            func.count(distinct(FI.Language_ID)).label("language_count"),
        )
        .select_from(FI)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
        .group_by(FI.Channel_ID)
    )
    channel_language_sub = apply_date_filter(channel_language_sub, dd_up.c.Full_Date, body.date_range)
    channel_language_sub = apply_dimension_filters(channel_language_sub, body.filters, has_fi=True)
    channel_language_sub = channel_language_sub.subquery("channel_language_sub")
    avg_languages_per_channel = round(float((await db.execute(select(func.coalesce(func.avg(channel_language_sub.c.language_count), 0)))).scalar() or 0), 2)

    total_platforms_available = (await db.execute(select(func.count(distinct(DP.Platform_ID))))).scalar() or 0
    client_platform_sub = (
        select(
            DC.Client_ID.label("client_id"),
            func.count(distinct(FP.Platform_ID)).label("platform_count"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
        .group_by(DC.Client_ID)
    )
    client_platform_sub = apply_date_filter(client_platform_sub, dd_pb.c.Full_Date, body.date_range)
    client_platform_sub = apply_dimension_filters(client_platform_sub, body.filters, has_fi=True, has_fo=True, has_fp=True, dc_joined=True)
    client_platform_sub = client_platform_sub.subquery("client_platform_sub")
    cps = (await db.execute(
        select(
            func.coalesce(func.avg(client_platform_sub.c.platform_count), 0).label("avg_platforms_per_client"),
            func.coalesce(
                func.sum(case((client_platform_sub.c.platform_count == total_platforms_available, 1), else_=0)),
                0,
            ).label("fully_saturated_clients"),
        )
    )).one()

    publish_month_expr = func.concat(
        func.cast(dd_pb.c.Year, String),
        "-",
        func.lpad(func.cast(dd_pb.c.Month, String), 2, "0"),
    )

    channel_monthly_sub = (
        select(
            FI.Channel_ID.label("channel_id"),
            publish_month_expr.label("publish_month"),
            func.count(distinct(FO.Fact_Output_ID)).label("published_clips"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
        .group_by(FI.Channel_ID, "publish_month")
    )
    channel_monthly_sub = apply_date_filter(channel_monthly_sub, dd_pb.c.Full_Date, body.date_range)
    channel_monthly_sub = apply_dimension_filters(channel_monthly_sub, body.filters, has_fi=True, has_fo=True, has_fp=True)
    channel_monthly_sub = channel_monthly_sub.subquery("channel_monthly_sub")
    channel_avg_sub = (
        select(
            channel_monthly_sub.c.channel_id,
            func.avg(channel_monthly_sub.c.published_clips).label("avg_monthly_clips"),
        )
        .group_by(channel_monthly_sub.c.channel_id)
        .subquery("channel_avg_sub")
    )
    cts = (await db.execute(
        select(
            func.coalesce(func.avg(channel_avg_sub.c.avg_monthly_clips), 0).label("avg_monthly_published_clips_per_channel"),
            func.coalesce(func.max(channel_avg_sub.c.avg_monthly_clips), 0).label("best_channel_monthly_clips"),
            func.coalesce(func.min(channel_avg_sub.c.avg_monthly_clips), 0).label("worst_channel_monthly_clips"),
            func.coalesce(func.stddev_pop(channel_avg_sub.c.avg_monthly_clips), 0).label("channel_monthly_throughput_stddev"),
        )
    )).one()

    client_monthly_sub = (
        select(
            DC.Client_ID.label("client_id"),
            DC.Client_Name.label("client_name"),
            publish_month_expr.label("publish_month"),
            func.count(distinct(FO.Fact_Output_ID)).label("published_clips"),
        )
        .select_from(FP)
        .join(FO, FP.Fact_Output_ID == FO.Fact_Output_ID)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DC, FI.Channel_ID == DC.Channel_ID)
        .join(dd_pb, FP.Published_Date_ID == dd_pb.c.Date_ID)
        .group_by(DC.Client_ID, DC.Client_Name, "publish_month")
    )
    client_monthly_sub = apply_date_filter(client_monthly_sub, dd_pb.c.Full_Date, body.date_range)
    client_monthly_sub = apply_dimension_filters(client_monthly_sub, body.filters, has_fi=True, has_fo=True, has_fp=True, dc_joined=True)
    client_monthly_sub = client_monthly_sub.subquery("client_monthly_sub")
    client_avg_sub = (
        select(
            client_monthly_sub.c.client_id,
            client_monthly_sub.c.client_name,
            func.avg(client_monthly_sub.c.published_clips).label("avg_monthly_clips"),
        )
        .group_by(client_monthly_sub.c.client_id, client_monthly_sub.c.client_name)
        .subquery("client_avg_sub")
    )
    client_avg_summary = (await db.execute(
        select(
            func.coalesce(func.avg(client_avg_sub.c.avg_monthly_clips), 0).label("avg_monthly_published_clips_per_client"),
            func.coalesce(func.max(client_avg_sub.c.avg_monthly_clips), 0).label("best_client_monthly_clips"),
            func.coalesce(func.min(client_avg_sub.c.avg_monthly_clips), 0).label("worst_client_monthly_clips"),
        )
    )).one()
    best_client = (await db.execute(
        select(client_avg_sub.c.client_name, client_avg_sub.c.avg_monthly_clips)
        .order_by(client_avg_sub.c.avg_monthly_clips.desc(), client_avg_sub.c.client_name.asc())
        .limit(1)
    )).first()
    worst_client = (await db.execute(
        select(client_avg_sub.c.client_name, client_avg_sub.c.avg_monthly_clips)
        .order_by(client_avg_sub.c.avg_monthly_clips.asc(), client_avg_sub.c.client_name.asc())
        .limit(1)
    )).first()

    upload_month_expr = func.concat(
        func.cast(dd_up.c.Year, String),
        "-",
        func.lpad(func.cast(dd_up.c.Month, String), 2, "0"),
    )
    user_months_sub = (
        select(
            FI.User_ID.label("user_id"),
            func.count(distinct(upload_month_expr)).label("active_months"),
        )
        .select_from(FI)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
        .group_by(FI.User_ID)
    )
    user_months_sub = apply_date_filter(user_months_sub, dd_up.c.Full_Date, body.date_range)
    user_months_sub = apply_dimension_filters(user_months_sub, body.filters, has_fi=True)
    user_months_sub = user_months_sub.subquery("user_months_sub")
    urs = (await db.execute(
        select(
            func.count(user_months_sub.c.user_id).label("total_uploading_users"),
            func.coalesce(func.sum(case((user_months_sub.c.active_months >= 7, 1), else_=0)), 0).label("retained_users"),
            func.coalesce(func.sum(case((user_months_sub.c.active_months == 1, 1), else_=0)), 0).label("single_month_users"),
        )
    )).one()
    user_upload_retention_rate_pct = round(urs.retained_users / urs.total_uploading_users * 100, 2) if urs.total_uploading_users else 0.0
    single_month_user_pct = round(urs.single_month_users / urs.total_uploading_users * 100, 2) if urs.total_uploading_users else 0.0

    user_upload_output_sub = (
        select(
            FI.User_ID.label("user_id"),
            func.count(distinct(FI.Fact_Input_ID)).label("uploads"),
            func.count(FO.Fact_Output_ID).label("outputs"),
        )
        .select_from(FI)
        .join(dd_up, FI.Upload_Date_ID == dd_up.c.Date_ID)
        .outerjoin(FO, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .group_by(FI.User_ID)
    )
    user_upload_output_sub = apply_date_filter(user_upload_output_sub, dd_up.c.Full_Date, body.date_range)
    user_upload_output_sub = apply_dimension_filters(user_upload_output_sub, body.filters, has_fi=True)
    user_upload_output_sub = user_upload_output_sub.subquery("user_upload_output_sub")
    user_cohort_sub = (
        select(
            user_months_sub.c.user_id,
            user_months_sub.c.active_months,
            user_upload_output_sub.c.uploads,
            user_upload_output_sub.c.outputs,
        )
        .select_from(user_months_sub)
        .join(user_upload_output_sub, user_months_sub.c.user_id == user_upload_output_sub.c.user_id)
        .subquery("user_cohort_sub")
    )
    ucp = (await db.execute(
        select(
            func.coalesce(func.sum(case((user_cohort_sub.c.active_months < 7, user_cohort_sub.c.outputs), else_=0)), 0).label("rare_outputs"),
            func.coalesce(func.sum(case((user_cohort_sub.c.active_months < 7, user_cohort_sub.c.uploads), else_=0)), 0).label("rare_uploads"),
            func.coalesce(func.sum(case((user_cohort_sub.c.active_months >= 7, user_cohort_sub.c.outputs), else_=0)), 0).label("active_outputs"),
            func.coalesce(func.sum(case((user_cohort_sub.c.active_months >= 7, user_cohort_sub.c.uploads), else_=0)), 0).label("active_uploads"),
        )
    )).one()
    rarely_active_clips_per_upload = round(ucp.rare_outputs / ucp.rare_uploads, 2) if ucp.rare_uploads else 0.0
    active_user_clips_per_upload = round(ucp.active_outputs / ucp.active_uploads, 2) if ucp.active_uploads else 0.0
    rarely_active_user_cmr_paradox = round(rarely_active_clips_per_upload / active_user_clips_per_upload, 2) if active_user_clips_per_upload else 0.0

    result = OperationalKPIs(
        active_clients=ar.active_clients,
        total_clients=total_clients,
        active_users=ar.active_users,
        total_users=total_users,
        active_channels=ar.active_channels,
        total_channels=total_channels,
        clip_multiplication_rate=clip_rate,
        duration_compression_ratio=compression,
        avg_input_duration_seconds=round(float(cr.avg_input_dur), 1),
        avg_output_duration_seconds=round(float(cr.avg_output_dur), 1),
        billable_rate_pct=billable_pct,
        input_to_output_conversion_pct=conversion_pct,
        avg_days_upload_to_process=avg_up_to_proc,
        avg_days_process_to_publish=avg_proc_to_pub,
        avg_days_upload_to_publish=round(avg_up_to_proc + avg_proc_to_pub, 1),
        multi_platform_reach=unique_platforms,
        unique_platforms_used=unique_platforms,
        unique_languages_used=ar.active_langs,
        data_completeness_pct=data_completeness_pct,
        publishing_dropout_pct=publishing_dropout_pct,
        translation_rate_pct=translation_rate_pct,
        translation_duration_uplift=translation_duration_uplift,
        weekend_publish_rate_pct=weekend_publish_rate_pct,
        content_reuse_ratio=round(float(rr.content_reuse_ratio or 0), 2),
        full_repurposing_rate_pct=round(float(rr.full_repurposing_rate_pct or 0), 2),
        mixed_language_fragment_rate=mixed_language_fragment_rate,
        avg_languages_per_channel=avg_languages_per_channel,
        avg_platforms_per_client=round(float(cps.avg_platforms_per_client or 0), 2),
        fully_saturated_clients=int(cps.fully_saturated_clients or 0),
        total_platforms_available=total_platforms_available,
        avg_monthly_published_clips_per_channel=round(float(cts.avg_monthly_published_clips_per_channel or 0), 2),
        best_channel_monthly_clips=round(float(cts.best_channel_monthly_clips or 0), 2),
        worst_channel_monthly_clips=round(float(cts.worst_channel_monthly_clips or 0), 2),
        channel_monthly_throughput_stddev=round(float(cts.channel_monthly_throughput_stddev or 0), 2),
        avg_monthly_published_clips_per_client=round(float(client_avg_summary.avg_monthly_published_clips_per_client or 0), 2),
        best_client_monthly_clips=round(float(client_avg_summary.best_client_monthly_clips or 0), 2),
        best_client_name=best_client.client_name if best_client else None,
        worst_client_monthly_clips=round(float(client_avg_summary.worst_client_monthly_clips or 0), 2),
        worst_client_name=worst_client.client_name if worst_client else None,
        user_upload_retention_rate_pct=user_upload_retention_rate_pct,
        single_month_user_pct=single_month_user_pct,
        rarely_active_user_cmr_paradox=rarely_active_user_cmr_paradox,
        rarely_active_clips_per_upload=rarely_active_clips_per_upload,
        active_user_clips_per_upload=active_user_clips_per_upload,
    )
    return ApiResponse(data=result.model_dump())


@router.post("/content-category-performance", response_model=ApiResponse)
async def content_category_performance(body: AnalyticsRequest, db: AsyncSession = Depends(get_db)):
    """Per output-type: uploads, outputs, published, rates, clip multiplication."""
    dd_sub = select(DD.Date_ID, DD.Full_Date).subquery()

    up_q = (
        select(
            DOT.Output_Type_ID.label("cat_id"),
            DOT.Output_Type.label("cat_name"),
            func.count(FI.Fact_Input_ID).label("uploads"),
            func.count(distinct(FI.Fact_Input_ID)).label("unique_inputs"),
            func.coalesce(func.extract("epoch", func.sum(FI.Uploaded_Duration)), 0).label("up_dur"),
        )
        .join(DOT, FI.Output_Type_ID == DOT.Output_Type_ID)
        .join(dd_sub, FI.Upload_Date_ID == dd_sub.c.Date_ID)
        .group_by(DOT.Output_Type_ID, DOT.Output_Type)
    )
    up_q = apply_date_filter(up_q, dd_sub.c.Full_Date, body.date_range)
    up_q = apply_dimension_filters(up_q, body.filters, has_fi=True)
    up_rows = (await db.execute(up_q)).all()
    up_map = {r.cat_id: r for r in up_rows}

    out_q = (
        select(
            FO.Output_Type_ID.label("cat_id"),
            DOT.Output_Type.label("cat_name"),
            func.count(FO.Fact_Output_ID).label("outputs"),
            func.coalesce(func.extract("epoch", func.sum(FO.Created_Duration)), 0).label("out_dur"),
        )
        .select_from(FO)
        .join(FI, FO.Fact_Input_ID == FI.Fact_Input_ID)
        .join(DOT, FO.Output_Type_ID == DOT.Output_Type_ID)
        .join(dd_sub, FO.Create_Date_ID == dd_sub.c.Date_ID)
        .group_by(FO.Output_Type_ID, DOT.Output_Type)
    )
    out_q = apply_date_filter(out_q, dd_sub.c.Full_Date, body.date_range)
    out_q = apply_dimension_filters(out_q, body.filters, has_fi=True, has_fo=True)
    out_rows = (await db.execute(out_q)).all()
    out_map = {r.cat_id: r for r in out_rows}

    published_output_sub = build_published_output_subquery(body.date_range, body.filters, dimension="output_type")
    pub_q = (
        select(
            published_output_sub.c.dimension_id.label("cat_id"),
            published_output_sub.c.dimension_label.label("cat_name"),
            func.count(published_output_sub.c.output_id).label("published"),
            func.coalesce(func.sum(published_output_sub.c.billable_output), 0).label("billable"),
        )
        .group_by(published_output_sub.c.dimension_id, published_output_sub.c.dimension_label)
    )
    pub_rows = (await db.execute(pub_q)).all()
    pub_map = {r.cat_id: r for r in pub_rows}

    items = []
    all_cat_ids = sorted(set(up_map) | set(out_map) | set(pub_map))
    for cat_id in all_cat_ids:
        ur = up_map.get(cat_id)
        outr = out_map.get(cat_id)
        pr = pub_map.get(cat_id)
        cat_name = (
            (ur.cat_name if ur else None)
            or (outr.cat_name if outr else None)
            or (pr.cat_name if pr else None)
            or str(cat_id)
        )
        outputs = int(outr.outputs or 0) if outr else 0
        published = int(pr.published or 0) if pr else 0
        billable = int(pr.billable or 0) if pr else 0
        uploads = int(ur.uploads or 0) if ur else 0
        unique_inputs = int(ur.unique_inputs or 0) if ur else 0
        up_dur = float(ur.up_dur or 0) if ur else 0
        items.append(
            CategoryPerformance(
                category_id=cat_id,
                category_name=cat_name,
                total_uploads=uploads,
                total_outputs=outputs,
                total_published=published,
                total_duration_hours=round(up_dur / 3600, 2),
                output_duration_hours=round((outr.out_dur if outr else 0) / 3600, 2),
                publish_rate_pct=round(published / outputs * 100, 2) if outputs else 0.0,
                billable_count=billable,
                billable_rate_pct=round(billable / published * 100, 2) if published else 0.0,
                clip_multiplication_rate=round(outputs / unique_inputs, 2) if unique_inputs else 0.0,
            ).model_dump()
        )
    items.sort(key=lambda x: (x["total_outputs"], x["total_uploads"]), reverse=True)
    return ApiResponse(data=items)
