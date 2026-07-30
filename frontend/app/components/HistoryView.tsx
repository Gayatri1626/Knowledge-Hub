"use client";

import React, { useState, useEffect } from "react";
import type { Conversation, Message } from "@/lib/api";
import { CornerUpRightIcon, ArrowLeftIcon, TrashIcon, XIcon } from "./Icons";
import MessageBubble from "./MessageBubble";
import type { DrawerDocument } from "./DocumentDrawer";

interface HistoryViewProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  messages: Message[];
  onContinueConversation: () => void;
  onSelectSource?: (doc: DrawerDocument) => void;
  onDeleteConversation?: (id: string) => Promise<void>;
  loading?: boolean;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDateLabel(iso: string): string {
  try {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "TODAY";
    if (date.toDateString() === yesterday.toDateString()) return "YESTERDAY";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
  } catch {
    return "EARLIER";
  }
}

function groupByDate(conversations: Conversation[]): Map<string, Conversation[]> {
  const groups = new Map<string, Conversation[]>();
  for (const conv of conversations) {
    const label = formatDateLabel(conv.updated_at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(conv);
  }
  return groups;
}

export default function HistoryView({
  conversations,
  activeConversationId,
  onSelectConversation,
  messages,
  onContinueConversation,
  onSelectSource,
  onDeleteConversation,
  loading = false,
}: HistoryViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(activeConversationId);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setSelectedId(activeConversationId);
  }, [activeConversationId]);

  const activeConv = conversations.find((c) => c.id === selectedId) ?? null;
  const grouped = groupByDate(conversations);
  const convoToDelete = conversations.find((c) => c.id === confirmDeleteId) ?? null;

  const handleSelect = (id: string) => {
    setSelectedId(id);
    onSelectConversation(id);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId || !onDeleteConversation) return;
    setIsDeleting(true);
    try {
      await onDeleteConversation(confirmDeleteId);
      if (selectedId === confirmDeleteId) setSelectedId(null);
    } finally {
      setIsDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="flex h-full w-full bg-white select-none">
      {/* Sub-Sidebar: CONVERSATIONS */}
      <div className="flex h-full w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50/50">
        <div className="px-5 pt-5 pb-3">
          <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            CONVERSATIONS
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-xs text-slate-400">
              Loading...
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-xs text-slate-400 text-center px-4">
              No conversations yet. Start a chat to create one.
            </div>
          ) : (
            Array.from(grouped.entries()).map(([label, convs]) => (
              <div key={label}>
                <div className="px-2 py-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                  {label}
                </div>
                <div className="mt-1 space-y-1">
                  {convs.map((conv) => {
                    const isActive = conv.id === selectedId;
                    return (
                      <div key={conv.id} className="group relative flex items-center">
                        <button
                          onClick={() => handleSelect(conv.id)}
                          className={`w-full text-left rounded-lg p-3 pr-8 transition-all cursor-pointer ${
                            isActive
                              ? "bg-blue-50/80 border-l-4 border-blue-600 text-blue-700 shadow-2xs"
                              : "hover:bg-slate-200/50 text-slate-700"
                          }`}
                        >
                          <div className={`text-sm font-semibold truncate ${isActive ? "text-blue-700" : "text-slate-800"}`}>
                            {conv.title || "Untitled Conversation"}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {formatTime(conv.updated_at)}
                          </div>
                        </button>

                        {onDeleteConversation && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(conv.id);
                            }}
                            title={`Delete "${conv.title || "Untitled Conversation"}"`}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 transition-all"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex h-full flex-1 flex-col bg-white">
        {activeConv ? (
          <>
            {/* Header Actions Row */}
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-8 bg-white">
              <button
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" />
                All conversations
              </button>

              <button
                onClick={onContinueConversation}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-blue-700 transition-colors cursor-pointer"
              >
                <CornerUpRightIcon className="h-3.5 w-3.5" />
                Continue conversation
              </button>
            </div>

            {/* Transcript scroll view */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <div className="mx-auto max-w-3xl">
                {messages.length > 0 ? (
                  messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} onSelectSource={onSelectSource} />
                  ))
                ) : (
                  <div className="text-center text-sm text-slate-400 py-12">
                    No recorded messages in this conversation.
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            {conversations.length > 0
              ? "Select a conversation from the left to view its transcript."
              : "No conversation history for this domain yet."}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && convoToDelete && (
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

            <h2 className="text-base font-bold text-slate-900 mb-1">Delete Conversation</h2>
            <p className="text-sm text-slate-500 mb-1">
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-slate-800">
                "{convoToDelete.title || "Untitled Conversation"}"
              </span>
              ?
            </p>
            <p className="text-xs text-red-500 font-medium mb-6">
              This will permanently delete all messages in this conversation. This action cannot
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
