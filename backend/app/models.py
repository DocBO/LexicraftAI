from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Workspace(SQLModel, table=True):
    id: str = Field(primary_key=True, index=True)
    name: str = Field(default="", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ManuscriptChapter(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    workspace_id: str = Field(foreign_key="workspace.id", index=True)
    title: str
    outline: str = ""
    content_html: str
    content_plain: str
    word_count: int = 0
    status: str = "draft"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    metadata_json: str = ""


class ChapterScene(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chapter_id: int = Field(foreign_key="manuscriptchapter.id", index=True)
    workspace_id: str = Field(foreign_key="workspace.id", index=True)
    title: str
    scene_type: str = "dialogue"
    text: str = ""
    notes: str = ""
    ordering: int = 0
    metadata_json: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ShotListScript(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    workspace_id: str = Field(foreign_key="workspace.id", unique=True, index=True)
    content: str = ""
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Shot(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    workspace_id: str = Field(foreign_key="workspace.id", index=True)
    client_id: str = Field(index=True)
    scene: str = "1"
    shot_number: str = "1"
    description: str = ""
    type: str = "MS"
    angle: str = "Eye Level"
    movement: str = "Static"
    equipment: str = ""
    lens: str = "50mm"
    framing: str = "Medium"
    notes: str = ""
    duration: str = "5s"
    frame_rate: str = "24 fps"
    script_segment: Optional[str] = None
    selection_start: Optional[int] = None
    selection_end: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CharacterProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    workspace_id: str = Field(foreign_key="workspace.id", index=True)
    name: str = Field(index=True)
    source_text: str = ""
    analysis_json: str = ""
    suggestions_json: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class WorldFact(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    workspace_id: str = Field(foreign_key="workspace.id", index=True)
    title: str = Field(index=True)
    summary: str = ""
    details_json: str = ""
    tags: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
