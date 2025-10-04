from __future__ import annotations

import asyncio
import logging
import os
from typing import Iterable, List

from qdrant_client import QdrantClient
from qdrant_client import models as qmodels

from .together import TogetherEmbeddingClient

logger = logging.getLogger(__name__)


class VectorStore:
    def __init__(self) -> None:
        self._host = os.getenv("QDRANT_URL") or os.getenv("QDRANT_HOST")
        self._api_key = os.getenv("QDRANT_API_KEY")
        self._collection = os.getenv("QDRANT_COLLECTION", "lexicraft_chapters")
        self._vector_size = int(os.getenv("QDRANT_VECTOR_DIM", "1024"))
        self._client: QdrantClient | None = None
        self._enabled = bool(self._host)

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def ensure_ready(self) -> None:
        if not self._enabled or self._client:
            return
        try:
            self._client = QdrantClient(self._host, api_key=self._api_key)
            await asyncio.to_thread(self._client.get_collection, self._collection)
        except Exception:  # pragma: no cover - collection missing
            await self._create_collection()

    async def _create_collection(self) -> None:
        if not self._enabled:
            return
        if self._vector_size <= 0:
            logger.warning("Invalid Qdrant vector size; skipping collection creation")
            return
        try:
            if self._client is None:
                self._client = QdrantClient(self._host, api_key=self._api_key)
            await asyncio.to_thread(
                self._client.recreate_collection,
                collection_name=self._collection,
                vectors_config=qmodels.VectorParams(size=self._vector_size, distance=qmodels.Distance.COSINE),
            )
        except Exception as exc:  # pragma: no cover - qdrant optional
            logger.error("Failed to create Qdrant collection: %s", exc)
            self._client = None
            self._enabled = False

    async def replace_workspace_chapters(self, workspace_id: str, chapters: Iterable[dict]) -> None:
        if not self._enabled:
            return
        await self.ensure_ready()
        if not self._client:
            return

        texts: List[str] = []
        ids: List[str] = []
        payloads: List[dict] = []

        for chapter in chapters:
            text = chapter.get("content_plain") or chapter.get("content") or ""
            if not text.strip():
                continue
            chapter_id = str(chapter.get("id"))
            chunks = chunk_text(text)
            for index, chunk in enumerate(chunks):
                point_id = f"{chapter_id}:{index}"
                ids.append(point_id)
                texts.append(chunk)
                payloads.append(
                    {
                        "workspace_id": workspace_id,
                        "chapter_id": chapter_id,
                        "chunk_index": index,
                        "title": chapter.get("title", ""),
                    }
                )

        if not ids:
            await asyncio.to_thread(
                self._client.delete,
                collection_name=self._collection,
                points_selector=qmodels.FilterSelector(
                    filter=qmodels.Filter(
                        must=[qmodels.FieldCondition(key="workspace_id", match=qmodels.MatchValue(value=workspace_id))]
                    )
                ),
            )
            return

        try:
            embed_client = TogetherEmbeddingClient()
            embeddings = await embed_client.embed(texts)
        except Exception as exc:  # pragma: no cover - embedding optional
            logger.error("Embedding generation failed: %s", exc)
            return

        if len(embeddings) != len(ids):
            logger.warning("Embedding count mismatch; skipping Qdrant sync")
            return

        await asyncio.to_thread(
            self._client.delete,
            collection_name=self._collection,
            points_selector=qmodels.FilterSelector(
                filter=qmodels.Filter(
                    must=[qmodels.FieldCondition(key="workspace_id", match=qmodels.MatchValue(value=workspace_id))]
                )
            ),
        )

        await asyncio.to_thread(
            self._client.upsert,
            collection_name=self._collection,
            points=qmodels.Batch(ids=ids, payloads=payloads, vectors=embeddings),
        )


def chunk_text(text: str, max_tokens: int = 512) -> List[str]:
    words = text.split()
    if not words:
        return []

    chunks: List[str] = []
    current: List[str] = []

    for word in words:
        current.append(word)
        if len(current) >= max_tokens:
            chunks.append(" ".join(current))
            current = []

    if current:
        chunks.append(" ".join(current))

    return chunks


vector_store = VectorStore()
