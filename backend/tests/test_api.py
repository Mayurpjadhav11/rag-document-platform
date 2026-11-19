import base64
import io

from .conftest import FakeOllama, read_sse


def test_home_health_and_status(client):
    assert client.get("/").get_json()["message"] == "Backend is working!"
    assert client.get("/api/health").get_json()["status"] == "ok"
    st = client.get("/api/ollama/status").get_json()
    assert st["connected"] and st["availableModels"] == ["llama3:latest"]
    assert st["selectedModel"] == "llama3:latest"


def test_cors_headers(client):
    r = client.options("/api/chat/stream", headers={"Origin": "http://localhost:3000"})
    assert r.status_code == 204
    assert r.headers["Access-Control-Allow-Origin"] == "*"


def test_analyze_with_llm(client, doc_payload):
    r = client.post("/api/document/analyze", json=doc_payload)
    d = r.get_json()
    assert r.status_code == 200
    assert d["summary"] == "A fake summary." and d["suggestedQuestions"] == ["Q1?", "Q2?", "Q3?"]
    assert d["pageCount"] == 3 and "Lisbon" in d["extractedText"] and d["docId"]


def test_analyze_offline_uses_heuristics(offline_client, doc_payload):
    d = offline_client.post("/api/document/analyze", json=doc_payload).get_json()
    assert "apollo.pdf" in d["summary"] and len(d["suggestedQuestions"]) == 3
    assert d["pageCount"] == 3


def test_analyze_validation(client):
    assert client.post("/api/document/analyze", json={}).status_code == 400
    assert client.post("/api/document/analyze", data="nope").status_code == 400
    bad = {"base64Data": base64.b64encode(b"%PDF-1.4 junk").decode(), "filename": "x.pdf"}
    r = client.post("/api/document/analyze", json=bad)
    assert r.status_code == 400 and "error" in r.get_json()


def test_chat_stream_rag_and_sse_format(client, doc_payload):
    r = client.post(
        "/api/chat/stream",
        json={"document": doc_payload, "question": "What was the revenue in 2023?", "history": []},
    )
    assert r.status_code == 200 and r.mimetype == "text/event-stream"
    text, raw = read_sse(r)
    assert raw[-1] == "[DONE]"
    assert text.startswith("Revenue was 48 million [2].")
    assert "**Sources:**" in text and "p.2" in text
    # retrieval put the right page into the prompt, and only relevant chunks
    system = FakeOllama.last_messages[0]["content"]
    assert "48 million euros" in system and "net zero" not in system
    assert FakeOllama.last_messages[-1] == {"role": "user", "content": "What was the revenue in 2023?"}


def test_chat_history_and_followup(client, doc_payload):
    hist = [
        {"role": "user", "text": "What was the revenue in 2023?"},
        {"role": "model", "text": "48 million."},
    ]
    r = client.post("/api/chat/stream", json={"document": doc_payload, "question": "and the margin?", "history": hist})
    read_sse(r)
    roles = [m["role"] for m in FakeOllama.last_messages]
    assert roles == ["system", "user", "assistant", "user"]
    assert "operating margin" in " ".join(FakeOllama.last_messages[0]["content"].split())


def test_chat_broad_question_samples_whole_doc(client, doc_payload):
    read_sse(client.post("/api/chat/stream", json={"document": doc_payload, "question": "Summarize this document"}))
    system = FakeOllama.last_messages[0]["content"]
    assert "Lisbon" in system and "net zero" in system


def test_chat_validation(client, doc_payload):
    assert client.post("/api/chat/stream", json={"document": doc_payload, "question": "  "}).status_code == 400
    assert client.post("/api/chat/stream", json={"question": "hi"}).status_code == 400


def test_chat_offline_falls_back_to_passages(offline_client, doc_payload):
    r = offline_client.post("/api/chat/stream", json={"document": doc_payload, "question": "When was the company founded?"})
    text, raw = read_sse(r)
    assert raw[-1] == "[DONE]"
    assert "Ollama" in text and "founded in 2015" in text


def test_chat_non_streaming(client, doc_payload):
    d = client.post("/api/chat", json={"document": doc_payload, "question": "revenue 2023?"}).get_json()
    assert d["answer"].startswith("Revenue was 48 million")


def test_document_management_and_dedupe(client, pdf_bytes):
    up = lambda: client.post(
        "/api/documents", data={"file": (io.BytesIO(pdf_bytes), "apollo.pdf")}, content_type="multipart/form-data"
    )
    r1 = up()
    assert r1.status_code == 201
    doc = r1.get_json()
    assert doc["pageCount"] == 3 and doc["chunkCount"] >= 3
    assert up().get_json()["id"] == doc["id"]  # same bytes -> same document
    assert len(client.get("/api/documents").get_json()["documents"]) == 1
    assert client.get(f"/api/documents/{doc['id']}").get_json()["filename"] == "apollo.pdf"

    s = client.post(f"/api/documents/{doc['id']}/search", json={"query": "net zero"}).get_json()
    assert s["results"][0]["page"] == 3

    # chat can reference the stored doc by id only
    r = client.post("/api/chat/stream", json={"document": {"docId": doc["id"]}, "question": "revenue 2023"})
    assert "Revenue" in read_sse(r)[0]

    assert client.delete(f"/api/documents/{doc['id']}").status_code == 200
    assert client.get(f"/api/documents/{doc['id']}").status_code == 404
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 404
    assert client.get("/api/documents/not-a-valid-id").status_code == 404
    assert client.delete("/api/documents/..%2F..%2Fetc").status_code == 404


def test_upload_rejects_garbage(client):
    r = client.post("/api/documents", data={}, content_type="multipart/form-data")
    assert r.status_code == 400
    r = client.post("/api/documents", data={"file": (io.BytesIO(b"   "), "x.txt")}, content_type="multipart/form-data")
    assert r.status_code == 400


def test_sample_document_roundtrip(client):
    d = client.get("/api/document/sample").get_json()
    assert d["name"].endswith(".md") and d["base64Data"] and len(d["suggestedQuestions"]) == 3
    r = client.post(
        "/api/chat/stream",
        json={
            "document": {"base64Data": d["base64Data"], "mimeType": d["type"], "filename": d["name"]},
            "question": "What are the limitations of RAG?",
        },
    )
    read_sse(r)
    assert "OCR" in FakeOllama.last_messages[0]["content"]


def test_legacy_endpoints(client, pdf_bytes):
    r = client.post("/upload", data={"file": (io.BytesIO(pdf_bytes), "apollo.pdf")}, content_type="multipart/form-data")
    assert r.status_code == 200 and r.get_json()["filename"] == "apollo.pdf"
    assert client.get("/documents").get_json() == {"files": ["apollo.pdf"]}
    assert client.get("/filenames").get_json() == {"files": ["apollo.pdf"]}
    r = client.post("/upload", data={"file": (io.BytesIO(b"x"), "a.txt")}, content_type="multipart/form-data")
    assert r.status_code == 400
