"use client";

import React, { useState, useRef, useEffect } from "react";
import { useDomain } from "@/lib/DomainContext";
import MessageBubble from "./MessageBubble";
import { SendIcon } from "./Icons";
import type { Message } from "@/lib/api";
import type { DrawerDocument } from "./DocumentDrawer";

interface ChatWindowProps {
  messages: Message[];
  onSendMessage: (text: string) => Promise<void>;
  isLoading?: boolean;
  onSelectSource?: (doc: DrawerDocument) => void;
}

export default function ChatWindow({
  messages,
  onSendMessage,
  isLoading = false,
  onSelectSource,
}: ChatWindowProps) {
  const { activeDomain } = useDomain();
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || isLoading) return;
    setInputText("");
    await onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-slate-50/50">
      {/* Scrollable messages container */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center select-none pt-24 pb-12">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
              {activeDomain?.name ?? "KnowledgeHub"}
            </h1>
            <p className="mt-3 text-xs font-semibold tracking-widest text-slate-400 uppercase">
              {activeDomain ? "ASK A QUESTION TO BEGIN" : "SELECT OR CREATE A DOMAIN TO BEGIN"}
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onSelectSource={onSelectSource} />
            ))}
            {isLoading && !(messages[messages.length - 1]?.role === "assistant" && messages[messages.length - 1]?.content) && (
              <div className="my-4 flex items-center gap-2 text-xs font-medium text-slate-400">
                <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
                Thinking & searching domain knowledge...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input container bar at bottom */}
      <div className="p-6 pt-2 bg-slate-50/50 select-none">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 rounded-xl border border-slate-200 bg-white shadow-2xs focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
              <textarea
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask ${activeDomain?.name ?? "a question"}...`}
                className="w-full resize-none border-0 bg-transparent py-3.5 px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
              />
            </div>
            <button
              type="submit"
              disabled={!inputText.trim() || isLoading}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-2xs hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            Enter to send · Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  );
}
