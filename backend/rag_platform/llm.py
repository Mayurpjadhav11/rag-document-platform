"""Thin client for a local Ollama server (https://ollama.com)."""
from __future__ import annotations

import json
from typing import Iterator, Optional

import requests


class LLMUnavailable(Exception):
    """Ollama can't be reached or the model isn't available."""


class OllamaClient:
    def __init__(self, base_url: str, model: str, timeout: int = 120, embed_model: str = ""):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.embed_model = embed_model

    # ---------- status ----------
    def status(self) -> dict:
        try:
            r = requests.get(f"{self.base_url}/api/tags", timeout=3.5)
            if r.status_code != 200:
                return self._status(False, [], f"Ollama returned HTTP {r.status_code}")
            models = [m.get("name", "") for m in r.json().get("models", [])]
            effective = self.model
            if models and self.model not in models:
                match = next((m for m in models if m.split(":")[0] == self.model.split(":")[0]), None)
                if match:
                    effective = match
            return self._status(True, models, None, effective)
        except requests.RequestException:
            return self._status(
                False, [], f"Cannot reach Ollama at {self.base_url}. Start it with `ollama serve`."
            )

    def _status(self, connected, models, error, effective=None) -> dict:
        out = {
            "connected": connected,
            "baseUrl": self.base_url,
            "selectedModel": effective or self.model,
            "availableModels": models,
        }
        if error:
            out["error"] = error
        return out

    def is_available(self) -> bool:
        st = self.status()
        if not st["connected"]:
            return False
        # connected but model not pulled -> treat as unavailable so we can fall back gracefully
        return not st["availableModels"] or st["selectedModel"] in st["availableModels"]

    # ---------- chat ----------
    def chat_stream(self, messages: list[dict], model: Optional[str] = None) -> Iterator[str]:
        payload = {
            "model": model or self.model,
            "messages": messages,
            "stream": True,
            "options": {"temperature": 0.2},
        }
        try:
            with requests.post(
                f"{self.base_url}/api/chat", json=payload, stream=True, timeout=self.timeout
            ) as r:
                if r.status_code != 200:
                    raise LLMUnavailable(f"Ollama error {r.status_code}: {r.text[:300]}")
                for line in r.iter_lines():
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if obj.get("error"):
                        raise LLMUnavailable(str(obj["error"]))
                    piece = (obj.get("message") or {}).get("content")
                    if piece:
                        yield piece
                    if obj.get("done"):
                        return
        except requests.RequestException as exc:
            raise LLMUnavailable(f"Cannot connect to Ollama at {self.base_url}: {exc}") from exc

    def chat(self, messages: list[dict], model: Optional[str] = None, json_mode: bool = False) -> str:
        payload = {
            "model": model or self.model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": 0.2},
        }
        if json_mode:
            payload["format"] = "json"
        try:
            r = requests.post(f"{self.base_url}/api/chat", json=payload, timeout=self.timeout)
        except requests.RequestException as exc:
            raise LLMUnavailable(f"Cannot connect to Ollama at {self.base_url}: {exc}") from exc
        if r.status_code != 200:
            raise LLMUnavailable(f"Ollama error {r.status_code}: {r.text[:300]}")
        return (r.json().get("message") or {}).get("content", "")

    # ---------- embeddings ----------
    def embed(self, text: str) -> Optional[list[float]]:
        """Return an embedding vector, or None if embeddings aren't configured/available."""
        if not self.embed_model:
            return None
        try:
            r = requests.post(
                f"{self.base_url}/api/embed",
                json={"model": self.embed_model, "input": text},
                timeout=self.timeout,
            )
            if r.status_code != 200:
                return None
            embs = r.json().get("embeddings") or []
            return embs[0] if embs else None
        except requests.RequestException:
            return None
