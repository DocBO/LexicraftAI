from __future__ import annotations

from datetime import datetime
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, delete, select

from ..database import get_session
from ..models import ManuscriptChapter, Shot, ShotListScript, Workspace
from ..vector_store import vector_store


def format_workspace_name(workspace_id: str) -> str:
    cleaned = workspace_id.replace('-', ' ').replace('_', ' ')
    return cleaned.title()

router = APIRouter(prefix="/storage", tags=["storage"])

DEFAULT_WORKSPACE = "default"


class ManuscriptChapterPayload(BaseModel):
    id: Optional[int] = None
    title: str
    content: str
    wordCount: Optional[int] = 0
    status: Optional[str] = "draft"
    createdAt: Optional[str] = None


class ManuscriptSaveRequest(BaseModel):
    workspaceId: Optional[str] = Field(default=DEFAULT_WORKSPACE)
    chapters: List[ManuscriptChapterPayload] = Field(default_factory=list)


class ShotSelectionPayload(BaseModel):
    start: Optional[int] = None
    end: Optional[int] = None


class ShotPayload(BaseModel):
    id: Optional[str] = None
    scene: str
    shotNumber: str
    description: str
    type: str
    angle: str
    movement: str
    equipment: str
    lens: str
    framing: str
    duration: str
    frameRate: str
    notes: Optional[str] = None
    scriptSegment: Optional[str] = None
    scriptSelection: Optional[ShotSelectionPayload] = None


class ShotListSaveRequest(BaseModel):
    workspaceId: Optional[str] = Field(default=DEFAULT_WORKSPACE)
    script: str = ""
    shots: List[ShotPayload] = Field(default_factory=list)


def ensure_workspace(session: Session, workspace_id: str) -> Workspace:
    workspace = session.get(Workspace, workspace_id)
    if workspace:
        return workspace
    workspace = Workspace(id=workspace_id, name=format_workspace_name(workspace_id))
    session.add(workspace)
    session.commit()
    return workspace


@router.get("/manuscript")
async def load_manuscript(
    workspace_id: str = Query(DEFAULT_WORKSPACE, alias="workspaceId"),
    session: Session = Depends(get_session),
) -> dict:
    ensure_workspace(session, workspace_id)
    chapters = session.exec(
        select(ManuscriptChapter)
        .where(ManuscriptChapter.workspace_id == workspace_id)
        .order_by(ManuscriptChapter.created_at)
    ).all()
    return {
        "workspaceId": workspace_id,
        "chapters": [chapter_to_dict(chapter) for chapter in chapters],
    }


@router.put("/manuscript")
async def save_manuscript(payload: ManuscriptSaveRequest, session: Session = Depends(get_session)) -> dict:
    workspace_id = payload.workspaceId or DEFAULT_WORKSPACE
    ensure_workspace(session, workspace_id)

    session.exec(delete(ManuscriptChapter).where(ManuscriptChapter.workspace_id == workspace_id))
    session.commit()

    saved: List[ManuscriptChapter] = []
    now = datetime.utcnow()
    for item in payload.chapters:
        plain = strip_html(item.content)
        chapter = ManuscriptChapter(
            workspace_id=workspace_id,
            title=item.title,
            content_html=item.content,
            content_plain=plain,
            word_count=item.wordCount or len(plain.split()),
            status=item.status or "draft",
            created_at=parse_client_datetime(item.createdAt) or now,
            updated_at=now,
        )
        session.add(chapter)
        saved.append(chapter)

    session.commit()
    for chapter in saved:
        session.refresh(chapter)

    try:
        await vector_store.replace_workspace_chapters(
            workspace_id,
            [{"id": chapter.id, "title": chapter.title, "content_plain": chapter.content_plain} for chapter in saved],
        )
    except Exception:
        pass

    chapters = session.exec(
        select(ManuscriptChapter)
        .where(ManuscriptChapter.workspace_id == workspace_id)
        .order_by(ManuscriptChapter.created_at)
    ).all()
    return {
        "workspaceId": workspace_id,
        "chapters": [chapter_to_dict(chapter) for chapter in chapters],
    }


@router.get("/shot-list")
async def load_shot_list(
    workspace_id: str = Query(DEFAULT_WORKSPACE, alias="workspaceId"),
    session: Session = Depends(get_session),
) -> dict:
    ensure_workspace(session, workspace_id)
    script = session.exec(
        select(ShotListScript).where(ShotListScript.workspace_id == workspace_id)
    ).first()
    shots = session.exec(
        select(Shot).where(Shot.workspace_id == workspace_id).order_by(Shot.created_at)
    ).all()
    return {
        "workspaceId": workspace_id,
        "script": script.content if script else "",
        "shots": [shot_to_dict(shot) for shot in shots],
    }


@router.put("/shot-list")
async def save_shot_list(payload: ShotListSaveRequest, session: Session = Depends(get_session)) -> dict:
    workspace_id = payload.workspaceId or DEFAULT_WORKSPACE
    ensure_workspace(session, workspace_id)

    session.exec(delete(Shot).where(Shot.workspace_id == workspace_id))
    session.commit()

    now = datetime.utcnow()
    for item in payload.shots:
        shot = Shot(
            workspace_id=workspace_id,
            client_id=item.id or generate_client_id(),
            scene=item.scene,
            shot_number=item.shotNumber,
            description=item.description,
            type=item.type,
            angle=item.angle,
            movement=item.movement,
            equipment=item.equipment,
            lens=item.lens,
            framing=item.framing,
            notes=item.notes or "",
            duration=item.duration,
            frame_rate=item.frameRate,
            script_segment=item.scriptSegment,
            selection_start=(item.scriptSelection.start if item.scriptSelection else None),
            selection_end=(item.scriptSelection.end if item.scriptSelection else None),
            created_at=now,
            updated_at=now,
        )
        session.add(shot)

    script = session.exec(
        select(ShotListScript).where(ShotListScript.workspace_id == workspace_id)
    ).first()
    if script:
        script.content = payload.script
        script.updated_at = now
    else:
        session.add(ShotListScript(workspace_id=workspace_id, content=payload.script, updated_at=now))

    session.commit()

    shots = session.exec(
        select(Shot).where(Shot.workspace_id == workspace_id).order_by(Shot.created_at)
    ).all()
    script = session.exec(
        select(ShotListScript).where(ShotListScript.workspace_id == workspace_id)
    ).first()
    return {
        "workspaceId": workspace_id,
        "script": script.content if script else "",
        "shots": [shot_to_dict(shot) for shot in shots],
    }


def chapter_to_dict(chapter: ManuscriptChapter) -> dict:
    return {
        "id": chapter.id,
        "title": chapter.title,
        "content": chapter.content_html,
        "wordCount": chapter.word_count,
        "status": chapter.status,
        "createdAt": chapter.created_at.isoformat(),
    }


def shot_to_dict(shot: Shot) -> dict:
    selection = None
    if shot.selection_start is not None and shot.selection_end is not None:
        selection = {"start": shot.selection_start, "end": shot.selection_end}
    return {
        "id": shot.client_id,
        "scene": shot.scene,
        "shotNumber": shot.shot_number,
        "description": shot.description,
        "type": shot.type,
        "angle": shot.angle,
        "movement": shot.movement,
        "equipment": shot.equipment,
        "lens": shot.lens,
        "framing": shot.framing,
        "notes": shot.notes,
        "duration": shot.duration,
        "frameRate": shot.frame_rate,
        "scriptSegment": shot.script_segment,
        "scriptSelection": selection,
    }


def parse_client_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


TAG_PATTERN = re.compile(r"<[^>]+>")


def strip_html(content: str) -> str:
    if "<" not in content:
        return content
    without_tags = TAG_PATTERN.sub(" ", content)
    return " ".join(without_tags.split())


def generate_client_id() -> str:
    return f"shot-{datetime.utcnow().timestamp()}"
