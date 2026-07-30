"use client";

import React from "react";
import { XIcon } from "./Icons";

export interface DrawerDocument {
  id?: string;
  filename: string;
  title?: string;
  date?: string;
  author?: string;
  source?: string;
  summary?: string;
  content?: string;
  tags?: string[];
  entities?: string[];
  word_count?: number;
}

interface DocumentDrawerProps {
  document: DrawerDocument | null;
  onClose: () => void;
}

export default function DocumentDrawer({ document, onClose }: DocumentDrawerProps) {
  if (!document) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl animate-slide-left">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 bg-slate-50/50">
        <h3 className="text-sm font-semibold text-slate-900 truncate pr-3" title={document.filename}>
          {document.filename}
        </h3>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors"
          title="Close panel"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Content scroll area */}
      <div className="flex-1 overflow-y-auto p-5 text-sm space-y-4 text-slate-700 leading-relaxed">
        {/* YAML / Metadata section */}
        <div className="rounded-lg bg-slate-50 p-4 border border-slate-200/80 font-mono text-xs text-slate-600 space-y-1.5 leading-normal">
          {document.title && <div>title: &quot;{document.title}&quot;</div>}
          {document.date && <div>date: &quot;{document.date}&quot;</div>}
          {document.author && <div>author: &quot;{document.author}&quot;</div>}
          {document.source && <div>source: &quot;{document.source}&quot;</div>}
          {document.summary && <div>summary: &quot;{document.summary}&quot;</div>}
          {document.tags && document.tags.length > 0 && (
            <div>tags: [{document.tags.map((t) => `"${t}"`).join(", ")}]</div>
          )}
          {document.word_count && <div>word_count: {document.word_count}</div>}
        </div>

        {/* Text / Body Content */}
        <div className="pt-2">
          {document.title && (
            <h4 className="text-base font-bold text-slate-900 mb-1">{document.title}</h4>
          )}
          {document.date && (
            <p className="text-xs text-slate-400 italic mb-4">{document.date}</p>
          )}

          <div className="whitespace-pre-wrap text-slate-700 text-sm leading-relaxed">
            {document.content ||
              `In our research into artificial intelligence and macro developments, the key adapting mechanism is structured collaboration with domain-specific knowledge bases and automated synthesis pipelines.`}
          </div>
        </div>
      </div>
    </div>
  );
}
