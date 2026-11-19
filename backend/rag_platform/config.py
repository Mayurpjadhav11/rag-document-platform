"""Central configuration, read from environment variables (see .env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv() -> None:
    """Tiny .env loader so beginners don't need python-dotenv."""
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Settings:
    host: str = field(default_factory=lambda: os.environ.get("HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: _int("PORT", 5000))
    data_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data")
        )
    )
    max_upload_mb: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 50))

    # Chunking / retrieval
    chunk_size: int = field(default_factory=lambda: _int("CHUNK_SIZE", 900))
    chunk_overlap: int = field(default_factory=lambda: _int("CHUNK_OVERLAP", 150))
    top_k: int = field(default_factory=lambda: _int("TOP_K", 5))

    # Local LLM via Ollama
    ollama_base_url: str = field(
        default_factory=lambda: os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    )
    ollama_model: str = field(default_factory=lambda: os.environ.get("OLLAMA_MODEL", "llama3"))
    # Optional: set e.g. "nomic-embed-text" to enable hybrid (BM25 + embedding) retrieval.
    embed_model: str = field(default_factory=lambda: os.environ.get("OLLAMA_EMBED_MODEL", ""))
    ollama_timeout: int = field(default_factory=lambda: _int("OLLAMA_TIMEOUT", 120))

    cors_origins: str = field(default_factory=lambda: os.environ.get("CORS_ORIGINS", "*"))

    def ensure_dirs(self) -> None:
        (self.data_dir / "docs").mkdir(parents=True, exist_ok=True)
