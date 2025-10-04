from __future__ import annotations

import os
from typing import Optional

import httpx


class OpenRouterClient:
    """Thin wrapper around the OpenRouter chat completions API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        model: Optional[str] = None,
        site_url: Optional[str] = None,
        app_name: Optional[str] = None,
        timeout: float = 30.0,
        embedding_model: Optional[str] = None,
    ) -> None:
        self._api_key = api_key or os.getenv("OPENROUTER_API_KEY")
        env_model = (
            os.getenv("OPENROUTER_MODEL")
            or os.getenv("OPENROUTER_MODEL_NAME")
            or os.getenv("OPENROUTER_DEFAULT_MODEL")
        )
        self._model = model or env_model or "google/gemini-1.5-flash"
        self._site_url = site_url or os.getenv("OPENROUTER_SITE_URL", "http://localhost")
        self._app_name = app_name or os.getenv("OPENROUTER_APP_NAME", "Lexicraft AI")
        self._timeout = timeout
        self._embedding_model = (
            embedding_model
            or os.getenv("OPENROUTER_EMBEDDING_MODEL")
            or os.getenv("OPENROUTER_EMBED_MODEL")
            or os.getenv("OPENROUTER_EMBEDDING_MODEL_NAME")
            or "text-embedding-3-small"
        )

        if not self._api_key:
            raise RuntimeError("OPENROUTER_API_KEY is required to use the OpenRouter client")

        self._base_url = "https://openrouter.ai/api/v1/chat/completions"
        self._embedding_url = "https://openrouter.ai/api/v1/embeddings"

    async def generate(
        self,
        prompt: str,
        *,
        temperature: float = 0.7,
        max_output_tokens: Optional[int] = None,
        system_prompt: Optional[str] = None,
    ) -> str:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "HTTP-Referer": self._site_url,
            "X-Title": self._app_name,
        }

        payload: dict[str, object] = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt
                    or "You are Lexicraft AI's writing assistant focused on high quality prose.",
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": temperature,
        }

        if max_output_tokens is not None:
            payload["max_tokens"] = max_output_tokens

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(self._base_url, headers=headers, json=payload)

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = None
            try:
                detail = exc.response.json()
            except Exception:  # pragma: no cover - best effort decoding
                detail = exc.response.text if exc.response is not None else ""

            message = "OpenRouter request failed"
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
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError("OpenRouter returned no choices")

        message = choices[0].get("message", {})
        content = message.get("content")
        if not content:
            raise RuntimeError("OpenRouter response missing content")

        if isinstance(content, str):
            return content.strip()

        if isinstance(content, list):
            # Some models return a list of content blocks; join their text parts.
            joined = "".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict)
            ).strip()
            if joined:
                return joined

        raise RuntimeError("Unsupported OpenRouter content shape")

    async def embed(self, inputs: list[str] | str) -> list[list[float]]:
        if isinstance(inputs, str):
            payload_input: list[str] = [inputs]
        else:
            payload_input = [text for text in inputs if text]

        if not payload_input:
            return []

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "HTTP-Referer": self._site_url,
            "X-Title": self._app_name,
        }

        payload: dict[str, object] = {
            "model": self._embedding_model,
            "input": payload_input,
        }

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(self._embedding_url, headers=headers, json=payload)

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = None
            try:
                detail = exc.response.json()
            except Exception:  # pragma: no cover - best effort decoding
                detail = exc.response.text if exc.response is not None else ""

            message = "OpenRouter embedding request failed"
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
            raise RuntimeError("OpenRouter returned invalid embedding payload")

        vectors: list[list[float]] = []
        for item in embeddings:
            vector = item.get("embedding") if isinstance(item, dict) else None
            if not isinstance(vector, list):
                raise RuntimeError("OpenRouter embedding missing vector content")
            vectors.append(vector)

        return vectors
