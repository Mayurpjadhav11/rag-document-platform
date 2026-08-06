import { AskQuestionPayload, BackendStatus, DocumentAnalysisResponse, UploadedDoc } from './types';

/**
 * ============================================================================
 * Backend Server Configuration & Full Endpoint URLs
 * ============================================================================
 * Set your external backend server URL here (default: http://localhost:5000).
 * You can also set VITE_API_BASE_URL in your .env file or change it in the UI.
 */
export const DEFAULT_BACKEND_URL = 'http://localhost:5000';

/**
 * Retrieves current active backend URL (prefers localStorage, then env var, then default)
 */
export function getBackendBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('VITE_API_BASE_URL');
    if (saved) return saved.replace(/\/+$/, '');
  }
  const envUrl = (import.meta as any).env?.VITE_API_BASE_URL;
  return (envUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
}

/**
 * Allows dynamically changing the backend URL in the browser
 */
export function setBackendBaseUrl(newUrl: string): void {
  const cleaned = newUrl.trim().replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    localStorage.setItem('VITE_API_BASE_URL', cleaned);
  }
}

/**
 * Static baseline URL constant
 */
export const BACKEND_BASE_URL = getBackendBaseUrl();

/**
 * Full API Endpoints targeting your backend at http://localhost:5000
 */
export const ENDPOINT_HEALTH = `${BACKEND_BASE_URL}/api/health` as const;
export const ENDPOINT_DOCUMENT_ANALYZE = `${BACKEND_BASE_URL}/api/document/analyze` as const;
export const ENDPOINT_CHAT_STREAM = `${BACKEND_BASE_URL}/api/chat/stream` as const;
export const ENDPOINT_CHAT = `${BACKEND_BASE_URL}/api/chat` as const;
export const ENDPOINT_DOCUMENT_SAMPLE = `${BACKEND_BASE_URL}/api/document/sample` as const;
export const ENDPOINT_OLLAMA_STATUS = `${BACKEND_BASE_URL}/api/ollama/status` as const;

export const API_ENDPOINTS = {
  BASE_URL: BACKEND_BASE_URL,
  HEALTH: ENDPOINT_HEALTH,
  DOCUMENT_ANALYZE: ENDPOINT_DOCUMENT_ANALYZE,
  CHAT_STREAM: ENDPOINT_CHAT_STREAM,
  CHAT: ENDPOINT_CHAT,
  DOCUMENT_SAMPLE: ENDPOINT_DOCUMENT_SAMPLE,
  OLLAMA_STATUS: ENDPOINT_OLLAMA_STATUS,
} as const;

/**
 * Helper to construct full endpoint URL using current dynamic backend URL
 */
function resolveUrl(path: string): string {
  const base = getBackendBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

/**
 * Helper to convert browser File to Base64
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1] || '';
        resolve(base64);
      } else {
        reject(new Error('Failed to read file as data URL'));
      }
    };
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Checks connection to your backend server at http://localhost:5000/api/health
 */
export async function checkBackendHealth(): Promise<BackendStatus> {
  const targetUrl = resolveUrl('/api/health');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        connected: false,
        url: getBackendBaseUrl(),
        statusText: `HTTP ${response.status}`,
        error: `Server at ${targetUrl} returned HTTP ${response.status}`,
      };
    }

    const data = await response.json().catch(() => ({}));
    return {
      connected: true,
      url: getBackendBaseUrl(),
      statusText: 'Connected',
      info: data,
    };
  } catch (err: any) {
    return {
      connected: false,
      url: getBackendBaseUrl(),
      statusText: 'Disconnected',
      error: `Cannot reach backend at ${targetUrl}. Make sure your server is running.`,
    };
  }
}

/**
 * Calls your backend's document analysis endpoint: http://localhost:5000/api/document/analyze
 */
export async function analyzeDocument(document: {
  base64Data: string;
  mimeType: string;
  filename: string;
}): Promise<DocumentAnalysisResponse> {
  const targetUrl = resolveUrl('/api/document/analyze');
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({ error: 'Analysis failed' }));
    throw new Error(errData.error || `Failed to analyze document at ${targetUrl} (${response.status})`);
  }

  return response.json();
}

/**
 * Uploads a local file and sends it to your backend for parsing and question generation
 */
export async function uploadAndAnalyzeFile(file: File): Promise<UploadedDoc> {
  const base64Data = await fileToBase64(file);
  const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
  const id = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const uploadedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let summary = '';
  let suggestedQuestions: string[] = [];
  let extractedText = '';
  let pageCount = 1;

  try {
    const analysis = await analyzeDocument({
      base64Data,
      mimeType,
      filename: file.name,
    });
    summary = analysis.summary;
    suggestedQuestions = analysis.suggestedQuestions;
    extractedText = analysis.extractedText || '';
    pageCount = analysis.pageCount || 1;
  } catch (error: any) {
    console.warn(`Backend call to ${resolveUrl('/api/document/analyze')} failed or backend offline:`, error);
    summary = `Document uploaded: "${file.name}". Ready for Q&A with your backend.`;
    suggestedQuestions = [
      'What are the key points in this document?',
      'Can you summarize the main findings?',
      'What are the critical takeaways?',
    ];
  }

  return {
    id,
    name: file.name,
    size: file.size,
    type: mimeType,
    base64Data,
    extractedText,
    pageCount,
    summary,
    suggestedQuestions,
    uploadedAt,
  };
}

/**
 * Streams real-time answer from your backend: http://localhost:5000/api/chat/stream
 * via Server-Sent Events (SSE). Returns an abort function to cancel streaming if needed.
 */
export function streamAskQuestion(
  payload: AskQuestionPayload,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void
): () => void {
  const controller = new AbortController();
  const targetUrl = resolveUrl('/api/chat/stream');

  (async () => {
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(
          errorData.error || `Backend at ${targetUrl} responded with ${response.status}`
        );
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported by response');
      }

      const reader = response.body.getReader();
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
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') {
              onComplete();
              return;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.text) {
                onChunk(parsed.text);
              } else if (parsed.content) {
                onChunk(parsed.content);
              } else if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (e) {
              if (dataStr) onChunk(dataStr);
            }
          }
        }
      }

      onComplete();
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        return;
      }
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return () => controller.abort();
}

/**
 * Non-streaming fallback call to your backend: http://localhost:5000/api/chat
 */
export async function askQuestion(payload: AskQuestionPayload): Promise<string> {
  const targetUrl = resolveUrl('/api/chat');
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(errorData.error || `Backend responded with ${response.status}`);
  }

  const data = await response.json();
  return data.answer || data.content || data.response || '';
}

/**
 * Loads sample document from your backend: http://localhost:5000/api/document/sample
 */
export async function loadSampleDocument(): Promise<UploadedDoc> {
  const targetUrl = resolveUrl('/api/document/sample');
  const response = await fetch(targetUrl);
  if (!response.ok) {
    throw new Error(`Failed to load sample document from ${targetUrl}`);
  }
  const data = await response.json();
  return {
    ...data,
    id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    uploadedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}
