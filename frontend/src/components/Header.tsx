import { useState } from 'react';
import { FileText, Server, Settings, CheckCircle2, AlertCircle, RefreshCw, ChevronDown, Radio } from 'lucide-react';
import { UploadedDoc, BackendStatus } from '../types';

interface HeaderProps {
  document: UploadedDoc | null;
  totalDocs?: number;
  backendStatus: BackendStatus | null;
  backendUrl: string;
  isCheckingBackend: boolean;
  onRefreshBackend: () => void;
  onUpdateBackendUrl: (newUrl: string) => void;
}

export function Header({
  document,
  totalDocs = 0,
  backendStatus,
  backendUrl,
  isCheckingBackend,
  onRefreshBackend,
  onUpdateBackendUrl,
}: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [inputUrl, setInputUrl] = useState(backendUrl || 'http://localhost:5000');

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateBackendUrl(inputUrl.trim());
    setShowSettings(false);
  };

  const isConnected = backendStatus?.connected ?? false;

  return (
    <header id="app-header" className="border-b border-slate-200 bg-white sticky top-0 z-20 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Logo & Title */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-xs">
            📄
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-slate-900 leading-tight">
                AI PDF QA Agent
              </h1>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                Frontend Client
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Interactive document Q&A connected to your backend at <span className="font-mono text-slate-700">{backendUrl}</span>
            </p>
          </div>
        </div>

        {/* Right side: Backend status & document badge */}
        <div className="flex items-center gap-3">
          {/* Active Document Badge */}
          {document && (
            <div className="hidden md:inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs text-slate-700 font-medium">
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span className="max-w-[130px] truncate">{document.name}</span>
              {totalDocs > 1 && (
                <span className="text-[10px] text-slate-500 bg-white px-1.5 py-0.2 rounded-full border border-slate-200">
                  +{totalDocs - 1} more
                </span>
              )}
            </div>
          )}

          {/* Backend Status Badge */}
          <div className="relative">
            <button
              id="btn-backend-status"
              type="button"
              onClick={() => {
                setInputUrl(backendUrl);
                setShowSettings(!showSettings);
              }}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                isConnected
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100/70'
                  : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100/70'
              }`}
              title="Click to configure backend URL"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              <Server className="w-3.5 h-3.5 opacity-70" />
              <span className="font-semibold truncate max-w-[160px]">
                {isConnected ? 'Backend: Connected' : 'Backend: Offline'}
              </span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>

            {/* Backend Settings Dropdown */}
            {showSettings && (
              <div
                id="backend-settings-modal"
                className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-lg border border-slate-200 p-4 z-50 text-xs"
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 text-sm">
                    <Settings className="w-4 h-4 text-indigo-600" />
                    <span>Backend Server Connection</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="text-slate-400 hover:text-slate-700 text-base leading-none font-bold cursor-pointer"
                  >
                    &times;
                  </button>
                </div>

                <div className="my-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex items-start gap-2">
                    {isConnected ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800">
                        {isConnected ? 'Backend connected & healthy' : 'Backend not responding'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                        Target: {backendUrl}/api/health
                      </p>
                      {backendStatus?.error && (
                        <p className="text-[11px] text-rose-600 mt-1">
                          {backendStatus.error}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={onRefreshBackend}
                      disabled={isCheckingBackend}
                      className="p-1 hover:bg-white rounded text-slate-500 hover:text-indigo-600 border border-transparent hover:border-slate-200 cursor-pointer"
                      title="Test connection"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isCheckingBackend ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                <form onSubmit={handleSaveSettings} className="space-y-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Backend Server URL
                    </label>
                    <input
                      type="text"
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="http://localhost:5000"
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono text-xs"
                    />
                    <div className="mt-1 text-[11px] text-slate-500 space-y-0.5">
                      <p>• Configured in <code className="text-indigo-600 font-mono">src/api.ts</code>: <code className="font-semibold">http://localhost:5000</code></p>
                      <p>• Endpoints called: <code className="font-mono">{inputUrl || 'http://localhost:5000'}/api/*</code></p>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-between items-center">
                    <button
                      type="button"
                      onClick={onRefreshBackend}
                      disabled={isCheckingBackend}
                      className="px-2.5 py-1 text-slate-600 hover:text-indigo-600 border border-slate-200 hover:bg-slate-50 rounded-md inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Radio className="w-3 h-3 text-indigo-500" />
                      <span>{isCheckingBackend ? 'Pinging...' : 'Ping /api/health'}</span>
                    </button>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowSettings(false)}
                        className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-xs cursor-pointer"
                      >
                        Save URL
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
