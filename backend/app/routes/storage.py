from __future__ import annotations

from datetime import datetime
import re
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, delete, select

from ..database import get_session
import json

from ..models import ChapterScene, ManuscriptChapter, Shot, ShotListScript, Workspace, WorldFact
from ..vector_store import vector_store


def format_workspace_name(workspace_id: str) -> str:
    cleaned = workspace_id.replace('-', ' ').replace('_', ' ')
    return cleaned.title()

router = APIRouter(prefix="/storage", tags=["storage"])

DEFAULT_WORKSPACE = "default"


class ManuscriptChapterPayload(BaseModel):
    id: Optional[Union[int, str]] = None
    title: str
    outline: Optional[str] = ""
    content: str
    wordCount: Optional[int] = 0
    status: Optional[str] = "draft"
    createdAt: Optional[str] = None
    metadata: Optional[dict] = None


class ManuscriptSaveRequest(BaseModel):
    workspaceId: Optional[str] = Field(default=DEFAULT_WORKSPACE)
    chapters: List[ManuscriptChapterPayload] = Field(default_factory=list)


class ScenePayload(BaseModel):
    chapterId: int
    title: str
    sceneType: Optional[str] = 'dialogue'
    text: Optional[str] = ''
    notes: Optional[str] = ''
    ordering: Optional[int] = None
    metadata: Optional[dict] = None


class SceneSaveRequest(BaseModel):
    workspaceId: Optional[str] = Field(default=DEFAULT_WORKSPACE)
    scenes: List[ScenePayload] = Field(default_factory=list)


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

    chapter_ids = [chapter.id for chapter in chapters]
    scene_map: dict[int, list[dict]] = {}
    if chapter_ids:
        scenes = session.exec(
            select(ChapterScene)
            .where(ChapterScene.workspace_id == workspace_id)
            .where(ChapterScene.chapter_id.in_(chapter_ids))
            .order_by(ChapterScene.chapter_id, ChapterScene.ordering, ChapterScene.id)
        ).all()
        chapter_lookup = {chapter.id: chapter for chapter in chapters}
        for scene in scenes:
            chapter = chapter_lookup.get(scene.chapter_id)
            scene_map.setdefault(scene.chapter_id, []).append(scene_to_dict(scene, chapter))

    return {
        "workspaceId": workspace_id,
        "chapters": [chapter_to_dict(chapter, scene_map.get(chapter.id, [])) for chapter in chapters],
    }


@router.get("/scenes")
async def load_scenes(
    workspace_id: str = Query(DEFAULT_WORKSPACE, alias="workspaceId"),
    session: Session = Depends(get_session),
) -> dict:
    ensure_workspace(session, workspace_id)
    scenes = session.exec(
        select(ChapterScene)
        .where(ChapterScene.workspace_id == workspace_id)
        .order_by(ChapterScene.chapter_id, ChapterScene.ordering, ChapterScene.id)
    ).all()

    chapter_map = {}
    chapter_ids = {scene.chapter_id for scene in scenes}
    if chapter_ids:
        chapters = session.exec(
            select(ManuscriptChapter).where(ManuscriptChapter.id.in_(chapter_ids))
        ).all()
        chapter_map = {chapter.id: chapter for chapter in chapters}

    return {
        "workspaceId": workspace_id,
        "scenes": [scene_to_dict(scene, chapter_map.get(scene.chapter_id)) for scene in scenes],
    }


@router.put("/scenes")
async def save_scenes(payload: SceneSaveRequest, session: Session = Depends(get_session)) -> dict:
    workspace_id = payload.workspaceId or DEFAULT_WORKSPACE
    ensure_workspace(session, workspace_id)

    session.exec(delete(ChapterScene).where(ChapterScene.workspace_id == workspace_id))
    session.commit()

    now = datetime.utcnow()
    inserted = 0
    for index, scene in enumerate(payload.scenes):
        try:
            chapter_id = int(scene.chapterId)
        except (TypeError, ValueError):
            continue
        metadata_json = json.dumps(scene.metadata) if scene.metadata else ""
        ordering = scene.ordering if scene.ordering is not None else index
        chapter_scene = ChapterScene(
            chapter_id=chapter_id,
            workspace_id=workspace_id,
            title=scene.title,
            scene_type=scene.sceneType or 'dialogue',
            text=scene.text or '',
            notes=scene.notes or '',
            ordering=ordering,
            metadata_json=metadata_json,
            created_at=now,
            updated_at=now,
        )
        session.add(chapter_scene)
        inserted += 1

    session.commit()
    return await load_scenes(workspace_id=workspace_id, session=session)


@router.delete("/scenes/{chapter_id}")
async def delete_chapter_scenes(
    chapter_id: int,
    workspace_id: str = Query(DEFAULT_WORKSPACE, alias="workspaceId"),
    session: Session = Depends(get_session),
) -> dict:
    ensure_workspace(session, workspace_id)
    session.exec(
        delete(ChapterScene)
        .where(ChapterScene.workspace_id == workspace_id)
        .where(ChapterScene.chapter_id == chapter_id)
    )
    session.commit()
    return await load_scenes(workspace_id=workspace_id, session=session)


@router.put("/manuscript")
async def save_manuscript(payload: ManuscriptSaveRequest, session: Session = Depends(get_session)) -> dict:
    workspace_id = payload.workspaceId or DEFAULT_WORKSPACE
    ensure_workspace(session, workspace_id)

    existing_chapters = session.exec(
        select(ManuscriptChapter)
        .where(ManuscriptChapter.workspace_id == workspace_id)
    ).all()
    existing_map = {chapter.id: chapter for chapter in existing_chapters}
    retained_ids: set[int] = set()
    now = datetime.utcnow()
    for item in payload.chapters:
        content_html = item.content or ""
        plain = strip_html(content_html)
        if not plain and item.outline:
            plain = item.outline
        metadata_json = serialize_chapter_metadata(item.metadata)
        incoming_id = None
        if item.id is not None:
            try:
                incoming_id = int(item.id)
            except (TypeError, ValueError):
                incoming_id = None

        if incoming_id and incoming_id in existing_map:
            chapter = existing_map[incoming_id]
            chapter.title = item.title
            chapter.outline = item.outline or ""
            chapter.content_html = content_html
            chapter.content_plain = plain
            chapter.word_count = item.wordCount or len(plain.split())
            chapter.status = item.status or chapter.status
            chapter.updated_at = now
            chapter.metadata_json = metadata_json
            retained_ids.add(incoming_id)
        else:
            chapter = ManuscriptChapter(
                workspace_id=workspace_id,
                title=item.title,
                outline=item.outline or "",
                content_html=content_html,
                content_plain=plain,
                word_count=item.wordCount or len(plain.split()),
                status=item.status or "draft",
                created_at=parse_client_datetime(item.createdAt) or now,
                updated_at=now,
                metadata_json=metadata_json,
            )
            session.add(chapter)
            session.flush()
            retained_ids.add(chapter.id)

    if existing_chapters:
        removed_ids = [chapter.id for chapter in existing_chapters if chapter.id not in retained_ids]
        if removed_ids:
            session.exec(
                delete(ChapterScene)
                .where(ChapterScene.workspace_id == workspace_id)
                .where(ChapterScene.chapter_id.in_(removed_ids))
            )
            session.exec(
                delete(ManuscriptChapter)
                .where(ManuscriptChapter.workspace_id == workspace_id)
                .where(ManuscriptChapter.id.in_(removed_ids))
            )

    session.commit()

    chapters = session.exec(
        select(ManuscriptChapter)
        .where(ManuscriptChapter.workspace_id == workspace_id)
        .order_by(ManuscriptChapter.created_at)
    ).all()

    try:
        await vector_store.replace_workspace_chapters(
            workspace_id,
            [{"id": chapter.id, "title": chapter.title, "content_plain": chapter.content_plain} for chapter in chapters],
        )
    except Exception:
        pass

    chapter_ids = [chapter.id for chapter in chapters]
    scene_map: dict[int, list[dict]] = {}
    if chapter_ids:
        scenes = session.exec(
            select(ChapterScene)
            .where(ChapterScene.workspace_id == workspace_id)
            .where(ChapterScene.chapter_id.in_(chapter_ids))
            .order_by(ChapterScene.chapter_id, ChapterScene.ordering, ChapterScene.id)
        ).all()
        chapter_lookup = {chapter.id: chapter for chapter in chapters}
        for scene in scenes:
            chapter = chapter_lookup.get(scene.chapter_id)
            scene_map.setdefault(scene.chapter_id, []).append(scene_to_dict(scene, chapter))

    return {
        "workspaceId": workspace_id,
        "chapters": [chapter_to_dict(chapter, scene_map.get(chapter.id, [])) for chapter in chapters],
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


def normalize_character_list(raw) -> list[dict]:
    normalized: list[dict] = []
    if isinstance(raw, list):
        for entry in raw:
            if isinstance(entry, dict):
                name = str(entry.get("name", "")).strip()
                if not name:
                    continue
                normalized.append({
                    "name": name,
                    "description": str(entry.get("description", "")).strip(),
                })
            elif isinstance(entry, str) and entry.strip():
                normalized.append({"name": entry.strip(), "description": ""})
    elif isinstance(raw, str) and raw.strip():
        normalized.append({"name": raw.strip(), "description": ""})
    return normalized


def normalize_chapter_metadata(raw) -> dict:
    if not raw or not isinstance(raw, dict):
        return {"mainCharacters": [], "supportingCharacters": []}
    return {
        "mainCharacters": normalize_character_list(raw.get("mainCharacters")),
        "supportingCharacters": normalize_character_list(raw.get("supportingCharacters")),
    }


def serialize_chapter_metadata(metadata: dict | None) -> str:
    normalized = normalize_chapter_metadata(metadata or {})
    return json.dumps(normalized, ensure_ascii=False)


def chapter_to_dict(chapter: ManuscriptChapter, scenes) -> dict:
    metadata = {}
    if chapter.metadata_json:
        try:
            metadata = json.loads(chapter.metadata_json)
        except json.JSONDecodeError:
            metadata = {}
    metadata = normalize_chapter_metadata(metadata)
    return {
        "id": chapter.id,
        "title": chapter.title,
        "outline": chapter.outline,
        "content": chapter.content_html,
        "wordCount": chapter.word_count,
        "status": chapter.status,
        "createdAt": chapter.created_at.isoformat(),
        "scenes": scenes,
        "metadata": metadata,
    }


def scene_to_dict(scene: ChapterScene, chapter: ManuscriptChapter | None) -> dict:
    metadata = {}
    if scene.metadata_json:
        try:
            metadata = json.loads(scene.metadata_json)
        except json.JSONDecodeError:
            metadata = {}
    return {
        "id": scene.id,
        "chapterId": scene.chapter_id,
        "title": scene.title,
        "sceneType": scene.scene_type,
        "text": scene.text,
        "notes": scene.notes,
        "ordering": scene.ordering,
        "metadata": metadata,
        "chapterTitle": chapter.title if chapter else None,
        "chapterOutline": chapter.outline if chapter else None,
        "createdAt": scene.created_at.isoformat(),
        "updatedAt": scene.updated_at.isoformat(),
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
