"""Frammer AI Analytics API FastAPI application entry-point."""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db
from app.routers import (
    alerts,
    channel_analytics,
    client_analytics,
    comparisons,
    content_mix,
    custom_kpis,
    data_quality,
    filters,
    funnel,
    health,
    intelligence,
    kpi_summary,
    language_analytics,
    multi_dimension,
    nlp_pipeline,
    operational_kpis,
    platform_analytics,
    productivity,
    rankings,
    team_analytics,
    trends,
    user_analytics,
    video_explorer,
)

settings = get_settings()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown hooks."""
    if settings.DATABASE_URL:
        try:
            await init_db()
        except Exception as exc:
            logger.warning("Database init skipped during startup: %s", exc)
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description=(
        "Extensive analytics API for the Frammer AI Product Usage Dashboard.\n\n"
        "## Router Groups\n"
        "- **KPI** - top-level summary, comparison, output-type cards\n"
        "- **Trends** - uploaded/processed/published time-series, growth, cumulative\n"
        "- **Dimensions** - single/double drill-down, pivot, heatmap\n"
        "- **Funnel** - upload to process to publish conversion and bottlenecks\n"
        "- **Channels / Clients / Users / Teams** - entity-level analytics\n"
        "- **Content Mix** - output/input type distribution and trends\n"
        "- **Languages / Platforms** - distribution, trends, cross-tab\n"
        "- **Data Quality** - missing fields, errors, duplicates, quality score\n"
        "- **Videos** - searchable/filterable detail explorer and export\n"
        "- **Comparisons** - period/segment/benchmark side-by-side\n"
        "- **Rankings** - top-N, bottom-N, biggest movers\n"
        "- **Alerts** - anomaly detection, thresholds, drop-offs\n"
        "- **Operational KPIs** - active entities, clip rate, conversion, velocity\n"
        "- **Productivity** - user/team efficiency, pipeline velocity, platform reach\n"
        "- **Custom KPIs** - persisted user-defined metrics from natural language or SQL\n"
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"

app.include_router(health.router)
app.include_router(filters.router, prefix=API_PREFIX)
app.include_router(kpi_summary.router, prefix=API_PREFIX)
app.include_router(trends.router, prefix=API_PREFIX)
app.include_router(multi_dimension.router, prefix=API_PREFIX)
app.include_router(funnel.router, prefix=API_PREFIX)
app.include_router(channel_analytics.router, prefix=API_PREFIX)
app.include_router(client_analytics.router, prefix=API_PREFIX)
app.include_router(user_analytics.router, prefix=API_PREFIX)
app.include_router(team_analytics.router, prefix=API_PREFIX)
app.include_router(content_mix.router, prefix=API_PREFIX)
app.include_router(language_analytics.router, prefix=API_PREFIX)
app.include_router(platform_analytics.router, prefix=API_PREFIX)
app.include_router(data_quality.router, prefix=API_PREFIX)
app.include_router(video_explorer.router, prefix=API_PREFIX)
app.include_router(comparisons.router, prefix=API_PREFIX)
app.include_router(rankings.router, prefix=API_PREFIX)
app.include_router(alerts.router, prefix=API_PREFIX)
app.include_router(operational_kpis.router, prefix=API_PREFIX)
app.include_router(productivity.router, prefix=API_PREFIX)
app.include_router(intelligence.router, prefix=API_PREFIX)
app.include_router(nlp_pipeline.router, prefix=API_PREFIX)
app.include_router(custom_kpis.router, prefix=API_PREFIX)


@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": f"{API_PREFIX}/...",
    }
