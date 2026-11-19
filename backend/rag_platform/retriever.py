"""Retrieval: BM25 keyword search, optionally fused with embedding similarity."""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Callable, Optional, Sequence

from .chunker import Chunk

STOPWORDS = frozenset(
    """a an and are as at be but by for from has have he her his i if in into is it its of on or
    our she so than that the their them then there these they this to was we were what when where
    which who why will with you your do does did how can could should would about not no yes also
    been being over under up down out any all each more most other some such only own same too very
    just""".split()
)

_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9'\-]*")


def tokenize(text: str) -> list[str]:
    toks = []
    for t in _TOKEN.findall(text.lower()):
        t = t.strip("'-")
        if len(t) < 2 or t in STOPWORDS:
            continue
        # very light stemming so "documents" matches "document"
        if len(t) > 4 and t.endswith("ies"):
            t = t[:-3] + "y"
        elif len(t) > 4 and t.endswith("es") and not t.endswith("ses"):
            t = t[:-2]
        elif len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
            t = t[:-1]
        toks.append(t)
    return toks


@dataclass
class Hit:
    chunk: Chunk
    score: float


class BM25:
    def __init__(self, chunks: Sequence[Chunk], k1: float = 1.5, b: float = 0.75):
        self.chunks = list(chunks)
        self.k1, self.b = k1, b
        self.docs = [Counter(tokenize(c.text)) for c in self.chunks]
        self.lens = [sum(d.values()) for d in self.docs]
        self.avg_len = (sum(self.lens) / len(self.lens)) if self.lens else 0.0
        df: Counter = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def scores(self, query: str) -> list[float]:
        q = tokenize(query)
        out = [0.0] * len(self.chunks)
        if not q or not self.avg_len:
            return out
        for i, doc in enumerate(self.docs):
            s = 0.0
            for t in q:
                f = doc.get(t)
                if not f:
                    continue
                denom = f + self.k1 * (1 - self.b + self.b * self.lens[i] / self.avg_len)
                s += self.idf.get(t, 0.0) * f * (self.k1 + 1) / denom
            out[i] = s
        return out


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


class Retriever:
    """BM25, plus optional dense vectors fused with Reciprocal Rank Fusion."""

    RRF_K = 60

    def __init__(self, chunks: Sequence[Chunk], vectors: Optional[Sequence[Sequence[float]]] = None):
        self.chunks = list(chunks)
        self.bm25 = BM25(self.chunks)
        self.vectors = list(vectors) if vectors else None

    def search(
        self,
        query: str,
        k: int = 5,
        embed_fn: Optional[Callable[[str], Optional[list[float]]]] = None,
    ) -> list[Hit]:
        if not self.chunks:
            return []
        bm = self.bm25.scores(query)
        bm_rank = sorted(range(len(bm)), key=lambda i: bm[i], reverse=True)

        fused: dict[int, float] = {}
        for rank, i in enumerate(bm_rank):
            if bm[i] > 0:
                fused[i] = fused.get(i, 0.0) + 1.0 / (self.RRF_K + rank)

        if self.vectors and embed_fn is not None:
            qv = embed_fn(query)
            if qv:
                sims = [_cosine(qv, v) for v in self.vectors]
                dense_rank = sorted(range(len(sims)), key=lambda i: sims[i], reverse=True)
                for rank, i in enumerate(dense_rank[: max(k * 3, 10)]):
                    fused[i] = fused.get(i, 0.0) + 1.0 / (self.RRF_K + rank)

        ranked = sorted(fused.items(), key=lambda kv: kv[1], reverse=True)[:k]
        return [Hit(self.chunks[i], score) for i, score in ranked]
