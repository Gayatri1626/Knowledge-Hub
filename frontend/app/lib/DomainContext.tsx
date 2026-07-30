"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import {
  listDomains,
  createDomain as apiCreateDomain,
  deleteDomain as apiDeleteDomain,
  listDocuments,
  listConversations,
  getMessages,
  uploadDocuments as apiUploadDocuments,
  deleteConversation as apiDeleteConversation,
  deleteDocument as apiDeleteDocument,
  type DocumentItem,
  type Conversation,
  type Message,
  type DomainItem,
} from "./api";

export interface Domain {
  id: string;
  name: string;
  description?: string;
  docCount: number;
  enabledCount: number;
  totalWords: number;
}

interface DomainContextType {
  domains: Domain[];
  domainsLoading: boolean;
  activeDomainId: string | null;
  activeDomain: Domain | null;
  setActiveDomainId: (id: string) => void;
  addDomain: (name: string, description?: string) => Promise<Domain>;
  deleteDomain: (id: string) => Promise<void>;
  isNewDomainModalOpen: boolean;
  setIsNewDomainModalOpen: (open: boolean) => void;
  documents: DocumentItem[];
  refreshDocuments: () => Promise<void>;
  uploadFilesToActiveDomain: (files: File[]) => Promise<DocumentItem[]>;
  deleteDocument: (id: string) => Promise<void>;

  // Conversation State
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  activeMessages: Message[];
  setActiveMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  loadConversation: (id: string) => Promise<void>;
  startNewChat: () => void;
  refreshConversations: () => Promise<Conversation[]>;
  deleteConversation: (id: string) => Promise<void>;
}

const DomainContext = createContext<DomainContextType | undefined>(undefined);

function mapDomain(d: DomainItem): Domain {
  return {
    id: d.id,
    name: d.name,
    description: d.description || undefined,
    docCount: d.doc_count || 0,
    enabledCount: d.enabled_count || d.doc_count || 0,
    totalWords: d.total_words || 0,
  };
}

export function DomainProvider({ children }: { children: React.ReactNode }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [activeDomainId, setActiveDomainId] = useState<string | null>(null);
  const [isNewDomainModalOpen, setIsNewDomainModalOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);

  // Conversation state
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<Message[]>([]);

  // ---------- Domain fetch ----------
  const fetchBackendDomains = async () => {
    setDomainsLoading(true);
    try {
      const fetched = await listDomains();
      const mapped = (fetched || []).map(mapDomain);
      setDomains(mapped);
      setActiveDomainId((prev) => {
        if (mapped.length === 0) return null;
        // Keep current if it still exists, otherwise pick first
        return mapped.find((d) => d.id === prev) ? prev : mapped[0].id;
      });
    } catch {
      // Backend unavailable — stay empty
      setDomains([]);
      setActiveDomainId(null);
    } finally {
      setDomainsLoading(false);
    }
  };

  // ---------- Document fetch ----------
  const refreshDocuments = async () => {
    if (!activeDomainId) {
      setDocuments([]);
      return;
    }
    try {
      const fetchedDocs = await listDocuments(activeDomainId);
      setDocuments(fetchedDocs || []);
    } catch {
      setDocuments([]);
    }
  };

  // ---------- Conversation fetch ----------
  const refreshConversations = async (): Promise<Conversation[]> => {
    if (!activeDomainId) return [];
    try {
      return (await listConversations(activeDomainId)) || [];
    } catch {
      return [];
    }
  };

  // ---------- Effects ----------
  // Load domains once on mount
  useEffect(() => {
    fetchBackendDomains();
  }, []);

  // Whenever active domain changes, refresh documents and reset chat state
  useEffect(() => {
    setDocuments([]);
    setActiveConversationId(null);
    setActiveMessages([]);
    if (activeDomainId) {
      refreshDocuments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDomainId]);

  // Live status while ingestion is running: as long as any document in the
  // active domain is still "processing" (chunking/embedding happens as a
  // background task server-side, so the upload response returns long before
  // that finishes), keep polling so the UI reflects "ready"/"failed" as soon
  // as the backend actually reaches that state, instead of only updating on
  // the next manual action.
  const hasProcessingDocs = documents.some((d) => d.status === "processing");
  useEffect(() => {
    if (!hasProcessingDocs) return;
    const interval = setInterval(() => {
      refreshDocuments();
    }, 2500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProcessingDocs, activeDomainId]);

  // ---------- Derived ----------
  const activeDomain: Domain | null =
    domains.find((d) => d.id === activeDomainId) ?? null;

  // ---------- Domain mutations ----------
  const addDomain = async (name: string, description?: string): Promise<Domain> => {
    const created = await apiCreateDomain(name, description);
    const newDomain = mapDomain(created);
    setDomains((prev) => [...prev, newDomain]);
    setActiveDomainId(newDomain.id);
    return newDomain;
  };

  const deleteDomain = async (id: string): Promise<void> => {
    await apiDeleteDomain(id);
    setDomains((prev) => {
      const remaining = prev.filter((d) => d.id !== id);
      setActiveDomainId(remaining.length > 0 ? remaining[0].id : null);
      return remaining;
    });
    if (activeConversationId) startNewChat();
  };

  // ---------- Document mutations ----------
  const uploadFilesToActiveDomain = async (files: File[]): Promise<DocumentItem[]> => {
    if (!activeDomainId) throw new Error("No active domain selected");
    const docs = await apiUploadDocuments(files, activeDomainId);
    await refreshDocuments();
    await fetchBackendDomains();
    return docs;
  };

  // Permanently deletes a document: removes the Postgres row and its Qdrant
  // chunks (handled server-side by DELETE /documents/{id}), so the document
  // can never be surfaced as retrieval context again.
  const deleteDocument = async (id: string): Promise<void> => {
    await apiDeleteDocument(id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    await fetchBackendDomains();
  };

  // ---------- Conversation actions ----------
  const loadConversation = async (id: string) => {
    setActiveConversationId(id);
    try {
      const msgs = await getMessages(id);
      setActiveMessages(msgs || []);
    } catch {
      setActiveMessages([]);
    }
  };

  const startNewChat = () => {
    setActiveConversationId(null);
    setActiveMessages([]);
  };

  // Deletes a conversation and all of its messages from the backend. If the
  // deleted conversation was the active one, clears it out of state too so no
  // stale/deleted transcript lingers in the UI.
  const deleteConversation = async (id: string): Promise<void> => {
    await apiDeleteConversation(id);
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setActiveMessages([]);
    }
  };

  return (
    <DomainContext.Provider
      value={{
        domains,
        domainsLoading,
        activeDomainId,
        activeDomain,
        setActiveDomainId,
        addDomain,
        deleteDomain,
        isNewDomainModalOpen,
        setIsNewDomainModalOpen,
        documents,
        refreshDocuments,
        uploadFilesToActiveDomain,
        deleteDocument,
        activeConversationId,
        setActiveConversationId,
        activeMessages,
        setActiveMessages,
        loadConversation,
        startNewChat,
        refreshConversations,
        deleteConversation,
      }}
    >
      {children}
    </DomainContext.Provider>
  );
}

export function useDomain() {
  const context = useContext(DomainContext);
  if (!context) {
    throw new Error("useDomain must be used within a DomainProvider");
  }
  return context;
}
