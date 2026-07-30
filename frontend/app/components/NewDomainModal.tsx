"use client";

import React, { useState } from "react";
import { useDomain } from "@/lib/DomainContext";
import { XIcon } from "./Icons";

export default function NewDomainModal() {
  const { isNewDomainModalOpen, setIsNewDomainModalOpen, addDomain } = useDomain();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (!isNewDomainModalOpen) return null;

  const handleClose = () => {
    setName("");
    setDescription("");
    setIsNewDomainModalOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    addDomain(name, description);
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fade-in">
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-slate-200 text-slate-800">
        {/* Close icon */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
          title="Close modal"
        >
          <XIcon className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <h2 className="text-xl font-bold text-slate-900">New Domain</h2>
        <p className="mt-1 text-sm text-slate-500">
          Create a named domain with its own document library
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Climate Policy Analyst"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Description <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this domain's focus area..."
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors resize-none"
            />
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-xs hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
