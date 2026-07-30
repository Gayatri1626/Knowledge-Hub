"use client";

import { useState } from "react";
import type { Conversation } from "@/lib/api";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, newTitle: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: ConversationSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleStartEdit(conv: Conversation, e: React.MouseEvent) {
    e.stopPropagation();
    onSelect(conv.id);
    setEditingId(conv.id);
    setEditTitle(conv.title);
  }

  async function handleSaveEdit(id: string, e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (editingId !== id) return;
    setEditingId(null);
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conversations.find((c) => c.id === id)?.title) {
      await onRename(id, trimmed);
    }
  }

  function handleCancelEdit() {
    setEditingId(null);
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (deletingId === id) return;
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-white/10 p-3">
      <button
        onClick={onCreate}
        className="mb-3 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
        </svg>
        New conversation
      </button>

      <div className="flex-1 space-y-1 overflow-y-auto">
        {conversations.map((conversation) => {
          const isActive = conversation.id === activeId;
          const isEditing = conversation.id === editingId;
          const isDeleting = conversation.id === deletingId;

          if (isEditing) {
            return (
              <form
                key={conversation.id}
                onSubmit={(e) => handleSaveEdit(conversation.id, e)}
                className="flex items-center gap-1 rounded-lg border border-blue-500/50 bg-white/10 px-2 py-1.5"
              >
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") handleCancelEdit();
                  }}
                  onBlur={() => handleSaveEdit(conversation.id)}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none"
                />
                <button
                  type="submit"
                  title="Save title"
                  className="rounded p-1 text-green-400 hover:bg-white/10"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  title="Cancel"
                  className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              </form>
            );
          }

          return (
            <div
              key={conversation.id}
              onClick={() => onSelect(conversation.id)}
              className={`group flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer ${
                isActive
                  ? "bg-white/15 text-white font-medium"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              } ${isDeleting ? "opacity-40 pointer-events-none" : ""}`}
            >
              <span
                className="truncate flex-1 pr-2"
                title={conversation.title}
              >
                {conversation.title}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => handleStartEdit(conversation, e)}
                  title="Rename conversation"
                  className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                    <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => handleDelete(conversation.id, e)}
                  title="Delete conversation"
                  className="rounded p-1 text-white/60 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
