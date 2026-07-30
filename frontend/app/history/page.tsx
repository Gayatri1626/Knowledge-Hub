"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import HistoryView from "@/components/HistoryView";
import type { DrawerDocument } from "@/components/DocumentDrawer";
import { useDomain } from "@/lib/DomainContext";
import type { Conversation } from "@/lib/api";

interface HistoryPageProps {
  onSelectDocument?: (doc: DrawerDocument) => void;
}

export default function HistoryPage({ onSelectDocument }: HistoryPageProps) {
  const router = useRouter();
  const {
    loadConversation,
    activeConversationId,
    activeMessages,
    refreshConversations,
    activeDomainId,
    deleteConversation,
  } = useDomain();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(activeConversationId);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setConversations([]);
      setSelectedId(null);
      if (!activeDomainId) {
        setLoading(false);
        return;
      }
      const fetched = await refreshConversations();
      setConversations(fetched);
      // Auto-select and load the most recent conversation
      if (fetched.length > 0 && !activeConversationId) {
        const first = fetched[0];
        setSelectedId(first.id);
        loadConversation(first.id);
      } else if (activeConversationId) {
        setSelectedId(activeConversationId);
      }
      setLoading(false);
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDomainId]);

  const handleSelectConv = (id: string) => {
    setSelectedId(id);
    loadConversation(id);
  };

  const handleContinueConversation = () => {
    if (selectedId) loadConversation(selectedId);
    router.push("/chat");
  };

  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  if (!activeDomainId) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400 text-sm">
        No domain selected. Create a domain first.
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <HistoryView
        conversations={conversations}
        activeConversationId={selectedId}
        onSelectConversation={handleSelectConv}
        messages={activeMessages}
        onContinueConversation={handleContinueConversation}
        onSelectSource={onSelectDocument}
        onDeleteConversation={handleDeleteConversation}
        loading={loading}
      />
    </div>
  );
}
