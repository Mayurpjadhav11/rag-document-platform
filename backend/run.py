"""Start the backend:  python run.py"""
from rag_platform import create_app
from rag_platform.config import Settings

settings = Settings()
app = create_app(settings)

if __name__ == "__main__":
    print(f"RAG backend running on http://localhost:{settings.port}  (Ollama: {settings.ollama_base_url}, model: {settings.ollama_model})")
    app.run(host=settings.host, port=settings.port, debug=False, threaded=True)
