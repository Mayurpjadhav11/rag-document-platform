export interface UploadedDoc {
  id: string;
  name: string;
  size: number;
  type: string;
  base64Data: string;
  extractedText?: string;
  pageCount?: number;
  summary?: string;
  suggestedQuestions?: string[];
  uploadedAt?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  error?: boolean;
}

export interface AskQuestionPayload {
  document: {
    base64Data: string;
    mimeType: string;
    filename: string;
    extractedText?: string;
  };
  question: string;
  history?: Array<{
    role: 'user' | 'model';
    text: string;
  }>;
  model?: string;
  ollamaUrl?: string;
}

export interface DocumentAnalysisResponse {
  summary: string;
  suggestedQuestions: string[];
  extractedText?: string;
  pageCount?: number;
}

export interface OllamaStatus {
  connected: boolean;
  baseUrl: string;
  selectedModel: string;
  availableModels: string[];
  error?: string;
}

export interface BackendStatus {
  connected: boolean;
  url: string;
  statusText?: string;
  error?: string;
  info?: any;
}
