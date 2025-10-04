from __future__ import annotations

import os
from typing import Iterable, List

import httpx


class TogetherEmbeddingClient:
    """Minimal client for Together.ai embedding endpoint."""

    def __init__(self, api_key: str | None = None, *, model: str | None = None, timeout: float = 30.0) -> None:
        self._api_key = api_key or os.getenv("TOGETHER_API_KEY")
        if not self._api_key:
            raise RuntimeError("TOGETHER_API_KEY is required for embedding generation")

        self._model = model or os.getenv("TOGETHER_EMBED_MODEL") or os.getenv("TOGETHER_EMBEDDING_MODEL")
        if not self._model:
            self._model = "intfloat/multilingual-e5-large-instruct"

        self._timeout = timeout
        self._url = "https://api.together.xyz/v1/embeddings"

    async def embed(self, texts: Iterable[str]) -> List[List[float]]:
        payload_texts = [text for text in texts if text and text.strip()]
        if not payload_texts:
            return []

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": self._model,
            "input": payload_texts,
        }

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(self._url, headers=headers, json=payload)

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:  # pragma: no cover - network failure
            detail = None
            try:
                detail = exc.response.json()
            except Exception:
                detail = exc.response.text if exc.response is not None else ""

            message = "Together embedding request failed"
            if isinstance(detail, dict):
                err = detail.get("error") or detail.get("message")
                if isinstance(err, dict):
                    err = err.get("message") or err.get("code")
                if err:
                    message = f"{message}: {err}"
            elif detail:
                message = f"{message}: {detail}"
            raise RuntimeError(message) from exc

        data = response.json()
        embeddings = data.get("data")
        if not isinstance(embeddings, list):
            raise RuntimeError("Together returned invalid embedding payload")

        vectors: List[List[float]] = []
        for item in embeddings:
            embedding = item.get("embedding") if isinstance(item, dict) else None
            if not isinstance(embedding, list):
                raise RuntimeError("Together embedding missing vector content")
            vectors.append(embedding)

        return vectors
