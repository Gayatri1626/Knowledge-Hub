"use client";

import React, { useEffect, useRef, useState } from "react";
import { CloudUploadIcon } from "./Icons";
import { useDomain } from "@/lib/DomainContext";
import type { DocumentItem } from "@/lib/api";

interface FileUploaderProps {
  onUploadSuccess?: (docs: DocumentItem[]) => void;
}

export default function FileUploader({ onUploadSuccess }: FileUploaderProps) {
  const { uploadFilesToActiveDomain, documents } = useDomain();
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // ids of documents from the most recent upload batch, tracked so we can show
  // their live status (processing -> ready/failed) as the context's document
  // list gets polled in the background, rather than declaring success the
  // moment the upload request itself returns (which is before chunking/
  // embedding even starts - that runs as a server-side background task).
  const [trackedIds, setTrackedIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trackedDocs = documents.filter((d) => trackedIds.includes(d.id));
  const allTrackedSettled =
    trackedDocs.length > 0 && trackedDocs.every((d) => d.status !== "processing");

  useEffect(() => {
    if (allTrackedSettled) {
      // Give the final state a moment to be visible, then stop tracking so a
      // later unrelated upload starts from a clean slate.
      const timer = setTimeout(() => setTrackedIds([]), 8000);
      return () => clearTimeout(timer);
    }
  }, [allTrackedSettled]);

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const uploadedDocs = await uploadFilesToActiveDomain(fileArray);
      setTrackedIds(uploadedDocs.map((d) => d.id));
      if (onUploadSuccess) onUploadSuccess(uploadedDocs);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to upload files");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Dashed Dropzone Box */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition-all cursor-pointer select-none ${
          isDragging
            ? "border-blue-600 bg-blue-50/50"
            : "border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50/50"
        } ${isSubmitting ? "opacity-50 pointer-events-none" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
          }}
        />

        <CloudUploadIcon className="h-10 w-10 text-slate-400 mb-3" />
        <h3 className="text-sm font-bold text-slate-800">Drop files here</h3>
        <p className="mt-1 text-xs text-slate-400">
          PDF, TXT, MD · click to browse · multiple files supported
        </p>

        {isSubmitting && (
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-blue-600">
            <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
            Uploading...
          </div>
        )}
      </div>

      {/* Live per-file status: chunking/embedding runs as a background task
          server-side, so this keeps updating (via DomainContext's polling)
          from "Processing" to "Ready" or "Failed" well after the upload
          request itself has already returned. */}
      {trackedDocs.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs divide-y divide-slate-100">
          {trackedDocs.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800">{doc.filename}</div>
                {doc.status === "failed" && doc.error && (
                  <div className="mt-0.5 truncate text-xs text-red-500" title={doc.error}>
                    {doc.error}
                  </div>
                )}
              </div>

              {doc.status === "processing" && (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                  Processing
                </span>
              )}
              {doc.status === "ready" && (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Ready
                </span>
              )}
              {doc.status === "failed" && (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Failed
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs font-medium text-red-700">
          {errorMsg}
        </div>
      )}
    </div>
  );
}
