"use client";

import React, { useState } from "react";
import { useDomain } from "@/lib/DomainContext";
import { PlusIcon, TrashIcon, XIcon } from "./Icons";

export default function Sidebar() {
  const { domains, activeDomainId, setActiveDomainId, setIsNewDomainModalOpen, deleteDomain } =
    useDomain();

  // Confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const domainToDelete = domains.find((d) => d.id === confirmDeleteId);

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    setIsDeleting(true);
    try {
      await deleteDomain(confirmDeleteId);
    } finally {
      setIsDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  return (
    <>
      <aside className="flex h-full w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-100/70 select-none">
        {/* Header Label */}
        <div className="px-4 pt-5 pb-3">
          <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            DOMAINS
          </span>
        </div>

        {/* Domains List */}
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {domains.map((domain) => {
            const isActive = domain.id === activeDomainId;
            return (
              <div key={domain.id} className="group relative flex items-center">
                <button
                  onClick={() => setActiveDomainId(domain.id)}
                  className={`flex-1 rounded-lg px-3 py-2.5 text-left transition-all cursor-pointer pr-8 ${
                    isActive
                      ? "bg-blue-100/70 text-blue-700 font-semibold"
                      : "text-slate-700 hover:bg-slate-200/60 hover:text-slate-900"
                  }`}
                >
                  <div className="text-sm leading-tight truncate">{domain.name}</div>
                  <div className={`text-xs mt-0.5 ${isActive ? "text-blue-600/80" : "text-slate-400"}`}>
                    {domain.docCount} docs
                  </div>
                </button>

                {/* Delete button — visible on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(domain.id);
                  }}
                  title={`Delete "${domain.name}"`}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 transition-all"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Bottom Action Button */}
        <div className="p-3 border-t border-slate-200/80 bg-slate-100/80">
          <button
            onClick={() => setIsNewDomainModalOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 transition-colors"
          >
            <PlusIcon className="h-4 w-4" />
            New Domain
          </button>
        </div>
      </aside>

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && domainToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !isDeleting && setConfirmDeleteId(null)}
          />

          {/* Dialog */}
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-6 mx-4">
            {/* Close button */}
            <button
              onClick={() => setConfirmDeleteId(null)}
              disabled={isDeleting}
              className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <XIcon className="h-4 w-4" />
            </button>

            {/* Warning icon */}
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 mb-4">
              <TrashIcon className="h-5 w-5 text-red-600" />
            </div>

            <h2 className="text-base font-bold text-slate-900 mb-1">Delete Domain</h2>
            <p className="text-sm text-slate-500 mb-1">
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-slate-800">"{domainToDelete.name}"</span>?
            </p>
            <p className="text-xs text-red-500 font-medium mb-6">
              This will permanently delete all {domainToDelete.docCount} document(s) and conversation
              history in this domain. This action cannot be undone.
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
    </>
  );
}
