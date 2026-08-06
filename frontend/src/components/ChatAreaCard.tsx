import { useState, useRef, useEffect, FormEvent, KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import { Send, Square, Trash2, Bot, User, Copy, Check, Sparkles, CornerDownLeft } from 'lucide-react';
import { ChatMessage, UploadedDoc } from '../types';

interface ChatAreaCardProps {
  messages: ChatMessage[];
  currentDoc: UploadedDoc | null;
  isStreaming: boolean;
  backendUrl?: string;
  onSendMessage: (text: string) => void;
  onStopStreaming: () => void;
  onClearChat: () => void;
  selectedQuestionPrompt?: string;
}

export function ChatAreaCard({
  messages,
  currentDoc,
  isStreaming,
  backendUrl,
  onSendMessage,
  onStopStreaming,
  onClearChat,
  selectedQuestionPrompt,
}: ChatAreaCardProps) {
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // When a suggested question is clicked in the left card, populate and focus
  useEffect(() => {
    if (selectedQuestionPrompt) {
      setInput(selectedQuestionPrompt);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  }, [selectedQuestionPrompt]);

  // Auto scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming || !currentDoc) return;
    onSendMessage(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div id="chat-area-card" className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-indigo-600" />
          <h2 className="font-semibold text-slate-800 text-sm sm:text-base">Document Q&A</h2>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
            Real-time SSE
          </span>
        </div>

        {messages.length > 0 && (
          <button
            id="btn-clear-chat"
            onClick={onClearChat}
            disabled={isStreaming}
            className="text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-50 px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
            title="Clear chat history"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Chat</span>
          </button>
        )}
      </div>

      {/* Messages container */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {!currentDoc ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3 border border-slate-200">
              <Bot className="w-7 h-7" />
            </div>
            <p className="text-sm font-medium text-slate-700">No Document Uploaded</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Please upload a PDF or text document using the card on the left to start asking questions in real-time.
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-3 border border-indigo-100">
              <Sparkles className="w-7 h-7" />
            </div>
            <p className="text-sm font-medium text-slate-800">Ready to Answer</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Ask anything about <span className="font-semibold text-slate-700">{currentDoc.name}</span>. You can also click any suggested question on the left.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`relative max-w-[85%] sm:max-w-[78%] rounded-xl px-4 py-3 text-xs sm:text-sm ${
                    isUser
                      ? 'bg-indigo-600 text-white shadow-xs rounded-tr-xs'
                      : msg.error
                      ? 'bg-rose-50 border border-rose-200 text-rose-800 rounded-tl-xs'
                      : 'bg-slate-50 border border-slate-200 text-slate-800 shadow-xs rounded-tl-xs'
                  }`}
                >
                  {isUser ? (
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="markdown-body prose prose-slate prose-sm max-w-none text-slate-800 leading-relaxed overflow-x-auto">
                        <Markdown>{msg.content}</Markdown>
                      </div>
                      
                      {msg.isStreaming && (
                        <span className="inline-block w-2 h-4 ml-1 bg-indigo-600 animate-pulse align-middle" />
                      )}

                      {!msg.isStreaming && !msg.error && (
                        <div className="pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-400">
                          <span>{msg.timestamp}</span>
                          <button
                            onClick={() => handleCopy(msg.id, msg.content)}
                            className="hover:text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                            title="Copy response"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span className="text-emerald-600">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-3 sm:p-4 border-t border-slate-200 bg-slate-50/50">
        <form onSubmit={handleSubmit} className="relative flex flex-col gap-2">
          <div className="relative flex items-center">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!currentDoc || isStreaming}
              placeholder={
                !currentDoc
                  ? 'Upload a document first to ask questions...'
                  : isStreaming
                  ? 'Generating real-time answer...'
                  : 'Ask any question about this document...'
              }
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-20 text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-400 transition-all shadow-xs"
            />

            <div className="absolute right-2.5 flex items-center gap-1">
              {isStreaming ? (
                <button
                  id="btn-stop-streaming"
                  type="button"
                  onClick={onStopStreaming}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  title="Stop generating"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  id="btn-send-message"
                  type="submit"
                  disabled={!input.trim() || !currentDoc}
                  className="w-9 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed shadow-xs"
                  title="Send question"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <CornerDownLeft className="w-3 h-3" /> Press Enter to send, Shift+Enter for new line
            </span>
            {currentDoc && (
              <span className="text-slate-500 font-medium truncate max-w-[200px]">
                Target: {currentDoc.name}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
