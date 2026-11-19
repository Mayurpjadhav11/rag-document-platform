"""On-disk document store with an in-memory retriever cache.

Layout:  data/docs/<doc_id>/{meta.json, chunks.json, vectors.json?, original.<ext>}
`doc_id` is the SHA-256 of the file bytes, so re-uploading the same file is a no-op
and the frontend can identify a document from its base64 payload alone.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from .chunker import Chunk, chunk_pages
from .extract import extract_pages
from .retriever import Retriever


def doc_id_for(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:20]


def safe_filename(name: str) -> str:
    name = Path(name or "document").name
    name = re.sub(r"[^\w.\- ]", "_", name).strip(" .") or "document"
    return name[:150]


@dataclass
class DocRecord:
    id: str
    filename: str
    mime_type: str
    size: int
    page_count: int
    chunk_count: int
    char_count: int
    uploaded_at: str
    text: str = ""  # full extracted text (only populated by get())

    def public(self) -> dict:
        return {
            "id": self.id,
            "filename": self.filename,
            "mimeType": self.mime_type,
            "size": self.size,
            "pageCount": self.page_count,
            "chunkCount": self.chunk_count,
            "charCount": self.char_count,
            "uploadedAt": self.uploaded_at,
        }


class DocumentStore:
    def __init__(self, root: Path, chunk_size: int = 900, chunk_overlap: int = 150):
        self.root = Path(root) / "docs"
        self.root.mkdir(parents=True, exist_ok=True)
        self.chunk_size, self.chunk_overlap = chunk_size, chunk_overlap
        self._lock = threading.RLock()
        self._retrievers: dict[str, Retriever] = {}

    # ---------- paths ----------
    def _dir(self, doc_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{8,64}", doc_id or ""):
            raise KeyError(doc_id)
        return self.root / doc_id

    # ---------- write ----------
    def add(
        self,
        data: bytes,
        filename: str,
        mime_type: str = "",
        embed_fn: Optional[Callable[[str], Optional[list[float]]]] = None,
    ) -> DocRecord:
        """Extract, chunk and persist a document. Idempotent for identical bytes.

        Raises extract.ExtractionError if the file has no readable text.
        """
        doc_id = doc_id_for(data)
        with self._lock:
            d = self._dir(doc_id)
            if (d / "meta.json").exists():
                rec = self.get(doc_id, with_text=False)
                # a re-upload under a new name just keeps the original record
                return rec

            extracted = extract_pages(data, filename, mime_type)
            chunks = chunk_pages(extracted.pages, self.chunk_size, self.chunk_overlap)
            full_text = "\n\n".join(p.text for p in extracted.pages)
            filename = safe_filename(filename)
            suffix = Path(filename).suffix.lower() or (".pdf" if data[:5] == b"%PDF-" else ".txt")

            tmp = self.root / f".tmp-{doc_id}"
            if tmp.exists():
                shutil.rmtree(tmp)
            tmp.mkdir(parents=True)
            (tmp / f"original{suffix}").write_bytes(data)
            (tmp / "text.txt").write_text(full_text, encoding="utf-8")
            (tmp / "chunks.json").write_text(
                json.dumps([c.to_dict() for c in chunks]), encoding="utf-8"
            )
            if embed_fn is not None:
                vectors = [embed_fn(c.text) for c in chunks]
                if vectors and all(vectors):
                    (tmp / "vectors.json").write_text(json.dumps(vectors), encoding="utf-8")
            rec = DocRecord(
                id=doc_id,
                filename=filename,
                mime_type=mime_type or ("application/pdf" if suffix == ".pdf" else "text/plain"),
                size=len(data),
                page_count=extracted.total_pages,
                chunk_count=len(chunks),
                char_count=len(full_text),
                uploaded_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            )
            (tmp / "meta.json").write_text(json.dumps(rec.public()), encoding="utf-8")
            tmp.rename(d)
            return self.get(doc_id)

    def delete(self, doc_id: str) -> bool:
        with self._lock:
            try:
                d = self._dir(doc_id)
            except KeyError:
                return False
            self._retrievers.pop(doc_id, None)
            if d.exists():
                shutil.rmtree(d)
                return True
            return False

    # ---------- read ----------
    def get(self, doc_id: str, with_text: bool = True) -> DocRecord:
        d = self._dir(doc_id)
        meta_file = d / "meta.json"
        if not meta_file.exists():
            raise KeyError(doc_id)
        m = json.loads(meta_file.read_text(encoding="utf-8"))
        text = ""
        if with_text and (d / "text.txt").exists():
            text = (d / "text.txt").read_text(encoding="utf-8")
        return DocRecord(
            id=m["id"],
            filename=m["filename"],
            mime_type=m["mimeType"],
            size=m["size"],
            page_count=m["pageCount"],
            chunk_count=m["chunkCount"],
            char_count=m["charCount"],
            uploaded_at=m["uploadedAt"],
            text=text,
        )

    def exists(self, doc_id: str) -> bool:
        try:
            return (self._dir(doc_id) / "meta.json").exists()
        except KeyError:
            return False

    def list(self) -> list[DocRecord]:
        out = []
        for d in self.root.iterdir():
            if d.is_dir() and (d / "meta.json").exists():
                try:
                    out.append(self.get(d.name, with_text=False))
                except (KeyError, ValueError, json.JSONDecodeError):
                    continue
        out.sort(key=lambda r: r.uploaded_at, reverse=True)
        return out

    def chunks(self, doc_id: str) -> list[Chunk]:
        d = self._dir(doc_id)
        raw = json.loads((d / "chunks.json").read_text(encoding="utf-8"))
        return [Chunk(**c) for c in raw]

    def retriever(self, doc_id: str) -> Retriever:
        with self._lock:
            r = self._retrievers.get(doc_id)
            if r is None:
                d = self._dir(doc_id)
                vectors = None
                vf = d / "vectors.json"
                if vf.exists():
                    vectors = json.loads(vf.read_text(encoding="utf-8"))
                r = Retriever(self.chunks(doc_id), vectors)
                self._retrievers[doc_id] = r
            return r
