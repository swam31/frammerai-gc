"""Schemas for custom KPI preview, persistence, and retrieval."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class CustomKPIInputMode(str, Enum):
    natural_language = "natural_language"
    sql = "sql"


class CustomKPIQueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=20000)
    input_mode: CustomKPIInputMode = CustomKPIInputMode.natural_language

    @field_validator("query")
    @classmethod
    def _normalize_query(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("query cannot be empty")
        return value


class CreateCustomKPIRequest(CustomKPIQueryRequest):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)

    @field_validator("name")
    @classmethod
    def _normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name cannot be empty")
        return value

    @field_validator("description")
    @classmethod
    def _normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class CustomKPIResult(BaseModel):
    id: int | str | None = None
    name: str | None = None
    description: str | None = None
    query: str
    input_mode: CustomKPIInputMode
    sql: str | None = None
    answer_nl: str | None = None
    columns: list[str] = Field(default_factory=list)
    df_records: list[dict[str, Any]] = Field(default_factory=list)
    value: str | int | float | bool | None = None
    result_type: str = "table"
    plan: dict[str, Any] | None = None
    plan_ms: float | None = None
    retrieved_examples: list[dict[str, Any]] = Field(default_factory=list)
    attempts: list[dict[str, Any]] = Field(default_factory=list)
    filters: list[str] = Field(default_factory=list)
    verification: dict[str, Any] | None = None
    sanity: dict[str, Any] | None = None
    error: str | None = None
    row_count: int = 0
    truncated: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CustomKPISummary(BaseModel):
    id: int | str
    name: str
    description: str | None = None
    input_mode: CustomKPIInputMode
    result_type: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    row_count: int = 0
    truncated: bool = False

    model_config = {"from_attributes": True}
