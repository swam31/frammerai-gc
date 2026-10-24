from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Dict, Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.custom_kpi import CustomKPI
from app.nlp.pipeline import execute_pipeline

router = APIRouter(prefix="/nlp-pipeline", tags=["NLP Pipeline"])

class NLQueryRequest(BaseModel):
    query: str

@router.post("/query")
async def process_nlp_query(
    request: NLQueryRequest,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    try:
        rows = (
            await db.execute(
                select(CustomKPI.name, CustomKPI.description).order_by(
                    CustomKPI.updated_at.desc(),
                    CustomKPI.id.desc(),
                )
            )
        ).all()
        saved_kpis = [(str(row[0]), str(row[1] or "")) for row in rows]
        result = await run_in_threadpool(execute_pipeline, request.query, saved_kpis)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="The NLP pipeline is temporarily unavailable. Please try again shortly.",
        ) from exc
