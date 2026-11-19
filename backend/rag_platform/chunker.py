"""Split pages into overlapping, sentence-aware chunks that remember their page."""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict

from .extract import Page

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n{2,}")


@dataclass
class Chunk:
    id: int
    page: int
    text: str

    def to_dict(self) -> dict:
        return asdict(self)


def _split_long(sentence: str, size: int) -> list[str]:
    """Hard-split a sentence longer than `size` on whitespace."""
    words, out, cur = sentence.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > size:
            out.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        out.append(cur)
    return out


def chunk_pages(pages: list[Page], size: int = 900, overlap: int = 150) -> list[Chunk]:
    if size <= 0:
        raise ValueError("chunk size must be positive")
    overlap = max(0, min(overlap, size // 2))
    chunks: list[Chunk] = []

    for page in pages:
        sentences: list[str] = []
        for s in _SENT_SPLIT.split(page.text):
            s = s.strip()
            if not s:
                continue
            sentences.extend(_split_long(s, size) if len(s) > size else [s])

        current: list[str] = []
        length = 0
        for sent in sentences:
            if current and length + len(sent) + 1 > size:
                chunks.append(Chunk(len(chunks), page.number, " ".join(current)))
                # carry over trailing sentences as overlap
                tail: list[str] = []
                tail_len = 0
                for prev in reversed(current):
                    if tail_len + len(prev) > overlap:
                        break
                    tail.insert(0, prev)
                    tail_len += len(prev) + 1
                current, length = tail, tail_len
            current.append(sent)
            length += len(sent) + 1
        if current:
            text = " ".join(current)
            # avoid emitting a chunk that is only the overlap of the previous one
            if not chunks or chunks[-1].page != page.number or text not in chunks[-1].text:
                chunks.append(Chunk(len(chunks), page.number, text))
    return chunks
