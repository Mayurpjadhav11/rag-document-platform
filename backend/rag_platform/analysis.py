"""Document summary + suggested questions (LLM when available, heuristics otherwise)."""
from __future__ import annotations

import json
import re
from collections import Counter

from .chunker import Chunk
from .llm import LLMUnavailable, OllamaClient
from .retriever import tokenize

DEFAULT_QUESTIONS = [
    "What are the key points in this document?",
    "Can you summarize the main conclusions or findings?",
    "What are the important action items or dates?",
]


def sample_chunks(chunks: list[Chunk], n: int) -> list[Chunk]:
    """Pick up to n chunks spread evenly across the document (always includes the first)."""
    if len(chunks) <= n:
        return list(chunks)
    step = (len(chunks) - 1) / (n - 1) if n > 1 else 0
    idx = sorted({round(i * step) for i in range(n)})
    return [chunks[i] for i in idx]


GENERIC = frozenset(
    "model chunk document documents using used also based include including such many may like help "
    "answer answer question questions user users first second third finally example number page pages section sentence text file files data".split()
)


def top_keywords(chunks: list[Chunk], n: int = 6) -> list[str]:
    counts: Counter = Counter()
    df: Counter = Counter()
    for c in chunks:
        toks = tokenize(c.text)
        counts.update(toks)
        df.update(set(toks))
    total = max(len(chunks), 1)
    scored = {
        t: f * (1 + (1 - df[t] / total))  # prefer terms that are frequent but not everywhere
        for t, f in counts.items()
        if len(t) > 3 and not t.isdigit() and f >= 2 and t not in GENERIC
    }
    return [t for t, _ in sorted(scored.items(), key=lambda kv: kv[1], reverse=True)[:n]]


def heuristic_analysis(filename: str, chunks: list[Chunk], page_count: int) -> dict:
    text = " ".join(c.text for c in chunks[:3])
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if len(s.strip()) > 40]
    lead = " ".join(sentences[:2])[:400].strip()
    pages = f"{page_count} page{'s' if page_count != 1 else ''}"
    if lead:
        summary = f'"{filename}" ({pages}). {lead}'
    else:
        summary = f'"{filename}" loaded ({pages}). Ready for questions.'
    kws = top_keywords(chunks)
    questions = [f"What does the document say about {k}?" for k in kws[:2]]
    questions.append("Can you summarize the main points of this document?")
    for q in DEFAULT_QUESTIONS:
        if len(questions) >= 3:
            break
        if q not in questions:
            questions.append(q)
    return {"summary": summary, "suggestedQuestions": questions[:3]}


def llm_analysis(llm: OllamaClient, filename: str, chunks: list[Chunk], model: str | None = None) -> dict:
    excerpt = "\n\n".join(c.text for c in sample_chunks(chunks, 6))[:7000]
    system = (
        f'You analyse documents. The document is titled "{filename}". '
        "Reply ONLY with JSON: "
        '{"summary": "2-3 sentence executive summary", "suggestedQuestions": ["q1?", "q2?", "q3?"]}. '
        "Questions must be answerable from the document."
    )
    raw = llm.chat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": f'Document excerpts:\n"""\n{excerpt}\n"""'},
        ],
        model=model,
        json_mode=True,
    )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMUnavailable("Model returned invalid JSON") from exc
    summary = str(data.get("summary", "")).strip()
    qs = [str(q).strip() for q in data.get("suggestedQuestions", []) if str(q).strip()]
    if not summary:
        raise LLMUnavailable("Model returned no summary")
    return {"summary": summary, "suggestedQuestions": (qs + DEFAULT_QUESTIONS)[:3] if len(qs) < 3 else qs[:3]}
