"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDomain } from "@/lib/DomainContext";
import { UploadIcon, NewChatIcon } from "./Icons";

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeDomain, startNewChat } = useDomain();

  const isUploadPage = pathname === "/upload";
  const activeTab = pathname.includes("/history")
    ? "history"
    : pathname.includes("/documents")
    ? "documents"
    : "chat";

  const handleNewChat = () => {
    startNewChat();
    router.push("/chat");
  };

  if (isUploadPage) {
    return (
      <header className="flex h-14 w-full items-center justify-between border-b border-slate-200 bg-white px-6">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Link
            href="/chat"
            className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 transition-colors font-medium"
          >
            ← Back
          </Link>
          <span className="text-slate-300">|</span>
          <span className="font-semibold text-slate-900">Upload Documents</span>
        </div>
      </header>
    );
  }

  return (
    <header className="w-full border-b border-slate-200 bg-white select-none">
      {/* Top Header Row */}
      <div className="flex h-14 items-center justify-between px-6 border-b border-slate-100">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="font-bold text-slate-900">KnowledgeHub</span>
          {activeDomain && (
            <>
              <span className="text-slate-400">/</span>
              <span className="text-slate-600">{activeDomain.name}</span>
            </>
          )}
        </div>

        <Link
          href="/upload"
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 transition-colors"
        >
          <UploadIcon className="h-3.5 w-3.5" />
          Upload
        </Link>
      </div>

      {/* Sub Header Navigation Tabs Row */}
      <div className="flex h-11 items-center justify-between px-6">
        <nav className="flex gap-8 h-full">
          <Link
            href="/chat"
            className={`flex items-center border-b-2 px-1 text-xs font-semibold transition-colors ${
              activeTab === "chat"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Chat
          </Link>
          <Link
            href="/history"
            className={`flex items-center border-b-2 px-1 text-xs font-semibold transition-colors ${
              activeTab === "history"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            History
          </Link>
          <Link
            href="/documents"
            className={`flex items-center border-b-2 px-1 text-xs font-semibold transition-colors ${
              activeTab === "documents"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Documents
          </Link>
        </nav>

        <button
          onClick={handleNewChat}
          className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <NewChatIcon className="h-3.5 w-3.5 text-slate-600" />
          New chat
        </button>
      </div>
    </header>
  );
}
