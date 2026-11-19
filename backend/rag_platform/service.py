"""RAG orchestration: ingest -> retrieve -> prompt -> generate (with graceful fallback)."""
from __future__ import annotations

import base64
import binascii
import re
from typing import Iterator, Optional

from .analysis import heuristic_analysis, llm_analysis, sample_chunks
from .config import Settings
from .extract import ExtractionError
from .llm import LLMUnavailable, OllamaClient
from .retriever import Hit, tokenize
from .store import DocRecord, DocumentStore

BROAD = re.compile(
    r"\b(summar\w*|overview|main points?|key points?|key takeaways?|tl;?dr|what is (this|the document)|"
    r"what('s| is) .* about|outline|gist)\b",
    re.I,
)

SYSTEM_PROMPT = """You are a precise document question-answering assistant.
Answer ONLY from the numbered excerpts of the document "{filename}" below.
Rules:
- Cite the excerpts you used inline like [1] or [2].
- If the excerpts do not contain the answer, say so plainly; do not guess or use outside knowledge.
- Be concise. Use markdown (lists, bold) where it helps.

Excerpts:
{context}"""


class BadRequest(Exception):
    pass


class RagService:
    def __init__(self, settings: Settings, store: DocumentStore, llm: OllamaClient):
        self.settings, self.store, self.llm = settings, store, llm

    # ---------- ingestion ----------
    def _embed_fn(self, llm: OllamaClient):
        return llm.embed if llm.embed_model else None

    def ingest_bytes(self, data: bytes, filename: str, mime_type: str = "") -> DocRecord:
        embed_fn = self._embed_fn(self.llm) if self.llm.embed_model else None
        try:
            return self.store.add(data, filename, mime_type, embed_fn=embed_fn)
        except ExtractionError as exc:
            raise BadRequest(str(exc)) from exc

    def resolve_document(self, doc: Optional[dict]) -> DocRecord:
        """Find (or index on the fly) the document a request refers to."""
        if not doc:
            raise BadRequest("Missing document.")
        doc_id = doc.get("docId") or doc.get("id")
        if doc_id and self.store.exists(str(doc_id)):
            return self.store.get(str(doc_id))
        filename = doc.get("filename") or "document"
        mime = doc.get("mimeType") or ""
        b64 = doc.get("base64Data")
        if b64:
            try:
                data = base64.b64decode(b64, validate=False)
            except (binascii.Error, ValueError) as exc:
                raise BadRequest("base64Data is not valid base64.") from exc
            return self.ingest_bytes(data, filename, mime)
        if doc.get("extractedText"):
            return self.ingest_bytes(doc["extractedText"].encode("utf-8"), filename, "text/plain")
        raise BadRequest("Missing document data (base64Data, extractedText or docId).")

    # ---------- analysis ----------
    def analyze(self, doc: dict, model: Optional[str] = None) -> dict:
        rec = self.resolve_document(doc)
        chunks = self.store.chunks(rec.id)
        result = None
        if self.llm.is_available():
            try:
                result = llm_analysis(self.llm, rec.filename, chunks, model)
            except LLMUnavailable:
                result = None
        if result is None:
            result = heuristic_analysis(rec.filename, chunks, rec.page_count)
        full = self.store.get(rec.id)
        return {
            **result,
            "extractedText": full.text,
            "pageCount": rec.page_count,
            "docId": rec.id,
        }

    # ---------- retrieval ----------
    @staticmethod
    def _search_query(question: str, history: list[dict]) -> str:
        """Short follow-ups ("and in 2023?") borrow context from the previous user turn."""
        if len(question.split()) < 6:
            for h in reversed(history or []):
                if h.get("role") == "user" and h.get("text"):
                    return f"{h['text']} {question}"
        return question

    def retrieve(self, rec: DocRecord, question: str, history: list[dict]) -> list[Hit]:
        k = self.settings.top_k
        chunks = self.store.chunks(rec.id)
        if BROAD.search(question):
            return [Hit(c, 0.0) for c in sample_chunks(chunks, max(k, 6))]
        retr = self.store.retriever(rec.id)
        embed = self.llm.embed if (self.llm.embed_model and retr.vectors) else None
        hits = retr.search(self._search_query(question, history), k=k, embed_fn=embed)
        # keep reading order stable for the model
        return sorted(hits, key=lambda h: h.chunk.id) if hits else []

    # ---------- generation ----------
    @staticmethod
    def format_sources(hits: list[Hit]) -> str:
        parts = [f"[{i}] p.{h.chunk.page}" for i, h in enumerate(hits, start=1)]
        return "\n\n---\n**Sources:** " + " · ".join(parts)

    @staticmethod
    def _context(hits: list[Hit]) -> str:
        return "\n\n".join(f"[{i}] (page {h.chunk.page})\n{h.chunk.text}" for i, h in enumerate(hits, 1))

    def build_messages(self, rec: DocRecord, question: str, history: list[dict], hits: list[Hit]) -> list[dict]:
        msgs = [
            {
                "role": "system",
                "content": SYSTEM_PROMPT.format(filename=rec.filename, context=self._context(hits)),
            }
        ]
        for h in (history or [])[-6:]:
            text = (h.get("text") or "").strip()
            if text:
                msgs.append({"role": "user" if h.get("role") == "user" else "assistant", "content": text})
        msgs.append({"role": "user", "content": question})
        return msgs

    @staticmethod
    def _best_sentences(hits: list[Hit], question: str, limit: int = 3) -> list[tuple[str, int]]:
        """Pick the sentences that overlap most with the question (used when no LLM is available)."""
        q = set(tokenize(question))
        scored, seen = [], set()
        for order, h in enumerate(hits):
            for sent in re.split(r"(?<=[.!?])\s+", h.chunk.text):
                sent = sent.strip()
                if len(sent) < 25 or sent in seen:  # overlapping chunks repeat sentences
                    continue
                seen.add(sent)
                overlap = len(q & set(tokenize(sent)))
                scored.append((overlap, -order, sent, h.chunk.page))
        scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
        best = [t for t in scored if t[0] > 0][:limit] or scored[:limit]
        return [(sent, page) for _, _, sent, page in best]

    def extractive_answer(self, hits: list[Hit], reason: str, question: str = "") -> str:
        if not hits:
            return f"{reason}\n\nI also couldn't find any passage in the document matching your question."
        quotes = []
        for sent, page in self._best_sentences(hits, question):
            if len(sent) > 500:
                sent = sent[:500].rsplit(" ", 1)[0] + "…"
            quotes.append(f"> {sent} — *page {page}*")
        return f"{reason}\n\nThe most relevant passages I found:\n\n" + "\n\n".join(quotes)

    def answer_stream(
        self,
        document: dict,
        question: str,
        history: Optional[list[dict]] = None,
        model: Optional[str] = None,
    ) -> Iterator[str]:
        question = (question or "").strip()
        if not question:
            raise BadRequest("Question is required.")
        rec = self.resolve_document(document)
        history = history or []
        hits = self.retrieve(rec, question, history)

        if not hits:
            # Nothing matched; give the model a spread of the document and let it say so honestly.
            hits = [Hit(c, 0.0) for c in sample_chunks(self.store.chunks(rec.id), self.settings.top_k)]
            no_match = True
        else:
            no_match = False

        if not self.llm.is_available():
            reason = (
                "⚠️ The local language model (Ollama) isn't reachable, so I can't write a full answer. "
                "Start it with `ollama serve` and make sure the model is pulled."
            )
            yield self.extractive_answer([] if no_match else hits, reason, question)
            return

        try:
            emitted = False
            for piece in self.llm.chat_stream(self.build_messages(rec, question, history, hits), model):
                emitted = True
                yield piece
            if not emitted:
                yield "The model returned an empty response."
                return
        except LLMUnavailable as exc:
            yield self.extractive_answer([] if no_match else hits, f"⚠️ The language model failed: {exc}", question)
            return
        if not no_match:
            yield self.format_sources(hits)
