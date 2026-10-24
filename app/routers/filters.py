"""Filter / dimension listing endpoints for populating UI dropdowns."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import get_db
from app.schemas.common import ApiResponse
from app.models.dimensions import (
    DimChannelClient, DimDate, DimInputType, DimLanguage,
    DimOutputType, DimPlatform, DimUserTeam,
)

router = APIRouter(prefix="/filters", tags=["Filters & Metadata"])


@router.get("/companies", response_model=ApiResponse)
async def list_companies(db: AsyncSession = Depends(get_db)):
    """Distinct companies/clients."""
    q = select(DimChannelClient.Client_ID, DimChannelClient.Client_Name).distinct()
    rows = (await db.execute(q)).all()
    return ApiResponse(data=[{"id": r.Client_ID, "name": r.Client_Name} for r in rows])


@router.get("/channels", response_model=ApiResponse)
async def list_channels(
    client_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Channels, optionally filtered by client."""
    q = select(DimChannelClient.Channel_ID, DimChannelClient.Channel_Name,
               DimChannelClient.Client_ID, DimChannelClient.Client_Name)
    if client_id:
        q = q.where(DimChannelClient.Client_ID == client_id)
    rows = (await db.execute(q)).all()
    return ApiResponse(data=[
        {"id": r.Channel_ID, "name": r.Channel_Name,
         "client_id": r.Client_ID, "client_name": r.Client_Name}
        for r in rows
    ])


@router.get("/users", response_model=ApiResponse)
async def list_users(
    team_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Users, optionally filtered by team."""
    q = select(DimUserTeam.User_ID, DimUserTeam.User_Name,
               DimUserTeam.Team_ID, DimUserTeam.Team_Name)
    if team_id:
        q = q.where(DimUserTeam.Team_ID == team_id)
    rows = (await db.execute(q)).all()
    return ApiResponse(data=[
        {"id": r.User_ID, "name": r.User_Name,
         "team_id": r.Team_ID, "team_name": r.Team_Name}
        for r in rows
    ])


@router.get("/teams", response_model=ApiResponse)
async def list_teams(db: AsyncSession = Depends(get_db)):
    q = select(DimUserTeam.Team_ID, DimUserTeam.Team_Name).distinct()
    rows = (await db.execute(q)).all()
    return ApiResponse(data=[{"id": r.Team_ID, "name": r.Team_Name} for r in rows])


@router.get("/languages", response_model=ApiResponse)
async def list_languages(db: AsyncSession = Depends(get_db)):
    q = select(DimLanguage.Language_ID, DimLanguage.Language_Name)
    rows = (await db.execute(q)).all()
    return ApiResponse(data=[{"id": r.Language_ID, "name": r.Language_Name} for r in rows])


@router.get("/input-types", response_model=ApiResponse)
async def list_input_types(db: AsyncSession = Depends(get_db)):
    q = select(DimInputType.Input_Type_ID, DimInputType.Input_Type)
    rows = (await db.execute(q)).all()
    return ApiResponse(data=[{"id": r.Input_Type_ID, "name": r.Input_Type} for r in rows])


@router.get("/output-types", response_model=ApiResponse)
async def list_output_types(db: AsyncSession = Depends(get_db)):
    q = select(DimOutputType.Output_Type_ID, DimOutputType.Output_Type)
    rows = (await db.execute(q)).all()
    return ApiResponse(data=[{"id": r.Output_Type_ID, "name": r.Output_Type} for r in rows])


@router.get("/platforms", response_model=ApiResponse)
async def list_platforms(db: AsyncSession = Depends(get_db)):
    q = select(DimPlatform.Platform_ID, DimPlatform.Platform_Name)
    rows = (await db.execute(q)).all()
    return ApiResponse(data=[{"id": r.Platform_ID, "name": r.Platform_Name} for r in rows])


@router.get("/date-range", response_model=ApiResponse)
async def date_range(db: AsyncSession = Depends(get_db)):
    """Min & max dates in dataset."""
    q = select(func.min(DimDate.Full_Date).label("min_date"),
               func.max(DimDate.Full_Date).label("max_date"))
    row = (await db.execute(q)).one()
    return ApiResponse(data={"min_date": str(row.min_date), "max_date": str(row.max_date)})
