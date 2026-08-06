import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { PDFParse } from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Configurable Ollama defaults
let ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
let ollamaModel = process.env.OLLAMA_MODEL || 'llama3';

// Increase payload limit for PDF base64 data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/**
 * Extracts plain text from a base64 encoded document buffer.
 */
async function extractTextFromDocument(
  base64Data: string,
  mimeType: string
): Promise<{ text: string; pageCount?: number }> {
  const buffer = Buffer.from(base64Data, 'base64');
  const isPdf = mimeType.includes('pdf');

  if (!isPdf) {
    // Plain text / Markdown
    const text = buffer.toString('utf-8');
    return { text, pageCount: 1 };
  }

  try {
    const parser = new PDFParse({ data: buffer });
    const result: any = await parser.getText();
    await parser.destroy();

    const extracted = typeof result === 'string' ? result : result?.text || '';
    const pageCount = result?.total || 1;
    return {
      text: extracted.trim() || 'Document text could not be extracted (scanned or protected PDF).',
      pageCount,
    };
  } catch (error) {
    console.warn('PDF parsing error, falling back to string extraction:', error);
    const raw = buffer.toString('latin1');
    const textMatches = raw.match(/\(([^()]{3,})\)Tj/g) || [];
    const fallbackText = textMatches
      .map((m) => m.replace(/^\(/, '').replace(/\)Tj$/, ''))
      .join(' ')
      .trim();

    return {
      text: fallbackText || 'Text extraction was unable to decode characters from this PDF.',
      pageCount: 1,
    };
  }
}

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    ollamaBaseUrl,
    ollamaModel,
  });
});

// Ollama status and available models check
app.get('/api/ollama/status', async (_req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const response = await fetch(`${ollamaBaseUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.json({
        connected: false,
        baseUrl: ollamaBaseUrl,
        selectedModel: ollamaModel,
        availableModels: [],
        error: `Ollama returned HTTP ${response.status} from ${ollamaBaseUrl}`,
      });
    }

    const data: any = await response.json();
    const models = Array.isArray(data.models) ? data.models.map((m: any) => m.name) : [];

    // If current model is not in the list but list has models, prefer installed model
    let effectiveModel = ollamaModel;
    if (models.length > 0 && !models.includes(ollamaModel)) {
      const match = models.find((m: string) => m.startsWith(ollamaModel));
      if (match) {
        effectiveModel = match;
      }
    }

    res.json({
      connected: true,
      baseUrl: ollamaBaseUrl,
      selectedModel: effectiveModel,
      availableModels: models,
    });
  } catch (err: any) {
    res.json({
      connected: false,
      baseUrl: ollamaBaseUrl,
      selectedModel: ollamaModel,
      availableModels: [],
      error: `Cannot reach local Ollama at ${ollamaBaseUrl}. Make sure Ollama is running ('ollama serve').`,
    });
  }
});

// Update Ollama config
app.post('/api/ollama/config', (req, res) => {
  const { baseUrl, model } = req.body;
  if (baseUrl && typeof baseUrl === 'string') {
    ollamaBaseUrl = baseUrl.replace(/\/+$/, '');
  }
  if (model && typeof model === 'string') {
    ollamaModel = model.trim();
  }

  res.json({
    success: true,
    baseUrl: ollamaBaseUrl,
    selectedModel: ollamaModel,
  });
});

// Analyze document with Ollama
app.post('/api/document/analyze', async (req, res) => {
  try {
    const { base64Data, mimeType, filename, model, ollamaUrl } = req.body;

    if (!base64Data) {
      return res.status(400).json({ error: 'Missing document data' });
    }

    const activeUrl = (ollamaUrl || ollamaBaseUrl).replace(/\/+$/, '');
    const activeModel = model || ollamaModel;

    // 1. Extract text from the PDF or text file
    const { text, pageCount } = await extractTextFromDocument(base64Data, mimeType || 'application/pdf');

    // Sample snippet of document text to prevent overloading local models (first 8000 chars)
    const contextSnippet = text.slice(0, 8000);

    const systemPrompt = `You are an AI document analysis assistant. Given the text from a document titled "${filename || 'Document'}", perform two tasks:
1. Provide a concise, clear executive summary of what the document covers in 2-3 sentences.
2. List exactly 3 distinct, insightful questions that someone reading this document might ask.

Return your response strictly in the following JSON format:
{
  "summary": "Executive summary here...",
  "suggestedQuestions": ["Question 1?", "Question 2?", "Question 3?"]
}`;

    const userPrompt = `Document excerpt:\n"""\n${contextSnippet}\n"""\n\nGenerate the JSON summary and 3 questions now:`;

    let summary = '';
    let suggestedQuestions: string[] = [];

    try {
      const ollamaRes = await fetch(`${activeUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: activeModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          format: 'json',
          stream: false,
          options: {
            temperature: 0.3,
          },
        }),
      });

      if (ollamaRes.ok) {
        const data: any = await ollamaRes.json();
        const content = data.message?.content || '';
        try {
          const parsed = JSON.parse(content);
          if (parsed.summary) summary = parsed.summary;
          if (Array.isArray(parsed.suggestedQuestions) && parsed.suggestedQuestions.length > 0) {
            suggestedQuestions = parsed.suggestedQuestions;
          }
        } catch (e) {
          // If JSON parse fails, extract content
          summary = content.slice(0, 300);
        }
      }
    } catch (ollamaErr) {
      console.warn('Ollama analysis call failed or Ollama not connected:', ollamaErr);
    }

    // Fallback defaults if Ollama didn't return or is not yet running
    if (!summary) {
      const preview = text.slice(0, 240).replace(/\s+/g, ' ').trim();
      summary = preview
        ? `Document loaded (${pageCount || 1} page${pageCount === 1 ? '' : 's'}). Excerpt: "${preview}..."`
        : `Document "${filename}" loaded successfully. Ready for questions.`;
    }

    if (!suggestedQuestions || suggestedQuestions.length === 0) {
      suggestedQuestions = [
        'What are the key points in this document?',
        'Can you summarize the main conclusions or findings?',
        'What are the important action items or dates?',
      ];
    }

    res.json({
      summary,
      suggestedQuestions,
      extractedText: text,
      pageCount,
    });
  } catch (error: any) {
    console.error('Error in /api/document/analyze:', error);
    res.status(500).json({
      error: error.message || 'Failed to process and analyze document',
    });
  }
});

// Real-time streaming QA endpoint using local Ollama
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { document, question, history, model, ollamaUrl } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const activeUrl = (ollamaUrl || ollamaBaseUrl).replace(/\/+$/, '');
    const activeModel = model || ollamaModel;

    // Ensure we have extracted text for the document
    let docText = document?.extractedText;
    if (!docText && document?.base64Data) {
      const extracted = await extractTextFromDocument(document.base64Data, document.mimeType || 'application/pdf');
      docText = extracted.text;
    }

    // Prepare system instructions and document context
    // Bound context to ~24,000 characters for local Ollama context window
    const truncatedDocText = (docText || '').slice(0, 24000);

    const systemPrompt = `You are a helpful, precise document question-answering assistant powered by local Ollama.
You answer user questions strictly based on the provided document content: "${document?.filename || 'Document'}".
Instructions:
- Answer accurately and concisely based on the document text.
- If the question cannot be answered from the document, clearly state that.
- Cite specific sections or data points when relevant.
- Use clear markdown formatting.

Document Content:
"""
${truncatedDocText}
"""`;

    // Construct messages array for Ollama /api/chat
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        messages.push({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.text,
        });
      }
    }

    messages.push({ role: 'user', content: question });

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Call Ollama streaming endpoint
    const ollamaResponse = await fetch(`${activeUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: activeModel,
        messages,
        stream: true,
      }),
    });

    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text().catch(() => '');
      throw new Error(
        `Ollama returned error ${ollamaResponse.status}: ${errorText || 'Check if model is pulled: `ollama run ' + activeModel + '`'}`
      );
    }

    if (!ollamaResponse.body) {
      throw new Error('No readable stream received from Ollama');
    }

    const reader = (ollamaResponse.body as any).getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const chunk = JSON.parse(trimmed);
          const chunkText = chunk.message?.content;
          if (chunkText) {
            res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
          }
          if (chunk.done) {
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
        } catch (parseErr) {
          // ignore incomplete JSON chunk in stream
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('Error in /api/chat/stream:', error);
    const friendlyError = error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')
      ? `Cannot connect to Ollama at ${ollamaBaseUrl}. Please ensure your local Ollama is running ('ollama serve') and model '${ollamaModel}' is downloaded.`
      : error.message || 'Streaming failed';

    if (!res.headersSent) {
      res.status(500).json({ error: friendlyError });
    } else {
      res.write(`data: ${JSON.stringify({ error: friendlyError })}\n\n`);
      res.end();
    }
  }
});

// Non-streaming QA fallback endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { document, question, history, model, ollamaUrl } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const activeUrl = (ollamaUrl || ollamaBaseUrl).replace(/\/+$/, '');
    const activeModel = model || ollamaModel;

    let docText = document?.extractedText;
    if (!docText && document?.base64Data) {
      const extracted = await extractTextFromDocument(document.base64Data, document.mimeType || 'application/pdf');
      docText = extracted.text;
    }

    const truncatedDocText = (docText || '').slice(0, 24000);

    const systemPrompt = `You are a helpful document assistant. Answer questions based on the document: "${document?.filename || 'Document'}".
Document content:
"""
${truncatedDocText}
"""`;

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        messages.push({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.text,
        });
      }
    }

    messages.push({ role: 'user', content: question });

    const ollamaResponse = await fetch(`${activeUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: activeModel,
        messages,
        stream: false,
      }),
    });

    if (!ollamaResponse.ok) {
      const errText = await ollamaResponse.text();
      throw new Error(`Ollama error (${ollamaResponse.status}): ${errText}`);
    }

    const data: any = await ollamaResponse.json();
    res.json({ answer: data.message?.content || '' });
  } catch (error: any) {
    console.error('Error in /api/chat:', error);
    res.status(500).json({
      error: error.message || 'Failed to process question with Ollama',
    });
  }
});

// Sample document endpoint
app.get('/api/document/sample', (_req, res) => {
  const sampleContent = `AI Systems & Open Weights Technical Report: 2026
Document Reference: OLLAMA-TR-2026
Author: Local AI Engineering Group

1. Executive Summary
Local language models powered by Ollama enable high-throughput, private document question answering directly on local consumer and enterprise hardware. By eliminating external cloud API dependencies, organizations retain full data governance while achieving sub-50ms token latencies.

2. Benchmark Highlights
- Local Inference Latency: 32 tokens/second on M-series Apple Silicon and RTX 40-series GPUs.
- Privacy & Compliance: 100% on-premises data processing; zero outbound network telemetry.
- Supported Architectures: Llama-3, Mistral, Qwen 2.5, DeepSeek-R1, and Phi-3.
- Context Processing: Fast prompt evaluation via quantized context caches.

3. Best Practices for Document QA
1. Maintain structured text extraction from PDF documents prior to prompt assembly.
2. Provide grounding directives in system instructions to prevent hallucinated references.
3. Keep prompt history concise (last 4-6 turns) to maximize context space for document excerpts.`;

  const sampleBase64 = Buffer.from(sampleContent, 'utf-8').toString('base64');

  res.json({
    name: 'Sample_Local_AI_Report.txt',
    size: Buffer.byteLength(sampleContent, 'utf-8'),
    type: 'text/plain',
    base64Data: sampleBase64,
    extractedText: sampleContent,
    pageCount: 1,
    summary: 'A 2026 technical report reviewing local open-weights language model execution with Ollama, benchmarking local latency, privacy guarantees, and prompt optimization.',
    suggestedQuestions: [
      'What are the main privacy benefits of using local Ollama?',
      'What are the benchmark tokens/second reported on consumer GPUs?',
      'What are the three best practices for document QA?',
    ],
  });
});

// Server boot and Vite middleware integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Local Ollama PDF QA Agent server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
