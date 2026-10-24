"""Async SQLAlchemy engine, session factory, and dependency."""

from typing import AsyncGenerator

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.models.base import Base
import app.models  # noqa: F401

_engine = None
_session_factory = None


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _engine, _session_factory

    if _session_factory is not None:
        return _session_factory

    settings = get_settings()
    if not settings.DATABASE_URL:
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL is not configured.",
        )

    engine_kwargs = {
        "echo": settings.DEBUG,
        "pool_pre_ping": True,
    }
    if settings.DATABASE_URL.startswith("sqlite"):
        engine_kwargs["poolclass"] = NullPool
    else:
        engine_kwargs["pool_size"] = 20
        engine_kwargs["max_overflow"] = 10
        engine_kwargs["pool_recycle"] = 3600

    _engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)
    _session_factory = async_sessionmaker(
        bind=_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    return _session_factory


async def init_db() -> None:
    """Create ORM-managed tables that do not yet exist."""
    global _engine
    get_session_factory()
    engine = _engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async DB session."""
    session_factory = get_session_factory()
    async with session_factory() as session:
        try:
            yield session
        finally:
            await session.close()
