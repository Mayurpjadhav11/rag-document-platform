"""Turn an uploaded file (PDF / text / markdown) into a list of pages of text."""
from __future__ import annotations

import io
import re
from dataclasses import dataclass


class ExtractionError(Exception):
    pass


@dataclass
class Page:
    number: int  # 1-based
    text: str


@dataclass
class Extracted:
    pages: list[Page]
    total_pages: int


def is_pdf(filename: str, mime_type: str, data: bytes) -> bool:
    return (
        data[:5] == b"%PDF-"
        or "pdf" in (mime_type or "").lower()
        or (filename or "").lower().endswith(".pdf")
    )


def _clean(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"-\n(?=[a-z])", "", text)  # de-hyphenate line-broken words
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pages(data: bytes, filename: str = "", mime_type: str = "") -> Extracted:
    """Return non-empty pages. Raises ExtractionError if nothing readable is found."""
    if not data:
        raise ExtractionError("The file is empty.")

    if is_pdf(filename, mime_type, data):
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                try:
                    reader.decrypt("")
                except Exception:
                    raise ExtractionError("This PDF is password-protected.")
            pages = []
            for i, p in enumerate(reader.pages, start=1):
                try:
                    txt = _clean(p.extract_text() or "")
                except Exception:
                    txt = ""
                if txt:
                    pages.append(Page(i, txt))
            total = len(reader.pages)
        except PdfReadError as exc:
            raise ExtractionError(f"Could not read this PDF: {exc}") from exc
        if not pages:
            raise ExtractionError(
                "No text found in this PDF (it may be a scanned image; OCR is not supported)."
            )
        return Extracted(pages, total)

    # Plain text / markdown: treat ~3000 chars as a "page" so citations stay useful.
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    text = _clean(text)
    if not text:
        raise ExtractionError("The file contains no readable text.")
    pages: list[Page] = []
    buf, n = [], 1
    for para in re.split(r"\n\s*\n", text):
        buf.append(para)
        if sum(len(b) for b in buf) >= 3000:
            pages.append(Page(n, "\n\n".join(buf)))
            buf, n = [], n + 1
    if buf:
        pages.append(Page(n, "\n\n".join(buf)))
    return Extracted(pages, len(pages))
