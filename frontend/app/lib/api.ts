export interface DomainItem {
  id: string;
  name: string;
  description: string | null;
  doc_count: number;
  enabled_count: number;
  total_words: number;
  created_at: string;
}

export interface DocumentItem {
  id: string;
  domain_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: "processing" | "ready" | "failed";
  chunk_count: number;
  error: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  domain_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  n: number;
  document_id: string;
  filename: string;
  page_number: number | null;
  snippet: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  created_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      // response had no JSON body
    }
    throw new Error(detail);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export async function listDomains(): Promise<DomainItem[]> {
  const data = await request<{ domains: DomainItem[] }>("/domains");
  return data.domains;
}

export async function createDomain(name: string, description?: string): Promise<DomainItem> {
  return request<DomainItem>("/domains", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteDomain(domainId: string): Promise<void> {
  await request<void>(`/domains/${domainId}`, { method: "DELETE" });
}

export async function uploadDocuments(
  files: File[],
  domainId: string = "jordi-visser"
): Promise<DocumentItem[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  formData.append("domain_id", domainId);

  const data = await request<{ documents: DocumentItem[] }>("/documents", {
    method: "POST",
    body: formData,
  });
  return data.documents;
}

export async function listDocuments(domainId?: string): Promise<DocumentItem[]> {
  const query = domainId ? `?domain_id=${encodeURIComponent(domainId)}` : "";
  const data = await request<{ documents: DocumentItem[] }>(`/documents${query}`);
  return data.documents;
}

export async function deleteDocument(id: string): Promise<void> {
  await request<void>(`/documents/${id}`, { method: "DELETE" });
}

export async function createConversation(
  title?: string,
  domainId: string = "jordi-visser"
): Promise<Conversation> {
  return request<Conversation>("/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, domain_id: domainId }),
  });
}

export async function listConversations(domainId?: string): Promise<Conversation[]> {
  const query = domainId ? `?domain_id=${encodeURIComponent(domainId)}` : "";
  const data = await request<{ conversations: Conversation[] }>(`/conversations${query}`);
  return data.conversations;
}

export async function updateConversation(id: string, title: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await request<void>(`/conversations/${id}`, { method: "DELETE" });
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const data = await request<{ messages: Message[] }>(`/conversations/${conversationId}/messages`);
  return data.messages;
}

export interface ChatResponse {
  conversation_id: string;
  answer: string;
  citations: Citation[];
}

export async function sendChatMessage(
  conversationId: string,
  message: string
): Promise<ChatResponse> {
  return request<ChatResponse>("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, message }),
  });
}

export interface ChatStreamHandlers {
  onToken?: (text: string) => void;
  onDone?: (payload: { conversation_id: string; citations: Citation[] }) => void;
}

// Consumes the backend's Server-Sent-Events-style stream from /chat/stream: a
// sequence of `data: {...}\n\n` lines, each either an incremental `{"type":
// "token", "text": "..."}` piece of the answer, or the final `{"type": "done",
// ...}` carrying the citations extracted from the complete answer. Uses fetch's
// ReadableStream directly (not EventSource, which only supports GET) since this
// is a POST request.
export async function streamChatMessage(
  conversationId: string,
  message: string,
  handlers: ChatStreamHandlers
): Promise<void> {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, message }),
  });

  if (!response.ok || !response.body) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      // no JSON body
    }
    throw new Error(detail || "Failed to start chat stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Events are separated by a blank line ("\n\n"); everything after the last
    // one is a partial event still waiting on more bytes, so keep it buffered.
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;
      const payload = JSON.parse(line.slice("data: ".length));

      if (payload.type === "token" && handlers.onToken) {
        handlers.onToken(payload.text);
      } else if (payload.type === "done" && handlers.onDone) {
        handlers.onDone({ conversation_id: payload.conversation_id, citations: payload.citations });
      } else if (payload.type === "error") {
        throw new Error(payload.detail || "Failed to generate an answer");
      }
    }
  }
}
