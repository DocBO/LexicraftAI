from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..database import get_session
from ..models import CharacterProfile, Workspace

router = APIRouter(prefix="/characters", tags=["characters"])

DEF_WORKSPACE = "default"


class CharacterPayload(BaseModel):
    id: Optional[int] = None
    name: str
    sourceText: str = ""
    analysis: Optional[dict] = None
    suggestions: Optional[list] = None


class CharacterResponse(BaseModel):
    id: int
    name: str
    sourceText: str
    analysis: Optional[dict]
    suggestions: Optional[list]
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


@router.get("", response_model=List[CharacterResponse])
async def list_characters(
    workspace_id: str = Query(DEF_WORKSPACE, alias="workspaceId"),
    session: Session = Depends(get_session),
) -> List[CharacterResponse]:
    ensure_workspace(session, workspace_id)
    profiles = session.exec(
        select(CharacterProfile)
        .where(CharacterProfile.workspace_id == workspace_id)
        .order_by(CharacterProfile.updated_at.desc())
    ).all()
    return [profile_to_response(profile) for profile in profiles]


@router.post("", response_model=CharacterResponse)
async def save_character(
    payload: CharacterPayload,
    workspace_id: str = Query(DEF_WORKSPACE, alias="workspaceId"),
    session: Session = Depends(get_session),
) -> CharacterResponse:
    ensure_workspace(session, workspace_id)

    now = datetime.utcnow()
    profile: Optional[CharacterProfile] = None
    if payload.id:
        profile = session.get(CharacterProfile, payload.id)
        if not profile or profile.workspace_id != workspace_id:
            raise HTTPException(status_code=404, detail="Character not found")

    if profile:
        profile.name = payload.name
        profile.source_text = payload.sourceText
        profile.analysis_json = _json_dumps(payload.analysis)
        profile.suggestions_json = _json_dumps(payload.suggestions)
        profile.updated_at = now
    else:
        profile = CharacterProfile(
            workspace_id=workspace_id,
            name=payload.name,
            source_text=payload.sourceText,
            analysis_json=_json_dumps(payload.analysis),
            suggestions_json=_json_dumps(payload.suggestions),
            created_at=now,
            updated_at=now,
        )
        session.add(profile)

    session.commit()
    session.refresh(profile)
    return profile_to_response(profile)


@router.delete("/{character_id}")
async def delete_character(
    character_id: int,
    workspace_id: str = Query(DEF_WORKSPACE, alias="workspaceId"),
    session: Session = Depends(get_session),
) -> dict:
    profile = session.get(CharacterProfile, character_id)
    if not profile or profile.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Character not found")
    session.delete(profile)
    session.commit()
    return {"success": True}


def profile_to_response(profile: CharacterProfile) -> CharacterResponse:
    return CharacterResponse(
        id=profile.id,
        name=profile.name,
        sourceText=profile.source_text,
        analysis=_json_loads(profile.analysis_json),
        suggestions=_json_loads(profile.suggestions_json),
        createdAt=profile.created_at,
        updatedAt=profile.updated_at,
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
