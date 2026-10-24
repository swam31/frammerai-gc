import asyncio
import os
import re
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from sqlalchemy.dialects.postgresql import INTERVAL as PG_INTERVAL
import pandas as pd
from sqlalchemy import MetaData, Table
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.sql.sqltypes import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Integer,
    Interval,
    Numeric,
    SmallInteger,
    Time,
)


# =========================================================
# CONFIG
# =========================================================
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "database_example_url",
)

CSV_DIR = Path(os.getenv("CSV_DIR", "./data"))
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "1000"))
STOP_ON_ERROR = os.getenv("STOP_ON_ERROR", "true").strip().lower() in {"1", "true", "yes", "y"}
SKIP_MISSING_FILES = os.getenv("SKIP_MISSING_FILES", "true").strip().lower() in {"1", "true", "yes", "y"}


# =========================================================
# CSV FILE MAP
# Change filenames here only if your actual filenames differ
# =========================================================
CSV_FILES: Dict[str, str] = {
    "Dim_Channel_Client": "dim_channel_client.csv",
    "Dim_Date": "dim_date.csv",
    "Dim_Input_Type": "dim_input_type.csv",
    "Dim_Input_Video": "dim_input_video.csv",
    "Dim_Language": "dim_language.csv",
    "Dim_Output_Type": "dim_output_type.csv",
    "Dim_Output_Video": "dim_output_video.csv",
    "Dim_Platform": "dim_platform.csv",
    "Dim_User_Team": "dim_user_team.csv",
    "Fact_Input_Video_Operations": "fact_input_video_operations.csv",
    "Fact_Output_Video_Operations": "fact_output_video_operations.csv",
    "Fact_Publish_Information": "fact_publish_information.csv",
    "Fact_Data_Quality": "fact_data_quality.csv",
}

# FK-safe loading order
LOAD_ORDER = [
    "Dim_Channel_Client",
    "Dim_Date",
    "Dim_Input_Type",
    "Dim_Input_Video",
    "Dim_Language",
    "Dim_Output_Type",
    "Dim_Output_Video",
    "Dim_Platform",
    "Dim_User_Team",
    "Fact_Input_Video_Operations",
    "Fact_Output_Video_Operations",
    "Fact_Publish_Information",
    "Fact_Data_Quality",
]

# Helpful aliases for messy / legacy CSV headers.
# Keys are incoming CSV header names, values are actual DB column names.
TABLE_ALIASES: Dict[str, Dict[str, str]] = {
    "Fact_Data_Quality": {
        "Video_ID": "Input_Video_ID",
        "video_id": "Input_Video_ID",
        "Log_Date": "Log_Date_ID",
    },
    "Fact_Output_Video_Operations": {
        "Created_Date_ID": "Create_Date_ID",
        "Creation_Date_ID": "Create_Date_ID",
    },
    "Fact_Publish_Information": {
        "Publish_Date_ID": "Published_Date_ID",
        "Billable": "Is_Billable",
    },
}

GLOBAL_ALIASES: Dict[str, str] = {
    "factinputid": "Fact_Input_ID",
    "factoutputid": "Fact_Output_ID",
    "factpublishid": "Fact_Publish_ID",
    "dqlogid": "DQ_Log_ID",
    "inputvideoid": "Input_Video_ID",
    "outputvideoid": "Output_Video_ID",
    "channelid": "Channel_ID",
    "userid": "User_ID",
    "inputtypeid": "Input_Type_ID",
    "outputtypeid": "Output_Type_ID",
    "languageid": "Language_ID",
    "uploaddateid": "Upload_Date_ID",
    "createdateid": "Create_Date_ID",
    "publisheddateid": "Published_Date_ID",
    "logdateid": "Log_Date_ID",
    "platformid": "Platform_ID",
    "uploadedduration": "Uploaded_Duration",
    "createdduration": "Created_Duration",
    "publishedduration": "Published_Duration",
    "isbillable": "Is_Billable",
    "publishedurl": "Published_URL",
    "errortype": "Error_Type",
}


# =========================================================
# HELPERS
# =========================================================
def is_interval_type(column_type: Any) -> bool:
    return (
        isinstance(column_type, (Interval, PG_INTERVAL))
        or getattr(column_type, "__visit_name__", "").lower() == "interval"
        or column_type.__class__.__name__.upper() == "INTERVAL"
    )


def is_time_type(column_type: Any) -> bool:
    return (
        isinstance(column_type, Time)
        or getattr(column_type, "__visit_name__", "").lower() == "time"
        or column_type.__class__.__name__.upper() == "TIME"
    )

def normalize_name(value: str) -> str:
    """
    Makes header matching robust:
    'Input Video ID', 'input_video_id', 'INPUT-VIDEO-ID'
    all become the same normalized token.
    """
    return re.sub(r"[^a-z0-9]+", "", str(value).strip().lower())


def is_blank(value: Any) -> bool:
    if value is None:
        return True
    if pd.isna(value):
        return True
    return str(value).strip() == ""


def parse_bool(value: Any) -> Optional[bool]:
    if is_blank(value):
        return None

    text = str(value).strip().lower()
    truthy = {"1", "true", "t", "yes", "y"}
    falsy = {"0", "false", "f", "no", "n"}

    if text in truthy:
        return True
    if text in falsy:
        return False

    raise ValueError(f"Cannot parse boolean value: {value!r}")


def parse_interval(value: Any) -> Optional[timedelta]:
    """
    Supports common duration formats like:
    - HH:MM:SS
    - HH:MM:SS.mmm
    - 36:15:20
    - 2 days 03:04:05
    - 90s / 15m / 2h / pandas-readable duration strings
    """
    if is_blank(value):
        return None

    text = str(value).strip()

    try:
        td = pd.to_timedelta(text)
        if pd.isna(td):
            return None
        return td.to_pytimedelta()
    except Exception as exc:
        raise ValueError(f"Cannot parse interval value: {value!r}") from exc


def coerce_value(value: Any, column_type: Any, column_name: str) -> Any:
    if is_blank(value):
        return None

    text = str(value).strip()

    if isinstance(column_type, (Integer, SmallInteger, BigInteger)):
        try:
            num = float(text)
            if not num.is_integer():
                raise ValueError
            return int(num)
        except Exception as exc:
            raise ValueError(f"Column {column_name}: cannot coerce {value!r} to integer") from exc

    if isinstance(column_type, Boolean):
        return parse_bool(text)

    if isinstance(column_type, DateTime):
        try:
            return pd.to_datetime(text, errors="raise").to_pydatetime()
        except Exception as exc:
            raise ValueError(f"Column {column_name}: cannot coerce {value!r} to datetime") from exc

    if isinstance(column_type, Date):
        try:
            return pd.to_datetime(text, errors="raise").date()
        except Exception as exc:
            raise ValueError(f"Column {column_name}: cannot coerce {value!r} to date") from exc

    if is_time_type(column_type):
        try:
            return pd.to_datetime(text, errors="raise").time()
        except Exception as exc:
            raise ValueError(f"Column {column_name}: cannot coerce {value!r} to time") from exc

    if is_interval_type(column_type):
        try:
            return parse_interval(text)
        except Exception as exc:
            raise ValueError(f"Column {column_name}: cannot coerce {value!r} to interval") from exc

    if isinstance(column_type, Numeric):
        try:
            return float(text)
        except Exception as exc:
            raise ValueError(f"Column {column_name}: cannot coerce {value!r} to numeric") from exc

    return text

def get_required_columns(table: Table) -> List[str]:
    """
    Required = NOT NULL and no default/server-default.
    """
    required = []
    for col in table.columns:
        if col.nullable:
            continue
        if col.default is not None or col.server_default is not None:
            continue
        required.append(col.name)
    return required


def build_column_resolver(table_name: str, table: Table) -> Dict[str, str]:
    resolver: Dict[str, str] = {}

    # Actual DB columns always map to themselves
    for col in table.columns:
        resolver[normalize_name(col.name)] = col.name

    # Generic aliases
    for alias, target in GLOBAL_ALIASES.items():
        if target in table.columns:
            resolver[normalize_name(alias)] = target

    # Per-table aliases
    for alias, target in TABLE_ALIASES.get(table_name, {}).items():
        if target in table.columns:
            resolver[normalize_name(alias)] = target

    return resolver


def map_csv_columns(df: pd.DataFrame, table_name: str, table: Table) -> pd.DataFrame:
    """
    Map messy CSV headers to exact DB column names by header name, never by position.
    This is what makes column ordering irrelevant.
    """
    resolver = build_column_resolver(table_name, table)

    rename_map: Dict[str, str] = {}
    unmapped: List[str] = []
    duplicate_targets: Dict[str, List[str]] = {}

    for raw_col in df.columns:
        target = resolver.get(normalize_name(raw_col))
        if not target:
            unmapped.append(raw_col)
            continue

        if target in rename_map.values():
            duplicate_targets.setdefault(target, []).append(raw_col)
            continue

        rename_map[raw_col] = target

    if duplicate_targets:
        formatted = ", ".join(
            f"{target} <= {cols}" for target, cols in duplicate_targets.items()
        )
        raise ValueError(
            f"[{table_name}] Multiple CSV columns map to the same DB column: {formatted}"
        )

    df = df.rename(columns=rename_map)

    # Keep only columns that really exist in the DB table
    keep_cols = [col.name for col in table.columns if col.name in df.columns]
    df = df[keep_cols].copy()

    required_cols = get_required_columns(table)
    missing_required = [c for c in required_cols if c not in df.columns]
    if missing_required:
        raise ValueError(
            f"[{table_name}] Missing required columns after header mapping: {missing_required}"
        )

    if unmapped:
        print(f"[{table_name}] Ignoring extra/unmapped CSV columns: {unmapped}")

    return df


def rows_from_dataframe(df: pd.DataFrame, table: Table, table_name: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []

    for row_idx, row in enumerate(df.to_dict(orient="records"), start=2):
        clean_row: Dict[str, Any] = {}
        for col_name, value in row.items():
            col = table.columns[col_name]
            try:
                clean_row[col_name] = coerce_value(value, col.type, col_name)
            except ValueError as exc:
                raise ValueError(f"[{table_name}] CSV row {row_idx}: {exc}") from exc
        rows.append(clean_row)

    return rows


async def reflect_tables(engine) -> Dict[str, Table]:
    async with engine.connect() as conn:
        def _reflect(sync_conn):
            metadata = MetaData()
            metadata.reflect(bind=sync_conn)
            return metadata.tables

        tables = await conn.run_sync(_reflect)
        return dict(tables)


async def upsert_rows(engine, table: Table, rows: List[Dict[str, Any]]) -> int:
    """
    PostgreSQL UPSERT by primary key.
    Re-running the script updates existing rows instead of crashing.
    """
    if not rows:
        return 0

    pk_cols = [col.name for col in table.primary_key.columns]
    total_affected = 0

    async with engine.begin() as conn:
        for start in range(0, len(rows), CHUNK_SIZE):
            chunk = rows[start : start + CHUNK_SIZE]

            stmt = pg_insert(table).values(chunk)

            if pk_cols:
                update_cols = {
                    col.name: getattr(stmt.excluded, col.name)
                    for col in table.columns
                    if col.name not in pk_cols
                }

                if update_cols:
                    stmt = stmt.on_conflict_do_update(
                        index_elements=pk_cols,
                        set_=update_cols,
                    )
                else:
                    stmt = stmt.on_conflict_do_nothing(index_elements=pk_cols)

            result = await conn.execute(stmt)
            if result.rowcount and result.rowcount > 0:
                total_affected += result.rowcount

    return total_affected


async def load_one_table(engine, tables: Dict[str, Table], table_name: str, csv_path: Path) -> None:
    if table_name not in tables:
        raise RuntimeError(
            f"Table {table_name!r} does not exist in the database. "
            f"Create the schema first, then rerun."
        )

    table = tables[table_name]

    print(f"\n--- Loading {table_name} from {csv_path.name} ---")

    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    if df.empty:
        print(f"[{table_name}] CSV is empty. Skipping.")
        return

    df = map_csv_columns(df, table_name, table)
    rows = rows_from_dataframe(df, table, table_name)
    affected = await upsert_rows(engine, table, rows)

    print(f"[{table_name}] {len(rows)} CSV rows processed, {affected} DB rows affected.")


async def main() -> None:
    if not CSV_DIR.exists():
        raise FileNotFoundError(f"CSV_DIR does not exist: {CSV_DIR.resolve()}")

    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        future=True,
        pool_pre_ping=True,
    )

    try:
        tables = await reflect_tables(engine)

        missing_tables = [t for t in LOAD_ORDER if t not in tables]
        if missing_tables:
            print(
                "These tables are missing in the database and will fail if referenced:\n"
                f"  {missing_tables}"
            )

        for table_name in LOAD_ORDER:
            filename = CSV_FILES.get(table_name)
            if not filename:
                print(f"[{table_name}] No CSV mapping found. Skipping.")
                continue

            csv_path = CSV_DIR / filename
            if not csv_path.exists():
                message = f"[{table_name}] CSV file not found: {csv_path}"
                if SKIP_MISSING_FILES:
                    print(message + " -> skipping")
                    continue
                raise FileNotFoundError(message)

            try:
                await load_one_table(engine, tables, table_name, csv_path)
            except Exception as exc:
                print(f"[{table_name}] FAILED: {exc}")
                if STOP_ON_ERROR:
                    raise

        print("\nDone.")

    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())