"""Endpoints for previewing and persisting custom KPIs."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import ApiResponse
from app.schemas.custom_kpis import CreateCustomKPIRequest, CustomKPIQueryRequest
from app.services.custom_kpi_service import (
    create_custom_kpi,
    execute_custom_kpi_request,
    get_custom_kpi,
    list_custom_kpis,
)

router = APIRouter(prefix="/custom-kpis", tags=["Custom KPIs"])


@router.post("/preview", response_model=ApiResponse)
async def preview_custom_kpi(body: CustomKPIQueryRequest):
    result = await execute_custom_kpi_request(body)
    return ApiResponse(data=result.model_dump())


@router.post("", response_model=ApiResponse)
async def create_custom_kpi_endpoint(
    body: CreateCustomKPIRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await create_custom_kpi(db, body)
    return ApiResponse(data=result.model_dump())


@router.get("", response_model=ApiResponse)
async def list_custom_kpis_endpoint(db: AsyncSession = Depends(get_db)):
    rows = await list_custom_kpis(db)
    return ApiResponse(data=[row.model_dump() for row in rows])


@router.get("/{custom_kpi_id}", response_model=ApiResponse)
async def get_custom_kpi_endpoint(
    custom_kpi_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await get_custom_kpi(db, custom_kpi_id)
    return ApiResponse(data=result.model_dump())
