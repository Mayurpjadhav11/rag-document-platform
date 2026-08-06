import { useState, useRef, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { FileUploadCard } from './components/FileUploadCard';
import { ChatAreaCard } from './components/ChatAreaCard';
import { UploadedDoc, ChatMessage, BackendStatus } from './types';
import {
  streamAskQuestion,
  checkBackendHealth,
  getBackendBaseUrl,
  setBackendBaseUrl,
} from './api';
import { AlertCircle, Terminal, CheckCircle2, ArrowRight } from 'lucide-react';

export default function App() {
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [messagesByDoc, setMessagesByDoc] = useState<Record<string, ChatMessage[]>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedQuestionPrompt, setSelectedQuestionPrompt] = useState<string>('');
  
  // Backend server URL and status
  const [backendUrl, setBackendUrlState] = useState<string>(getBackendBaseUrl());
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [isCheckingBackend, setIsCheckingBackend] = useState(false);

  const stopStreamRef = useRef<(() => void) | null>(null);

  const checkHealth = useCallback(async () => {
    setIsCheckingBackend(true);
    try {
      const status = await checkBackendHealth();
      setBackendStatus(status);
    } catch (err: any) {
      setBackendStatus({
        connected: false,
        url: getBackendBaseUrl(),
        statusText: 'Offline',
        error: err.message || 'Cannot reach backend server',
      });
    } finally {
      setIsCheckingBackend(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const handleUpdateBackendUrl = (newUrl: string) => {
    const cleaned = newUrl.trim().replace(/\/+$/, '');
    setBackendBaseUrl(cleaned);
    setBackendUrlState(cleaned);
    setTimeout(() => {
      checkHealth();
    }, 100);
  };

  const activeDoc = documents.find((doc) => doc.id === selectedDocId) || null;
  const currentMessages = selectedDocId ? messagesByDoc[selectedDocId] || [] : [];

  const handleDocUploaded = (doc: UploadedDoc) => {
    setDocuments((prev) => {
      const existsIndex = prev.findIndex((d) => d.name === doc.name && d.size === doc.size);
      if (existsIndex >= 0) {
        const copy = [...prev];
        copy[existsIndex] = doc;
        return copy;
      }
      return [doc, ...prev];
    });

    setSelectedDocId(doc.id);
    setSelectedQuestionPrompt('');
  };

  const handleSelectDoc = (docId: string) => {
    if (isStreaming && stopStreamRef.current) {
      stopStreamRef.current();
      stopStreamRef.current = null;
      setIsStreaming(false);
    }
    setSelectedDocId(docId);
    setSelectedQuestionPrompt('');
  };

  const handleDocRemoved = (docId: string) => {
    if (isStreaming && stopStreamRef.current && selectedDocId === docId) {
      stopStreamRef.current();
      stopStreamRef.current = null;
      setIsStreaming(false);
    }

    setDocuments((prev) => {
      const filtered = prev.filter((d) => d.id !== docId);
      if (selectedDocId === docId) {
        setSelectedDocId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });

    setMessagesByDoc((prev) => {
      const copy = { ...prev };
      delete copy[docId];
      return copy;
    });

    setSelectedQuestionPrompt('');
  };

  const handleClearAllDocs = () => {
    if (stopStreamRef.current) {
      stopStreamRef.current();
      stopStreamRef.current = null;
    }
    setDocuments([]);
    setSelectedDocId(null);
    setMessagesByDoc({});
    setIsStreaming(false);
    setSelectedQuestionPrompt('');
  };

  const handleSelectQuestion = (question: string) => {
    setSelectedQuestionPrompt(question);
  };

  const handleSendMessage = (text: string) => {
    if (!activeDoc || !selectedDocId) return;

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `bot-${Date.now() + 1}`;
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const docId = selectedDocId;
    const history = messagesByDoc[docId] || [];

    const newHistory: ChatMessage[] = [
      ...history,
      {
        id: userMsgId,
        role: 'user',
        content: text,
        timestamp: now,
      },
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: now,
        isStreaming: true,
      },
    ];

    setMessagesByDoc((prev) => ({
      ...prev,
      [docId]: newHistory,
    }));
    setIsStreaming(true);

    const apiHistory = history.map((m) => ({
      role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
      text: m.content,
    }));

    const abortFn = streamAskQuestion(
      {
        document: {
          base64Data: activeDoc.base64Data,
          mimeType: activeDoc.type,
          filename: activeDoc.name,
          extractedText: activeDoc.extractedText,
        },
        question: text,
        history: apiHistory,
      },
      // onChunk
      (chunk: string) => {
        setMessagesByDoc((prev) => {
          const list = prev[docId] || [];
          return {
            ...prev,
            [docId]: list.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + chunk }
                : msg
            ),
          };
        });
      },
      // onComplete
      () => {
        setIsStreaming(false);
        setMessagesByDoc((prev) => {
          const list = prev[docId] || [];
          return {
            ...prev,
            [docId]: list.map((msg) =>
              msg.id === assistantMsgId ? { ...msg, isStreaming: false } : msg
            ),
          };
        });
        stopStreamRef.current = null;
      },
      // onError
      (error: Error) => {
        setIsStreaming(false);
        setMessagesByDoc((prev) => {
          const list = prev[docId] || [];
          return {
            ...prev,
            [docId]: list.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    content:
                      msg.content ||
                      `Error: ${error.message || `Failed to receive answer from backend at ${backendUrl}`}`,
                    isStreaming: false,
                    error: true,
                  }
                : msg
            ),
          };
        });
        stopStreamRef.current = null;
      }
    );

    stopStreamRef.current = abortFn;
  };

  const handleStopStreaming = () => {
    if (stopStreamRef.current) {
      stopStreamRef.current();
      stopStreamRef.current = null;
    }
    setIsStreaming(false);
    if (selectedDocId) {
      setMessagesByDoc((prev) => {
        const list = prev[selectedDocId] || [];
        return {
          ...prev,
          [selectedDocId]: list.map((msg) =>
            msg.isStreaming ? { ...msg, isStreaming: false } : msg
          ),
        };
      });
    }
  };

  const handleClearChat = () => {
    if (stopStreamRef.current) {
      stopStreamRef.current();
      stopStreamRef.current = null;
    }
    if (selectedDocId) {
      setMessagesByDoc((prev) => ({
        ...prev,
        [selectedDocId]: [],
      }));
    }
    setIsStreaming(false);
  };

  return (
    <div className="min-h-screen bg-slate-100/70 flex flex-col font-sans text-slate-900 antialiased">
      <Header
        document={activeDoc}
        totalDocs={documents.length}
        backendStatus={backendStatus}
        backendUrl={backendUrl}
        isCheckingBackend={isCheckingBackend}
        onRefreshBackend={checkHealth}
        onUpdateBackendUrl={handleUpdateBackendUrl}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col">
        {/* Backend status alert banner if offline */}
        {backendStatus && !backendStatus.connected && (
          <div
            id="backend-notice-banner"
            className="mb-4 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
          >
            <div className="flex items-start sm:items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <span className="font-semibold">Backend server not detected at {backendUrl}.</span>
                <span className="text-amber-800 ml-1">
                  Ensure your backend server is running on port 5000 with CORS enabled.
                </span>
                <span className="block sm:inline text-slate-500 sm:ml-2 text-[11px]">
                  Endpoints: <code className="font-mono">{backendUrl}/api/health</code>, <code className="font-mono">{backendUrl}/api/chat/stream</code>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
              <button
                onClick={checkHealth}
                disabled={isCheckingBackend}
                className="px-3 py-1 bg-amber-200/70 hover:bg-amber-200 text-amber-900 font-medium rounded-md transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>{isCheckingBackend ? 'Checking...' : 'Check /api/health'}</span>
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 h-full min-h-0">
          {/* Card 1: File Upload & Document Selection Card */}
          <section className="lg:col-span-5 xl:col-span-4 h-full min-h-[440px] lg:min-h-0 flex flex-col">
            <FileUploadCard
              documents={documents}
              selectedDocId={selectedDocId}
              onSelectDoc={handleSelectDoc}
              onDocUploaded={handleDocUploaded}
              onDocRemoved={handleDocRemoved}
              onClearAllDocs={handleClearAllDocs}
              onSelectQuestion={handleSelectQuestion}
            />
          </section>

          {/* Card 2: Chat Area Card */}
          <section className="lg:col-span-7 xl:col-span-8 h-full min-h-[520px] lg:min-h-0 flex flex-col">
            <ChatAreaCard
              messages={currentMessages}
              currentDoc={activeDoc}
              isStreaming={isStreaming}
              backendUrl={backendUrl}
              onSendMessage={handleSendMessage}
              onStopStreaming={handleStopStreaming}
              onClearChat={handleClearChat}
              selectedQuestionPrompt={selectedQuestionPrompt}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
