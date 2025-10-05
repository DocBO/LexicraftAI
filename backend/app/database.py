import os
from typing import Iterator

from sqlmodel import Session, SQLModel, create_engine


def _ensure_workspace_name_column(engine) -> None:
    with engine.connect() as conn:
        result = conn.exec_driver_sql("PRAGMA table_info(workspace)")
        columns = [row[1] for row in result]
        if "name" not in columns:
            conn.exec_driver_sql("ALTER TABLE workspace ADD COLUMN name TEXT DEFAULT ''")
            conn.commit()


def _ensure_manuscript_metadata_column(engine) -> None:
    with engine.connect() as conn:
        result = conn.exec_driver_sql("PRAGMA table_info(manuscriptchapter)")
        columns = [row[1] for row in result]
        if "metadata_json" not in columns:
            conn.exec_driver_sql("ALTER TABLE manuscriptchapter ADD COLUMN metadata_json TEXT DEFAULT ''")
            conn.commit()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./lexicraft.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    echo=False,
)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    if DATABASE_URL.startswith("sqlite"):
        _ensure_workspace_name_column(engine)
        _ensure_manuscript_metadata_column(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
