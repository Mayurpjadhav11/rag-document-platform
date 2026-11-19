# RAG Document Platform

<<<<<<< HEAD
A simple backend project for uploading and managing PDF documents using both **Flask** and **FastAPI**.

## Features

- Upload PDF files
- List uploaded PDF documents
- Store files locally in `data/pdfs`
- REST API endpoints
- PDF file validation
- FastAPI Swagger documentation

## Tech Stack

- Python
- Flask
- FastAPI
- Uvicorn

## API Endpoints

- `GET /` — Check if backend is running
- `POST /upload` — Upload a PDF
- `GET /documents` — List uploaded PDFs
- `GET /filenames` — Return PDF filenames

## Run Flask

```bash
pip install flask
python app.py
=======
Upload PDFs (or text/Markdown files), then chat with them. Answers are **grounded in your document**: the
backend splits it into chunks, retrieves the passages most relevant to each question, and has a **local LLM
(Ollama)** write the answer with `[1]`-style citations and page numbers. Nothing leaves your machine.

```
React UI (port 3000) ──▶ Flask API (port 5000) ──▶ Ollama (port 11434, local LLM)
                              │
                              └─ pypdf → chunker → BM25 (+ optional embeddings) → data/docs/<id>/
```

## Features

- PDF / `.txt` / `.md` upload, page-aware text extraction (`pypdf`)
- Sentence-aware overlapping chunking, **BM25** retrieval, optional **hybrid** retrieval with Ollama embeddings (Reciprocal Rank Fusion)
- Streaming answers over SSE, citations + page numbers, follow-up questions understand chat history
- Auto summary + suggested questions per document
- Works without Ollama too: falls back to showing the most relevant sentences from the document
- Persistent store (documents are de-duplicated by content hash), REST API for managing documents
- 22 automated tests (incl. a fake Ollama server), GitHub Actions CI

## Quick start

**1. Backend** (Python 3.10+)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                     # optional
python run.py                                            # http://localhost:5000
```

**2. Local LLM** (recommended)

```bash
# install from https://ollama.com, then:
ollama pull llama3
ollama serve                                             # if it isn't already running
# optional: better retrieval
ollama pull nomic-embed-text   # then set OLLAMA_EMBED_MODEL=nomic-embed-text in backend/.env
```

**3. Frontend** (Node 20+)

```bash
cd frontend
npm install
npm run dev                                              # http://localhost:3000
```

Open http://localhost:3000, drop in a PDF, and ask questions. If the backend is on another address, change it
in the UI's settings or set `VITE_API_BASE_URL` in `frontend/.env`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + config |
| GET | `/api/ollama/status` | Is Ollama up, which models are installed |
| POST | `/api/ollama/config` | Change Ollama URL / model at runtime |
| POST | `/api/document/analyze` | `{base64Data, mimeType, filename}` → summary, suggested questions, text, `docId` |
| GET | `/api/document/sample` | Built-in sample document |
| POST | `/api/chat/stream` | `{document, question, history}` → SSE stream `data: {"text": "..."}` … `data: [DONE]` |
| POST | `/api/chat` | Same, non-streaming → `{answer}` |
| POST | `/api/documents` | Multipart upload (`file`) → indexes it |
| GET | `/api/documents` · `/api/documents/<id>` | List / inspect |
| DELETE | `/api/documents/<id>` | Remove |
| POST | `/api/documents/<id>/search` | `{query}` → raw retrieved chunks (debugging retrieval) |
| POST | `/upload`, GET `/documents`, `/filenames` | Original prototype endpoints, kept for compatibility |

In `document` you can pass either the file (`base64Data`) or just a previously returned `docId`.

## Configuration (`backend/.env`)

`PORT`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `TOP_K`,
`MAX_UPLOAD_MB`, `CORS_ORIGINS`, `DATA_DIR` — see `backend/.env.example`.

## Tests

```bash
cd backend && python -m pytest -q
```

## Project layout

```
backend/
  run.py                  entry point
  rag_platform/           config · extract · chunker · retriever · store · llm · analysis · service · app
  tests/                  unit + API tests (fake Ollama)
  samples/                sample document
  legacy/                 original Flask / FastAPI upload prototypes
frontend/                 React + Vite + Tailwind UI
```

## Known limitations

- Scanned/image-only PDFs aren't supported (no OCR).
- Table structure in PDFs is flattened to text.
- The backend has no authentication — it is meant for local use; don't expose it publicly as is.
>>>>>>> 32a4f8b (Releasing final Check)
