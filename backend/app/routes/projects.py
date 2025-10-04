from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..database import get_session
from ..models import Workspace


def format_workspace_name(workspace_id: str) -> str:
    cleaned = workspace_id.replace('-', ' ').replace('_', ' ')
    return cleaned.title()

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreateRequest(BaseModel):
    id: Optional[str] = Field(default=None, min_length=1)
    name: str = Field(..., min_length=1)


class ProjectResponse(BaseModel):
    id: str
    name: str
    createdAt: datetime


@router.get("/", response_model=List[ProjectResponse])
async def list_projects(session: Session = Depends(get_session)) -> List[ProjectResponse]:
    projects = session.exec(select(Workspace).order_by(Workspace.created_at)).all()
    if not projects:
        default = Workspace(id="default", name="Default Project")
        session.add(default)
        session.commit()
        session.refresh(default)
        projects = [default]
    return [workspace_to_response(project) for project in projects]


@router.post("/", response_model=ProjectResponse)
async def create_project(payload: ProjectCreateRequest, session: Session = Depends(get_session)) -> ProjectResponse:
    project_id = payload.id or generate_project_id(payload.name)
    existing = session.get(Workspace, project_id)
    if existing:
        raise HTTPException(status_code=409, detail="Project id already exists")

    workspace = Workspace(id=project_id, name=payload.name)
    session.add(workspace)
    session.commit()
    session.refresh(workspace)
    return workspace_to_response(workspace)


def workspace_to_response(workspace: Workspace) -> ProjectResponse:
    display_name = workspace.name or format_workspace_name(workspace.id)
    return ProjectResponse(id=workspace.id, name=display_name, createdAt=workspace.created_at)


def generate_project_id(name: str) -> str:
    normalized = "-".join(name.strip().lower().split())
    normalized = "".join(char for char in normalized if char.isalnum() or char == "-")
    return normalized or f"project-{int(datetime.utcnow().timestamp())}"
