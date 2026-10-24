"""Health-check endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import ApiResponse

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=ApiResponse)
async def health_check(db: AsyncSession = Depends(get_db)):
    """Verify the API and database are reachable."""
    try:
        await db.execute(text("SELECT 1"))
        return ApiResponse(data={"status": "healthy", "database": "connected"})
    except Exception as e:
        return ApiResponse(success=False, message=str(e))
