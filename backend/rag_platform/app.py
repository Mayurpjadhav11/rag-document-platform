"""Flask application factory exposing the REST + SSE API used by the React frontend."""
from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from flask import Flask, Response, jsonify, request, stream_with_context

from .config import Settings
from .llm import OllamaClient
from .service import BadRequest, RagService
from .store import DocumentStore

SAMPLE_PATH = Path(__file__).resolve().parent.parent / "samples" / "sample-rag-overview.md"


def create_app(settings: Optional[Settings] = None, llm: Optional[OllamaClient] = None) -> Flask:
    settings = settings or Settings()
    settings.ensure_dirs()
    llm = llm or OllamaClient(
        settings.ollama_base_url, settings.ollama_model, settings.ollama_timeout, settings.embed_model
    )
    store = DocumentStore(settings.data_dir, settings.chunk_size, settings.chunk_overlap)
    service = RagService(settings, store, llm)

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = settings.max_upload_mb * 1024 * 1024
    app.extensions["rag"] = service  # handy for tests

    # ---------------- CORS ----------------
    @app.after_request
    def add_cors(resp: Response):
        origin = request.headers.get("Origin")
        allowed = settings.cors_origins
        if allowed == "*":
            resp.headers["Access-Control-Allow-Origin"] = "*"
        elif origin and origin in [o.strip() for o in allowed.split(",")]:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        return resp

    @app.before_request
    def preflight():
        # Answer CORS preflight for every route (Flask's automatic OPTIONS reply would be a 200).
        if request.method == "OPTIONS":
            return Response(status=204)

    # ---------------- errors ----------------
    @app.errorhandler(BadRequest)
    def handle_bad_request(exc: BadRequest):
        return jsonify({"error": str(exc)}), 400

    @app.errorhandler(413)
    def too_large(_exc):
        return jsonify({"error": f"File too large (max {settings.max_upload_mb} MB)."}), 413

    @app.errorhandler(404)
    def not_found(_exc):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(500)
    def server_error(_exc):
        return jsonify({"error": "Internal server error"}), 500

    def body() -> dict:
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise BadRequest("Expected a JSON object body.")
        return data

    # ---------------- health / status ----------------
    @app.get("/")
    def home():
        return jsonify({"message": "Backend is working!", "service": "rag-document-platform"})

    @app.get("/api/health")
    def health():
        return jsonify(
            {
                "status": "ok",
                "documents": len(store.list()),
                "ollamaBaseUrl": llm.base_url,
                "ollamaModel": llm.model,
                "embedModel": llm.embed_model or None,
            }
        )

    @app.get("/api/ollama/status")
    def ollama_status():
        return jsonify(llm.status())

    @app.post("/api/ollama/config")
    def ollama_config():
        data = body()
        base = data.get("baseUrl")
        if base:
            u = urlparse(str(base))
            if u.scheme not in ("http", "https") or not u.netloc:
                raise BadRequest("baseUrl must be an http(s) URL.")
            llm.base_url = str(base).rstrip("/")
        if data.get("model"):
            llm.model = str(data["model"]).strip()
        if "embedModel" in data:
            llm.embed_model = str(data["embedModel"] or "").strip()
        return jsonify({"success": True, "baseUrl": llm.base_url, "selectedModel": llm.model})

    # ---------------- frontend contract ----------------
    @app.post("/api/document/analyze")
    def analyze():
        data = body()
        if not (data.get("base64Data") or data.get("extractedText")):
            raise BadRequest("Missing document data.")
        return jsonify(service.analyze(data, data.get("model")))

    @app.get("/api/document/sample")
    def sample():
        raw = SAMPLE_PATH.read_bytes()
        rec = service.ingest_bytes(raw, SAMPLE_PATH.name, "text/markdown")
        info = service.analyze({"docId": rec.id})
        return jsonify(
            {
                "name": rec.filename,
                "size": rec.size,
                "type": "text/markdown",
                "base64Data": base64.b64encode(raw).decode("ascii"),
                "extractedText": info["extractedText"],
                "pageCount": info["pageCount"],
                "summary": info["summary"],
                "suggestedQuestions": info["suggestedQuestions"],
            }
        )

    def _chat_args():
        data = body()
        return (
            data.get("document"),
            data.get("question", ""),
            data.get("history") or [],
            data.get("model"),
        )

    @app.post("/api/chat/stream")
    def chat_stream():
        document, question, history, model = _chat_args()
        # Resolve + validate eagerly so bad requests return a proper 400, not a broken stream.
        if not str(question).strip():
            raise BadRequest("Question is required.")
        service.resolve_document(document)
        gen = service.answer_stream(document, question, history, model)

        @stream_with_context
        def sse():
            try:
                for piece in gen:
                    yield f"data: {json.dumps({'text': piece})}\n\n"
            except BadRequest as exc:
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            except Exception as exc:  # pragma: no cover - defensive
                app.logger.exception("stream failed")
                yield f"data: {json.dumps({'error': 'Streaming failed: ' + str(exc)})}\n\n"
            yield "data: [DONE]\n\n"

        return Response(
            sse(),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/chat")
    def chat():
        document, question, history, model = _chat_args()
        answer = "".join(service.answer_stream(document, question, history, model))
        return jsonify({"answer": answer})

    # ---------------- document management ----------------
    @app.post("/api/documents")
    def upload_document():
        f = request.files.get("file")
        if f is None or not f.filename:
            raise BadRequest("Send the file as multipart form field 'file'.")
        rec = service.ingest_bytes(f.read(), f.filename, f.mimetype or "")
        return jsonify({"message": "Document indexed", **rec.public()}), 201

    @app.get("/api/documents")
    def list_documents():
        return jsonify({"documents": [r.public() for r in store.list()]})

    @app.get("/api/documents/<doc_id>")
    def get_document(doc_id: str):
        try:
            return jsonify(store.get(doc_id, with_text=False).public())
        except KeyError:
            return jsonify({"error": "Document not found"}), 404

    @app.delete("/api/documents/<doc_id>")
    def delete_document(doc_id: str):
        if store.delete(doc_id):
            return jsonify({"message": "Deleted", "id": doc_id})
        return jsonify({"error": "Document not found"}), 404

    @app.post("/api/documents/<doc_id>/search")
    def search_document(doc_id: str):
        data = body()
        query = str(data.get("query", "")).strip()
        if not query:
            raise BadRequest("query is required.")
        if not store.exists(doc_id):
            return jsonify({"error": "Document not found"}), 404
        rec = store.get(doc_id, with_text=False)
        hits = service.retrieve(rec, query, [])
        return jsonify(
            {
                "query": query,
                "results": [
                    {"chunkId": h.chunk.id, "page": h.chunk.page, "score": round(h.score, 5), "text": h.chunk.text}
                    for h in hits
                ],
            }
        )

    # ---------------- legacy endpoints (original prototype API) ----------------
    @app.post("/upload")
    def legacy_upload():
        f = request.files.get("file")
        if f is None or not f.filename:
            raise BadRequest("No file provided.")
        if not f.filename.lower().endswith(".pdf"):
            raise BadRequest("Only PDF files are allowed")
        rec = service.ingest_bytes(f.read(), f.filename, "application/pdf")
        return jsonify({"message": "PDF uploaded successfully", "filename": rec.filename, "id": rec.id})

    def _pdf_names():
        return [r.filename for r in store.list() if r.filename.lower().endswith(".pdf")]

    @app.get("/documents")
    def legacy_documents():
        return jsonify({"files": _pdf_names()})

    @app.get("/filenames")
    def legacy_filenames():
        return jsonify({"files": _pdf_names()})

    return app
