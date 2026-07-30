"use client";

import React, { useState } from "react";
import ChatWindow from "@/components/ChatWindow";
import type { DrawerDocument } from "@/components/DocumentDrawer";
import { createConversation, streamChatMessage, type Message } from "@/lib/api";
import { useDomain } from "@/lib/DomainContext";

interface ChatPageProps {
  onSelectDocument?: (doc: DrawerDocument) => void;
}

const TITLE_MAX_LENGTH = 60;

// ChatGPT-style default title: the first message itself, trimmed to a single
// line and capped in length, rather than a generic "Question for {domain}".
function titleFromMessage(text: string): string {
  const singleLine = text.trim().replace(/\s+/g, " ");
  if (!singleLine) return "New conversation";
  if (singleLine.length <= TITLE_MAX_LENGTH) return singleLine;
  return `${singleLine.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`;
}

export default function ChatPage({ onSelectDocument }: ChatPageProps) {
  const {
    activeDomainId,
    activeConversationId,
    setActiveConversationId,
    activeMessages,
    setActiveMessages,
  } = useDomain();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendMessage = async (text: string) => {
    if (!activeDomainId) return;
    let convId = activeConversationId;
    setIsLoading(true);
    setError(null);

    // Optimistically append user message immediately
    const tempUserMsg: Message = {
      id: `user-${Date.now()}`,
      conversation_id: convId || "pending",
      role: "user",
      content: text,
      citations: null,
      created_at: new Date().toISOString(),
    };
    setActiveMessages((prev) => [...prev, tempUserMsg]);

    const assistantMsgId = `asst-${Date.now()}`;
    // Tracked outside the setState updater (not inside it) so it isn't affected
    // by React re-invoking a state updater function more than once.
    let assistantStarted = false;

    try {
      if (!convId) {
        const newConv = await createConversation(titleFromMessage(text), activeDomainId);
        convId = newConv.id;
        setActiveConversationId(convId);
      }

      await streamChatMessage(convId, text, {
        onToken: (piece) => {
          if (!assistantStarted) {
            assistantStarted = true;
            const assistantMsg: Message = {
              id: assistantMsgId,
              conversation_id: convId!,
              role: "assistant",
              content: piece,
              citations: null,
              created_at: new Date().toISOString(),
            };
            setActiveMessages((prev) => [...prev, assistantMsg]);
          } else {
            setActiveMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, content: m.content + piece } : m))
            );
          }
        },
        onDone: ({ citations }) => {
          setActiveMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, citations } : m))
          );
        },
      });
    } catch (err: unknown) {
      // Remove the optimistic user message (and any partial assistant message) on failure
      setActiveMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id && m.id !== assistantMsgId));
      setError(err instanceof Error ? err.message : "Failed to get a response. Is the backend running?");
    } finally {
      setIsLoading(false);
    }
  };

  if (!activeDomainId) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400 text-sm">
        No domain selected. Create a domain first.
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs font-medium text-red-700">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-3 text-red-500 hover:text-red-700 font-bold"
          >
            ×
          </button>
        </div>
      )}
      <ChatWindow
        messages={activeMessages}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        onSelectSource={onSelectDocument}
      />
    </div>
  );
}
