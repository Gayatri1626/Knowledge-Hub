"use client";

import React from "react";
import FileUploader from "@/components/FileUploader";
import { useDomain } from "@/lib/DomainContext";

export default function UploadPage() {
  const { activeDomain, refreshDocuments } = useDomain();

  if (!activeDomain) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400 text-sm">
        No domain selected. Create a domain first.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 select-none overflow-y-auto p-8">
      <div className="mx-auto w-full max-w-2xl space-y-8 pt-4">
          {/* Header Title */}
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Upload Documents</h1>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Upload PDF, TXT, or MD files. Each file will be parsed, split into chunks, embedded, and stored in your vector database.
            </p>
          </div>

          {/* Box 1: UPLOADING TO */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              UPLOADING TO
            </span>
            <div className="mt-1 text-base font-bold text-slate-900">
              {activeDomain.name}
            </div>
          </div>

          {/* Box 2: File Dropzone Box (Source selection omitted per user request) */}
          <FileUploader onUploadSuccess={refreshDocuments} />
        </div>
    </div>
  );
}
