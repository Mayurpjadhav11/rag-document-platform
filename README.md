# RAG Document Platform

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
