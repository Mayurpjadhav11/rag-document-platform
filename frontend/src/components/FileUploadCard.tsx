import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { Upload, FileText, Trash2, RefreshCw, AlertCircle, Sparkles, CheckCircle2, HelpCircle, Plus, Check } from 'lucide-react';
import { UploadedDoc } from '../types';
import { uploadAndAnalyzeFile, loadSampleDocument } from '../api';

interface FileUploadCardProps {
  documents: UploadedDoc[];
  selectedDocId: string | null;
  onSelectDoc: (docId: string) => void;
  onDocUploaded: (doc: UploadedDoc) => void;
  onDocRemoved: (docId: string) => void;
  onClearAllDocs: () => void;
  onSelectQuestion: (question: string) => void;
}

export function FileUploadCard({
  documents,
  selectedDocId,
  onSelectDoc,
  onDocUploaded,
  onDocRemoved,
  onClearAllDocs,
  onSelectQuestion,
}: FileUploadCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showUploadDropzone, setShowUploadDropzone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedDoc = documents.find((doc) => doc.id === selectedDocId) || null;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleProcessFile = async (file: File) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isText =
      file.type.startsWith('text/') ||
      file.name.toLowerCase().endsWith('.txt') ||
      file.name.toLowerCase().endsWith('.md');

    if (!isPdf && !isText) {
      setError('Please upload a PDF document (.pdf) or text file (.txt, .md)');
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setError('File size exceeds 25MB limit. Please upload a smaller file.');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setLoadingStep(`Processing "${file.name}"...`);

      const doc = await uploadAndAnalyzeFile(file);
      onDocUploaded(doc);
      setShowUploadDropzone(false);
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'Failed to process document');
    } finally {
      setIsLoading(false);
      setLoadingStep('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleProcessFile(e.target.files[0]);
    }
  };

  const handleLoadSample = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setLoadingStep('Loading sample document...');
      const sample = await loadSampleDocument();
      onDocUploaded(sample);
      setShowUploadDropzone(false);
    } catch (err: any) {
      console.error('Sample loading error:', err);
      setError(err.message || 'Could not load sample document');
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  return (
    <div id="file-upload-card" className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col h-full overflow-hidden">
      {/* Card Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-600" />
          <h2 className="font-semibold text-slate-800 text-sm sm:text-base">Document Upload</h2>
          {documents.length > 0 && (
            <span
              id="doc-count-badge"
              className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium"
            >
              {documents.length} {documents.length === 1 ? 'file' : 'files'}
            </span>
          )}
        </div>

        {documents.length > 1 && !isLoading && (
          <button
            id="btn-clear-all-docs"
            onClick={onClearAllDocs}
            className="text-xs text-slate-500 hover:text-rose-600 hover:bg-rose-50 px-2 py-1 rounded transition-colors cursor-pointer"
            title="Remove all uploaded documents"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="p-4 sm:p-5 flex-1 flex flex-col space-y-4 overflow-y-auto">
        {error && (
          <div id="upload-error-alert" className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
            <button
              onClick={() => setError(null)}
              className="text-rose-500 hover:text-rose-800 text-xs font-bold"
            >
              &times;
            </button>
          </div>
        )}

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain"
          onChange={handleFileChange}
          className="hidden"
          id="file-input-control"
        />

        {/* Loading Spinner */}
        {isLoading && (
          <div className="p-5 border border-indigo-200 rounded-xl bg-indigo-50/50 flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-indigo-600 animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-800 truncate">{loadingStep || 'Processing document...'}</p>
              <p className="text-[11px] text-slate-500">Analyzing content and generating questions with AI</p>
            </div>
          </div>
        )}

        {/* If no documents uploaded yet, show initial dropzone */}
        {documents.length === 0 && !isLoading && (
          <div className="flex-1 flex flex-col justify-center">
            <div
              id="drop-zone-empty"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`p-6 sm:p-8 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-indigo-500 bg-indigo-50/70 scale-[0.99]'
                  : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50/80 bg-slate-50/40'
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 mb-3">
                <Upload className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium text-slate-800 mb-1">
                Drop your PDF here, or <span className="text-indigo-600 underline decoration-indigo-300 underline-offset-2">browse</span>
              </p>
              <p className="text-xs text-slate-500 max-w-xs">
                Supports PDF, TXT, and Markdown files up to 25MB
              </p>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">Need a test document?</span>
              <button
                id="btn-sample-doc"
                type="button"
                onClick={handleLoadSample}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2.5 py-1.5 rounded-md border border-indigo-200 transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Load Sample Report</span>
              </button>
            </div>
          </div>
        )}

        {/* If documents exist, show the uploaded files list with selection */}
        {documents.length > 0 && (
          <div className="space-y-4">
            {/* Uploaded Files Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Uploaded Documents ({documents.length})
                </label>
                <button
                  id="btn-add-another-file"
                  type="button"
                  onClick={() => {
                    setShowUploadDropzone(!showUploadDropzone);
                  }}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showUploadDropzone ? 'Cancel' : 'Add File'}</span>
                </button>
              </div>

              {/* Collapsible Dropzone to add another file */}
              {showUploadDropzone && (
                <div
                  id="drop-zone-additional"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="mb-3 p-4 border-2 border-dashed border-indigo-300 rounded-lg bg-indigo-50/40 text-center cursor-pointer hover:bg-indigo-50/70 transition-colors"
                >
                  <Upload className="w-5 h-5 text-indigo-600 mx-auto mb-1" />
                  <p className="text-xs font-medium text-slate-800">
                    Click to select or drop another PDF / text file
                  </p>
                </div>
              )}

              {/* List of files with selection */}
              <div id="uploaded-files-list" className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {documents.map((doc) => {
                  const isSelected = doc.id === selectedDocId;
                  return (
                    <div
                      key={doc.id}
                      id={`doc-item-${doc.id}`}
                      onClick={() => onSelectDoc(doc.id)}
                      className={`p-2.5 rounded-lg border text-left flex items-center justify-between gap-2 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50/60 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div
                          className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-xs ${
                            isSelected
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-xs font-medium truncate ${
                              isSelected ? 'text-indigo-950 font-semibold' : 'text-slate-800'
                            }`}
                            title={doc.name}
                          >
                            {doc.name}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                            <span>{formatFileSize(doc.size)}</span>
                            <span>•</span>
                            <span className="uppercase text-[10px] px-1 py-0.2 bg-slate-200/80 text-slate-700 rounded font-medium">
                              {doc.type.includes('pdf') ? 'PDF' : 'DOC'}
                            </span>
                            {doc.uploadedAt && (
                              <>
                                <span>•</span>
                                <span>{doc.uploadedAt}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isSelected ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                            <Check className="w-3 h-3" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectDoc(doc.id);
                            }}
                            className="text-[11px] text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded border border-slate-200 transition-colors cursor-pointer"
                          >
                            Select
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDocRemoved(doc.id);
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                          title="Delete this file"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Active Document Details (Summary & Questions) */}
            {selectedDoc && (
              <div className="pt-2 border-t border-slate-100 space-y-3">
                {/* Document Summary */}
                {selectedDoc.summary && (
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-slate-800">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Summary: {selectedDoc.name}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {selectedDoc.summary}
                    </p>
                  </div>
                )}

                {/* Suggested Questions for Selected Document */}
                {selectedDoc.suggestedQuestions && selectedDoc.suggestedQuestions.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1 text-xs font-medium text-slate-600">
                      <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                      <span>Suggested Questions</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {selectedDoc.suggestedQuestions.map((q, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onSelectQuestion(q)}
                          className="w-full text-left text-xs bg-white hover:bg-indigo-50/60 border border-slate-200 hover:border-indigo-200 text-slate-700 hover:text-indigo-900 rounded-lg p-2.5 transition-colors cursor-pointer leading-snug"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
