# Retrieval-Augmented Generation (RAG) Overview

Retrieval-Augmented Generation, or RAG, is a technique that lets a language model answer questions using information from your own documents instead of relying only on what it memorised during training.

## How the pipeline works

First, a document such as a PDF is uploaded and its text is extracted page by page. The text is then split into small overlapping chunks, typically a few hundred words each, so that each chunk covers a single idea.

Second, the chunks are indexed. This platform uses BM25, a keyword ranking function, and can optionally add vector embeddings produced by a local Ollama embedding model. The two rankings are merged with Reciprocal Rank Fusion.

Third, when a user asks a question, the platform retrieves the top five most relevant chunks. Only those chunks are placed in the prompt, which keeps the prompt short and the answers grounded in the source.

Finally, a local language model served by Ollama writes the answer and cites the excerpts it used, for example [1] or [2]. The page numbers of the sources are listed under the answer.

## Why use RAG

RAG reduces hallucination because the model is told to answer only from the supplied excerpts. It also works on documents far larger than the model's context window, and it keeps sensitive documents on your own machine when you run the model locally.

## Limitations

Scanned PDFs without a text layer cannot be read because OCR is not included. Very vague questions may retrieve poor chunks, and tables inside PDFs may lose their structure during extraction.
