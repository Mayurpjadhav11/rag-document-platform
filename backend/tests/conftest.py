import base64
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from rag_platform import create_app
from rag_platform.config import Settings
from rag_platform.llm import OllamaClient

PAGES = [
    "Apollo Robotics was founded in 2015 in Lisbon. The company builds warehouse robots. "
    "Its first product, the PickBot, launched in 2017 and sold over 4000 units.",
    "Financial results: revenue in 2023 was 48 million euros, up 22 percent from 2022. "
    "The operating margin improved to 11 percent thanks to lower supplier costs.",
    "Sustainability: all factories run on renewable electricity since 2021. "
    "The company plans to reach net zero emissions by 2035 and publishes an annual climate report.",
]


def make_pdf(pages=PAGES) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import simpleSplit

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for text in pages:
        y = 800
        for line in simpleSplit(text, "Helvetica", 11, 480):
            c.drawString(50, y, line)
            y -= 16
        c.showPage()
    c.save()
    return buf.getvalue()


class FakeOllama(BaseHTTPRequestHandler):
    """Minimal fake of Ollama's /api/tags and /api/chat so tests need no real model."""

    last_messages = None

    def log_message(self, *a):  # silence
        pass

    def _json(self, obj, code=200):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/api/tags":
            self._json({"models": [{"name": "llama3:latest"}]})
        else:
            self._json({}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/api/chat":
            FakeOllama.last_messages = req["messages"]
            if req.get("format") == "json":
                return self._json(
                    {"message": {"content": json.dumps({"summary": "A fake summary.", "suggestedQuestions": ["Q1?", "Q2?", "Q3?"]})}}
                )
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()
            for piece in ["Revenue ", "was 48 ", "million [2]."]:
                self.wfile.write((json.dumps({"message": {"content": piece}, "done": False}) + "\n").encode())
            self.wfile.write((json.dumps({"message": {"content": ""}, "done": True}) + "\n").encode())
        else:
            self._json({}, 404)


@pytest.fixture(scope="session")
def fake_ollama():
    srv = HTTPServer(("127.0.0.1", 0), FakeOllama)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def _client(tmp_path, ollama_url):
    s = Settings(data_dir=tmp_path / "data", ollama_base_url=ollama_url, ollama_model="llama3")
    llm = OllamaClient(s.ollama_base_url, s.ollama_model, 10)
    return create_app(s, llm).test_client()


@pytest.fixture()
def client(tmp_path, fake_ollama):
    return _client(tmp_path, fake_ollama)


@pytest.fixture()
def offline_client(tmp_path):
    return _client(tmp_path, "http://127.0.0.1:9")  # nothing listens on port 9


@pytest.fixture(scope="session")
def pdf_bytes():
    return make_pdf()


@pytest.fixture()
def doc_payload(pdf_bytes):
    return {
        "base64Data": base64.b64encode(pdf_bytes).decode(),
        "mimeType": "application/pdf",
        "filename": "apollo.pdf",
    }


def read_sse(resp) -> tuple[str, list[str]]:
    text, raw = "", []
    for line in resp.get_data(as_text=True).splitlines():
        if line.startswith("data: "):
            raw.append(line[6:])
            if line[6:] != "[DONE]":
                obj = json.loads(line[6:])
                text += obj.get("text", "")
    return text, raw
