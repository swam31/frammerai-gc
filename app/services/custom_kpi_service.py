"""Execution and persistence helpers for custom KPIs."""

from __future__ import annotations

import math
import re
import sqlite3
from decimal import Decimal
from typing import Any

import pandas as pd
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.custom_kpi import CustomKPI
from app.nlp.pipeline import (
    Config,
    DB_PATH,
    execute_pipeline,
    generate_nl_answer,
    initialize_database,
)
from app.schemas.custom_kpis import (
    CreateCustomKPIRequest,
    CustomKPIInputMode,
    CustomKPIQueryRequest,
    CustomKPIResult,
    CustomKPISummary,
)

MAX_RESULT_ROWS = 500
MAX_QUERY_LENGTH = 20000
DISALLOWED_SQL_PATTERN = re.compile(
    r"\b(insert|update|delete|alter|drop|create|replace|truncate|attach|detach|vacuum|pragma|reindex|analyze|grant|revoke|commit|rollback|savepoint|release)\b",
    re.IGNORECASE,
)


def _builtin_kpi_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"builtin:{slug}"


def _builtin_kpi_result(name: str, definition: str) -> CustomKPIResult:
    return CustomKPIResult(
        id=_builtin_kpi_id(name),
        name=name,
        description=definition,
        query=f"What is {name}?",
        input_mode=CustomKPIInputMode.natural_language,
        sql=None,
        answer_nl=definition,
        columns=[],
        df_records=[],
        value=None,
        result_type="information",
        row_count=0,
        truncated=False,
    )


def _normalize_scalar(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
    return value


def _sanitize_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sanitized: list[dict[str, Any]] = []
    for row in records:
        sanitized.append({str(key): _normalize_scalar(value) for key, value in row.items()})
    return sanitized


def _extract_value(records: list[dict[str, Any]], columns: list[str]) -> Any:
    if len(records) == 1 and len(columns) == 1:
        return records[0].get(columns[0])
    return None


def _trim_records(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    if len(records) > MAX_RESULT_ROWS:
        return records[:MAX_RESULT_ROWS], True
    return records, False


def _validate_read_only_sql(sql: str) -> str:
    normalized = sql.strip()
    if not normalized:
        raise HTTPException(status_code=422, detail="SQL query cannot be empty.")
    if len(normalized) > MAX_QUERY_LENGTH:
        raise HTTPException(status_code=422, detail="SQL query exceeds the maximum allowed length.")

    trimmed = normalized.rstrip().rstrip(";").strip()
    if not trimmed:
        raise HTTPException(status_code=422, detail="SQL query cannot be empty.")

    statements = [part.strip() for part in re.split(r";\s*", trimmed) if part.strip()]
    if len(statements) != 1:
        raise HTTPException(status_code=422, detail="Only a single SQL statement is allowed.")

    if DISALLOWED_SQL_PATTERN.search(trimmed):
        raise HTTPException(status_code=422, detail="Only read-only SELECT queries are allowed.")

    first_token_match = re.match(r"^\s*(\w+)", trimmed, re.IGNORECASE)
    if not first_token_match:
        raise HTTPException(status_code=422, detail="Unable to parse SQL query.")

    first_token = first_token_match.group(1).lower()
    if first_token not in {"select", "with"}:
        raise HTTPException(status_code=422, detail="Only SELECT queries or CTEs are allowed.")

    return trimmed


def _open_sqlite_read_only() -> sqlite3.Connection:
    initialize_database()
    return sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)


def _execute_exact_sql_sync(sql: str) -> CustomKPIResult:
    normalized_sql = _validate_read_only_sql(sql)
    conn = _open_sqlite_read_only()
    try:
        conn.execute(f"EXPLAIN QUERY PLAN {normalized_sql}").fetchall()
        preview_sql = f"SELECT * FROM ({normalized_sql}) AS custom_kpi_result LIMIT {MAX_RESULT_ROWS + 1}"
        df = pd.read_sql_query(preview_sql, conn)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid SQL query: {exc}") from exc
    finally:
        conn.close()

    truncated = len(df) > MAX_RESULT_ROWS
    if truncated:
        df = df.iloc[:MAX_RESULT_ROWS].copy()

    records = _sanitize_records(df.to_dict(orient="records"))
    columns = [str(column) for column in df.columns.tolist()]
    value = _extract_value(records, columns)
    result_type = "value" if value is not None else "table"
    answer_nl = None

    if records:
        try:
            answer_nl = generate_nl_answer("Summarize this SQL result", pd.DataFrame(records))
        except Exception:
            answer_nl = None

    return CustomKPIResult(
        query=normalized_sql,
        input_mode=CustomKPIInputMode.sql,
        sql=normalized_sql,
        answer_nl=answer_nl,
        columns=columns,
        df_records=[] if result_type == "value" else records,
        value=value,
        result_type=result_type,
        row_count=1 if result_type == "value" and value is not None else len(records),
        truncated=truncated,
    )


def _normalize_pipeline_result(query: str, payload: dict[str, Any]) -> CustomKPIResult:
    columns = [str(column) for column in payload.get("columns", [])]
    records = _sanitize_records(payload.get("df_records", []))
    records, truncated = _trim_records(records)
    value = _extract_value(records, columns)
    result_type = "value" if value is not None else "table"

    return CustomKPIResult(
        query=query,
        input_mode=CustomKPIInputMode.natural_language,
        sql=payload.get("sql"),
        answer_nl=payload.get("answer_nl"),
        columns=columns,
        df_records=[] if result_type == "value" else records,
        value=value,
        result_type=result_type,
        plan=payload.get("plan"),
        plan_ms=payload.get("plan_ms"),
        retrieved_examples=payload.get("retrieved_examples", []),
        attempts=payload.get("attempts", []),
        filters=payload.get("filters", []),
        verification=payload.get("verification"),
        sanity=payload.get("sanity"),
        error=payload.get("error"),
        row_count=1 if result_type == "value" and value is not None else len(records),
        truncated=truncated,
    )


async def execute_custom_kpi_request(body: CustomKPIQueryRequest) -> CustomKPIResult:
    if body.input_mode == CustomKPIInputMode.sql:
        return await run_in_threadpool(_execute_exact_sql_sync, body.query)

    pipeline_payload = await run_in_threadpool(execute_pipeline, body.query)
    result = _normalize_pipeline_result(body.query, pipeline_payload)
    if result.error:
        raise HTTPException(status_code=422, detail=result.error)
    if result.sql is None:
        raise HTTPException(status_code=422, detail="The NLP pipeline could not generate a SQL query.")
    return result


def _model_to_result(model: CustomKPI) -> CustomKPIResult:
    payload = model.result_payload or {}
    return CustomKPIResult(
        id=model.id,
        name=model.name,
        description=model.description,
        query=model.query_text,
        input_mode=CustomKPIInputMode(model.input_mode),
        sql=model.sql_text,
        answer_nl=payload.get("answer_nl"),
        columns=payload.get("columns", []),
        df_records=payload.get("df_records", []),
        value=payload.get("value"),
        result_type=model.result_type,
        plan=payload.get("plan"),
        plan_ms=payload.get("plan_ms"),
        retrieved_examples=payload.get("retrieved_examples", []),
        attempts=payload.get("attempts", []),
        filters=payload.get("filters", []),
        verification=payload.get("verification"),
        sanity=payload.get("sanity"),
        error=payload.get("error"),
        row_count=int(payload.get("row_count", 0) or 0),
        truncated=bool(payload.get("truncated", False)),
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _result_to_payload(result: CustomKPIResult) -> dict[str, Any]:
    return {
        "answer_nl": result.answer_nl,
        "columns": result.columns,
        "df_records": result.df_records,
        "value": result.value,
        "plan": result.plan,
        "plan_ms": result.plan_ms,
        "retrieved_examples": result.retrieved_examples,
        "attempts": result.attempts,
        "filters": result.filters,
        "verification": result.verification,
        "sanity": result.sanity,
        "error": result.error,
        "row_count": result.row_count,
        "truncated": result.truncated,
    }


async def create_custom_kpi(db: AsyncSession, body: CreateCustomKPIRequest) -> CustomKPIResult:
    existing = await db.scalar(
        select(CustomKPI).where(func.lower(CustomKPI.name) == body.name.lower())
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"A custom KPI named '{body.name}' already exists.")

    result = await execute_custom_kpi_request(
        CustomKPIQueryRequest(query=body.query, input_mode=body.input_mode)
    )

    model = CustomKPI(
        name=body.name,
        description=body.description,
        input_mode=body.input_mode.value,
        query_text=result.query,
        sql_text=result.sql,
        result_type=result.result_type,
        result_payload=_result_to_payload(result),
    )
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return _model_to_result(model)


async def list_custom_kpis(db: AsyncSession) -> list[CustomKPISummary]:
    rows = (
        await db.execute(
            select(CustomKPI).order_by(CustomKPI.updated_at.desc(), CustomKPI.id.desc())
        )
    ).scalars().all()

    summaries: list[CustomKPISummary] = []
    for row in rows:
        payload = row.result_payload or {}
        summaries.append(
            CustomKPISummary(
                id=row.id,
                name=row.name,
                description=row.description,
                input_mode=CustomKPIInputMode(row.input_mode),
                result_type=row.result_type,
                created_at=row.created_at,
                updated_at=row.updated_at,
                row_count=int(payload.get("row_count", 0) or 0),
                truncated=bool(payload.get("truncated", False)),
            )
        )

    return summaries


async def get_custom_kpi(db: AsyncSession, custom_kpi_id: int | str) -> CustomKPIResult:
    if isinstance(custom_kpi_id, str) and custom_kpi_id.startswith("builtin:"):
        for name, definition in Config.KPI_DEFINITIONS.items():
            if _builtin_kpi_id(name) == custom_kpi_id:
                return _builtin_kpi_result(name, definition)
        raise HTTPException(status_code=404, detail="KPI not found.")

    try:
        numeric_id = int(custom_kpi_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Custom KPI not found.") from exc

    model = await db.get(CustomKPI, numeric_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Custom KPI not found.")
    return _model_to_result(model)
