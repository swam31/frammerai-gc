"""Persistence model for user-defined custom KPIs."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.types import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CustomKPI(Base):
    __tablename__ = "custom_kpis"
    __table_args__ = (
        UniqueConstraint("name", name="uq_custom_kpis_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    sql_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_type: Mapped[str] = mapped_column(String(32), nullable=False, default="table")
    result_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
