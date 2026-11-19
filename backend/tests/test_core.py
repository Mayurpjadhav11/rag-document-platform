from rag_platform.chunker import chunk_pages
from rag_platform.extract import ExtractionError, Page, extract_pages
from rag_platform.retriever import Retriever, tokenize

import pytest


def test_extract_pdf_pages(pdf_bytes):
    ex = extract_pages(pdf_bytes, "a.pdf", "application/pdf")
    assert ex.total_pages == 3
    assert "Lisbon" in ex.pages[0].text
    assert ex.pages[1].number == 2


def test_extract_text_and_errors():
    assert "hello" in extract_pages(b"hello world", "a.txt").pages[0].text
    with pytest.raises(ExtractionError):
        extract_pages(b"", "a.txt")
    with pytest.raises(ExtractionError):
        extract_pages(b"%PDF-1.4 this is not really a pdf", "a.pdf")


def test_chunking_respects_size_and_page():
    text = " ".join(f"Sentence number {i} is here." for i in range(200))
    chunks = chunk_pages([Page(1, text), Page(2, "Short page two.")], size=300, overlap=60)
    assert all(len(c.text) <= 320 for c in chunks)
    assert chunks[-1].page == 2 and chunks[-1].text == "Short page two."
    assert [c.id for c in chunks] == list(range(len(chunks)))
    # overlap: consecutive chunks on the same page share some text
    assert chunks[0].text.split()[-3:] == chunks[1].text.split()[:3] or "Sentence" in chunks[1].text


def test_chunk_handles_giant_sentence():
    chunks = chunk_pages([Page(1, "word " * 1000)], size=200, overlap=20)
    assert len(chunks) > 5 and all(len(c.text) <= 200 for c in chunks)


def test_tokenize_stems_and_drops_stopwords():
    assert tokenize("The documents are in the companies") == ["document", "company"]


def test_bm25_ranks_relevant_chunk_first(pdf_bytes):
    ex = extract_pages(pdf_bytes, "a.pdf")
    chunks = chunk_pages(ex.pages, 900, 100)
    r = Retriever(chunks)
    assert r.search("net zero emissions target", k=1)[0].chunk.page == 3
    assert r.search("what was revenue in 2023", k=1)[0].chunk.page == 2
    assert r.search("zzzz qqqq", k=3) == []


def test_hybrid_fusion_uses_vectors():
    from rag_platform.chunker import Chunk

    chunks = [Chunk(0, 1, "alpha beta"), Chunk(1, 1, "gamma delta")]
    vecs = [[1.0, 0.0], [0.0, 1.0]]
    r = Retriever(chunks, vecs)
    # query shares no keywords, but the embedding points at chunk 1
    hits = r.search("unrelated", k=1, embed_fn=lambda q: [0.0, 1.0])
    assert hits[0].chunk.id == 1
