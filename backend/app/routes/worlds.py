from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..database import get_session
from ..models import WorldFact, Workspace

router = APIRouter(prefix="/worlds", tags=["worlds"])

DEFAULT_WORKSPACE = "default"


class WorldFactPayload(BaseModel):
    id: Optional[int] = None
    title: str = Field(..., min_length=1)
    summary: str = ""
    details: Optional[dict] = None
    tags: Optional[List[str]] = None


class WorldFactResponse(BaseModel):
    id: int
    title: str
    summary: str
    details: Optional[dict]
    tags: List[str]
    createdAt: datetime
    updatedAt: datetime


def ensure_workspace(session: Session, workspace_id: str) -> Workspace:
    workspace = session.get(Workspace, workspace_id)
    if workspace:
        return workspace
    workspace = Workspace(id=workspace_id, name=workspace_id.title())
    session.add(workspace)
    session.commit()
    session.refresh(workspace)
    return workspace


@router.get("", response_model=List[WorldFactResponse])
async def list_world_facts(
    workspace_id: str = Query(DEFAULT_WORKSPACE, alias="workspaceId"),
    session: Session = Depends(get_session),
) -> List[WorldFactResponse]:
    ensure_workspace(session, workspace_id)
    records = session.exec(
        select(WorldFact)
        .where(WorldFact.workspace_id == workspace_id)
        .order_by(WorldFact.updated_at.desc())
    ).all()
    return [fact_to_response(fact) for fact in records]


@router.post("", response_model=WorldFactResponse)
async def upsert_world_fact(
    payload: WorldFactPayload,
    workspace_id: str = Query(DEFAULT_WORKSPACE, alias="workspaceId"),
    session: Session = Depends(get_session),
) -> WorldFactResponse:
    ensure_workspace(session, workspace_id)
    now = datetime.utcnow()

    fact: Optional[WorldFact] = None
    if payload.id:
        fact = session.get(WorldFact, payload.id)
        if not fact or fact.workspace_id != workspace_id:
            raise HTTPException(status_code=404, detail="World fact not found")

    serialized_details = _json_dumps(payload.details)
    serialized_tags = _json_dumps(payload.tags)

    if fact:
        fact.title = payload.title
        fact.summary = payload.summary
        fact.details_json = serialized_details
        fact.tags = serialized_tags
        fact.updated_at = now
    else:
        fact = WorldFact(
            workspace_id=workspace_id,
            title=payload.title,
            summary=payload.summary,
            details_json=serialized_details,
            tags=serialized_tags,
            created_at=now,
            updated_at=now,
        )
        session.add(fact)

    session.commit()
    session.refresh(fact)
    return fact_to_response(fact)


@router.delete("/{fact_id}")
async def delete_world_fact(
    fact_id: int,
    workspace_id: str = Query(DEFAULT_WORKSPACE, alias="workspaceId"),
    session: Session = Depends(get_session),
) -> dict:
    fact = session.get(WorldFact, fact_id)
    if not fact or fact.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="World fact not found")
    session.delete(fact)
    session.commit()
    return {"success": True}


def fact_to_response(fact: WorldFact) -> WorldFactResponse:
    return WorldFactResponse(
        id=fact.id,
        title=fact.title,
        summary=fact.summary,
        details=_json_loads(fact.details_json),
        tags=_json_loads(fact.tags) or [],
        createdAt=fact.created_at,
        updatedAt=fact.updated_at,
    )


def _json_dumps(data) -> str:
    import json

    if data is None:
        return ""
    return json.dumps(data, ensure_ascii=False)


def _json_loads(raw: str | None):
    import json

    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None
