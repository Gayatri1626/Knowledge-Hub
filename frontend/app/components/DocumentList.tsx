"use client";

import React, { useState } from "react";
import { useDomain } from "@/lib/DomainContext";
import type { DrawerDocument } from "./DocumentDrawer";
import { TrashIcon, XIcon } from "./Icons";

interface DocumentListProps {
  onSelectDocument?: (doc: DrawerDocument) => void;
}

export default function DocumentList({ onSelectDocument }: DocumentListProps) {
  const { activeDomain, documents, deleteDocument } = useDomain();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Only use real backend documents — no fallback mocks
  const docList = documents.map((d) => ({
    id: d.id,
    filename: d.filename,
    title: d.filename.replace(/\.[^/.]+$/, ""),
    date: new Date(d.created_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    word_count: d.size_bytes ? Math.round(d.size_bytes / 6) : 0,
    status: d.status,
  }));

  const totalWords = docList.reduce((acc, d) => acc + (d.word_count || 0), 0);
  const docToDelete = docList.find((d) => d.id === confirmDeleteId) ?? null;

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    setIsDeleting(true);
    try {
      await deleteDocument(confirmDeleteId);
    } finally {
      setIsDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-white p-8 overflow-y-auto select-none">
      <div className="mx-auto w-full max-w-5xl space-y-6">

        {/* Top Summary Metrics Bar */}
        <div className="flex items-center gap-6 text-xs text-slate-500 font-medium pb-3 border-b border-slate-200">
          <div>
            <span className="font-bold text-slate-900 text-sm">{docList.length}</span> documents
          </div>
          <div>
            <span className="font-bold text-slate-900 text-sm">{totalWords.toLocaleString()}</span> total words
          </div>
          <div>
            <span className="font-bold text-slate-900 text-sm">1</span> domain scope ({activeDomain?.name ?? "—"})
          </div>
        </div>

        {/* Documents Table or Empty State */}
        {docList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <svg className="h-6 w-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-700">No documents yet</p>
            <p className="mt-1 text-xs text-slate-400">
              {activeDomain
                ? `Upload documents to the "${activeDomain.name}" domain to get started.`
                : "Select a domain first, then upload documents."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                <tr>
                  <th className="px-6 py-3.5">TITLE</th>
                  <th className="px-6 py-3.5">DATE</th>
                  <th className="px-6 py-3.5">STATUS</th>
                  <th className="px-6 py-3.5 text-right">WORDS</th>
                  <th className="px-6 py-3.5 text-center">DELETE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {docList.map((doc) => (
                  <tr
                    key={doc.id}
                    className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                  >
                    <td className="px-6 py-4 font-semibold text-slate-900 group-hover:text-blue-600">
                      <button
                        onClick={() =>
                          onSelectDocument &&
                          onSelectDocument({
                            id: doc.id,
                            filename: doc.filename,
                            title: doc.title,
                            date: doc.date,
                            word_count: doc.word_count,
                            summary: "",
                            content: "",
                          })
                        }
                        className="text-left hover:underline truncate max-w-xl block"
                      >
                        {doc.filename}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-slate-400">{doc.date}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          doc.status === "ready"
                            ? "bg-emerald-50 text-emerald-700"
                            : doc.status === "processing"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-red-50 text-red-600"
                        }`}
                      >
                        {doc.status === "ready" ? "Ready" : doc.status === "processing" ? "Processing" : "Failed"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-slate-600">
                      {doc.word_count ? doc.word_count.toLocaleString() : "—"}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(doc.id);
                        }}
                        title={`Delete "${doc.filename}"`}
                        className="inline-flex rounded-md p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500 transition-all cursor-pointer"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && docToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !isDeleting && setConfirmDeleteId(null)}
          />

          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-6 mx-4">
            <button
              onClick={() => setConfirmDeleteId(null)}
              disabled={isDeleting}
              className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <XIcon className="h-4 w-4" />
            </button>

            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 mb-4">
              <TrashIcon className="h-5 w-5 text-red-600" />
            </div>

            <h2 className="text-base font-bold text-slate-900 mb-1">Delete Document</h2>
            <p className="text-sm text-slate-500 mb-1">
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-slate-800">"{docToDelete.filename}"</span>?
            </p>
            <p className="text-xs text-red-500 font-medium mb-6">
              This removes the document and all of its embedded chunks from the vector database —
              it will no longer be searchable and answers can no longer cite it. This action cannot
              be undone.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                disabled={isDeleting}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <TrashIcon className="h-3.5 w-3.5" />
                    Delete permanently
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
