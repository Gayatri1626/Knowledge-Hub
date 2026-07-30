# KnowledgeHub

A multi-domain, multi-document RAG assistant: organize documents into **domains** (isolated knowledge scopes), upload PDF/TXT/MD files into a domain, chat with them across multiple turns with the answer **streaming in live**, and get answers grounded in retrieved-and-reranked chunks with inline citations back to the source document and page. Deleting a domain, a document, or a conversation permanently removes all of its data, including vector embeddings — nothing is left orphaned.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + Tailwind |
| Backend | FastAPI |
| Deployment | Docker Compose only — no live/hosted deployment (no Render, no Vercel) |
| Orchestration | LangChain (loaders, splitter, embeddings/vectorstore wrappers, chat model wrapper) |
| Vector DB | Qdrant free Cloud cluster (hosted; the backend container just points at it — no local Qdrant container) |
| Relational DB | Supabase (hosted Postgres, free tier) |
| Embeddings | OpenAI (`text-embedding-3-small`, 1536-dim) |
| Reranking | Voyage AI (`rerank-2`) — kept as a separate provider from embeddings; see [Design decisions](#design-decisions) |
| Generation | Anthropic Claude (`claude-sonnet-5`, with a cheaper Haiku-tier model for query condensing) |

## Architecture

```
Next.js frontend  ──REST/JSON──▶  FastAPI backend  ──▶  Qdrant (vectors, one collection per embedding provider)
   (Route Handler proxy)                │
                                         ├──────────▶  Supabase Postgres
                                         │             (domains, documents, conversations, messages)
                                         │
                                         ├──────────▶  OpenAI API (embeddings)
                                         ├──────────▶  Voyage AI API (reranking only)
                                         └──────────▶  Anthropic API (chat + query condensing)
```

**Domains** are the top-level partition: every document, conversation, and (via its conversation) every message belongs to exactly one domain. The UI's sidebar lists domains; switching domains scopes everything else (documents tab, chat, history) to that domain's data only. Deleting a domain cascades: its documents, their vector chunks, its conversations, and their messages are all removed.

**Ingestion**: upload → validate extension/size → row inserted with `status=processing`, `domain_id` set → background task loads the file (`pypdf` for PDFs, keeping page numbers; plain read for txt/md) → `RecursiveCharacterTextSplitter` chunks it (1000 chars, 150 overlap) → chunks embedded via OpenAI and upserted into a Qdrant collection with `document_id`/`filename`/`chunk_index`/`page_number` metadata → row updated to `ready` (or `failed`, with the error message and any partially-embedded chunks cleaned back out of Qdrant). The frontend polls `GET /documents` for as long as any document in the active domain is still `processing`, so the UI shows live per-file status (Processing → Ready/Failed) rather than declaring success the moment the upload request returns — that response only means the file was queued, not that embedding finished.

**Chat**: a request carries `{conversation_id, message}`. The backend pulls the last 10 messages for that conversation from Postgres and, if there's history, makes one cheap Claude call to decide whether the new message is actually a *continuation* of the conversation (a pronoun or implicit reference) versus an unrelated topic switch — only in the former case does it rewrite the message into a standalone query folding in that context; a genuine topic switch is passed through unchanged, so asking about an unrelated document right after a different one doesn't bias retrieval toward the wrong document. That query is embedded and used to pull the top 12 candidate chunks from Qdrant (scoped to `status=ready` documents in the conversation's domain only), Voyage's cross-encoder reranks those 12 down to the best 5, and those 5 are numbered and handed to Claude along with the raw conversation history and the original question. Claude is instructed to cite every claim with bracketed numbers (`[1]`, `[2]`); the backend regexes the answer for which numbers were actually used and returns only those as structured citations (filename, page, snippet) — not every chunk that was retrieved.

**Streaming**: `POST /chat/stream` runs the identical condense → retrieve → rerank pipeline as `/chat`, but calls Claude with `.astream(...)` instead of `.invoke(...)` and emits Server-Sent-Events-style lines (`data: {...}\n\n`) as tokens arrive — `{"type": "token", "text": "..."}` per incremental piece, then one final `{"type": "done", "conversation_id": ..., "citations": [...]}` once generation finishes. Citation extraction needs the *complete* answer (it regexes for `[n]` markers), so it only happens after the last token, not per-chunk. The turn is persisted to Postgres inside the same generator, right after the last token and before the `done` event is sent — so by the time the frontend sees `done`, the message history is already durable. The frontend reads this via `fetch` + `ReadableStream` (not the browser `EventSource` API, which only supports `GET`) and appends each token to the in-progress assistant message live. The plain, non-streaming `/chat` endpoint is kept alongside it — both share the same condense/retrieve/rerank code (`_prepare_context` in `services/rag.py`), so there's one implementation of the retrieval pipeline, not two.

**Observability**: every stage of the pipeline logs structured, prefixed lines (`[upload]`, `[ingest]`, `[vectorstore]`/`[retrieve]`, `[rerank]`, `[rag]`, `[chat]`) so the full path from a file landing on disk to the chunks that ended up in a given answer is traceable straight from the backend console — including per-chunk retrieval **and** rerank relevance scores, which is what makes it possible to see the reranker actually reorder results relative to raw vector similarity.

## Domains

Domains are how this app supports multiple independent knowledge bases without separate deployments. A `Domain` (`id`, `name`, `description`) is a row in Postgres; `Document.domain_id` and `Conversation.domain_id` (and transitively every `Message`, via its conversation) scope everything else to one domain. Three domains are seeded on first-ever startup (`jordi-visser`, `tech-ai`, `company-policy`) — if you delete all of them, they stay deleted rather than reappearing.

Deleting a domain (`DELETE /domains/{id}`) is deliberately **not** a single bulk-delete relying on database cascade: it explicitly (1) looks up every document in the domain and calls `vectorstore.delete_by_document_id` for each one's Qdrant chunks, (2) explicitly deletes every message belonging to the domain's conversations, (3) deletes the conversations, (4) deletes the documents, (5) deletes the domain row. Step 2 matters because a bulk `delete()` SQL statement bypasses SQLAlchemy's ORM-level relationship cascade (`cascade="all, delete-orphan"` only fires on `session.delete()` against a loaded object), and SQLite (used locally/in tests) doesn't enforce `ON DELETE CASCADE` unless explicitly pragma'd on — so relying on the database alone silently left orphaned message rows behind in earlier testing. Deleting a single conversation (`DELETE /conversations/{id}`) does use `session.delete()` and does correctly cascade to its messages via the ORM relationship — the distinction is bulk vs. single-object deletion, not messages vs. other tables.

## Design decisions

- **Streaming reuses the same retrieval pipeline as the non-streaming endpoint, rather than duplicating it.** `services/rag.py` has one `_prepare_context()` function (condense → retrieve → rerank → build the message list) that both `run_rag` (used by `/chat`) and `stream_rag` (used by `/chat/stream`) call — only the final Claude call differs (`.invoke()` vs `.astream()`). This means the reranking/citation-grounding behavior can't silently drift between the two endpoints. Citations still can only be computed once the full answer text exists (extracting `[n]` markers needs the whole string), so `stream_rag` yields incremental `token` events for display and a single final `done` event carrying the citations — the client can't get per-token citations, and shouldn't need to.
- **Reranking uses a different provider than embeddings, on purpose.** Embeddings run through OpenAI (`text-embedding-3-small`); reranking stays on Voyage AI's `rerank-2` cross-encoder. This project started on Voyage for both, but Voyage's free tier (no payment method on file) caps requests at 3 RPM / 10K TPM, which a large document's hundreds of embedding *batches* hit hard during ingestion. Reranking is a single low-volume call per chat turn against a completely different endpoint, so it wasn't the bottleneck and stayed on Voyage rather than adding a second migration. Because OpenAI and Voyage embeddings live in incompatible vector spaces (and different dimensions), `config.py`'s `effective_qdrant_collection` routes OpenAI-embedded chunks into their own collection (`{qdrant_collection}_openai`) rather than ever writing mismatched-dimension vectors into a collection created under the other provider. The practical consequence: documents embedded before switching providers need to be deleted and re-uploaded to become searchable again — `backend/scripts/audit_document_vectors.py` finds any document that's marked `ready` in Postgres but has zero actual vectors in the current collection, which is exactly what a stale pre-switch document looks like.
- **Embedding calls retry through rate limits instead of failing the whole upload.** A single 429 partway through a multi-hundred-batch embedding job used to mark the entire document `failed`. `vectorstore.add_chunks` now catches rate-limit errors per batch and backs off 65s before retrying (up to 5 attempts), logging clearly that it's an account/tier limit rather than an application bug. If a document still fails after retries are exhausted, `ingestion.py` cleans up any chunks that did get embedded from earlier successful batches, so a `failed` document never leaves orphaned vectors behind.
- **Query condensing checks for a topic switch before rewriting.** The condense prompt doesn't unconditionally fold conversation history into the next query — it first asks the model to judge whether the follow-up is a genuine continuation (pronoun/implicit reference) or an unrelated new question, and only rewrites in the former case. Without this, a topic switch right after an unrelated exchange (e.g. asking about a different uploaded document) would get biased toward the prior topic's vocabulary, pushing retrieval toward the wrong document even though the new question had nothing to do with it.
- **Citations are extracted from the model's actual output, not from the retrieval set.** Claude sometimes won't use every chunk it's given; returning only the `[n]` markers that appear in the answer keeps citations honest instead of implying every retrieved-and-reranked chunk was relied on.
- **Query condensing (when it does rewrite) is a separate, cheaper model call** (Haiku-tier) rather than folding history into the retrieval embedding directly — cheap enough to run on every turn after the first.
- **New conversations are titled from the user's first message**, ChatGPT-style (trimmed to ~60 chars), rather than a generic "New conversation" or "Question for {domain}" placeholder.
- **Ingestion runs as a FastAPI `BackgroundTask`**, so upload returns immediately with `status=processing`; the frontend polls `GET /documents` while any document in the active domain is still processing, showing live per-file status rather than a premature "success" message.
- **Document/conversation/domain deletion always cleans up Qdrant explicitly**, never relying on the vector store to somehow know a row disappeared from Postgres — `vectorstore.delete_by_document_id` is called directly wherever a document (or a domain's documents) is removed.
- **Hand-rolled RAG orchestration, not a prebuilt LangChain chain.** LangChain is used for the loaders/splitter/embeddings/vectorstore/chat-model wrappers, but the condense → retrieve → rerank → generate → cite flow itself is plain Python in `services/rag.py`. Prebuilt chains make citation post-processing and prompt control harder than they're worth at this scope.
- **The frontend proxies `/api/*` through a Next.js Route Handler** (`app/api/[...path]/route.ts`), not `next.config.js` rewrites. Rewrites are baked into a build-time manifest, so a runtime `BACKEND_URL` env var never takes effect there. A Route Handler reads `process.env.BACKEND_URL` per-request, so the same built image works against any backend host.
- **Supabase is used purely as a relational store** (domains/documents/conversations/messages), accessed as a plain Postgres connection string via SQLAlchemy — it is not containerized, since it's already a managed hosted service. `backend/app/db/schema.sql` is the canonical DDL to run once in the Supabase SQL editor; it's written to be safely re-runnable on a database that predates domains (adds the `domains` table, backfills `domain_id` on existing rows, then locks in `not null` + foreign keys). `init_models()` also runs `create_all` as a safety net on startup for local/test SQLite.
- **Docker Compose over a hosted deployment.** The backend and frontend run as two containers from one `docker compose up`; Supabase (relational) and Qdrant Cloud (vectors) both stay external as managed services rather than being containerized. This keeps the setup to "clone, fill in `.env`, run one command" instead of wiring up separate hosting accounts for the frontend and backend, while still not asking either data store to live in a disposable local container — Postgres and vector data shouldn't disappear on `docker compose down -v`.
- **Deferred bonuses**: auth and a CI pipeline were left out to keep the core requirements solid first (both streaming and reranking, unlike in earlier drafts of this project, are now implemented — see the Stack table above).

## Project layout

```
backend/
  app/
    main.py                       # FastAPI app, CORS, error handlers, lifespan (init_models, seed domains)
    config.py                     # pydantic Settings (env vars) incl. effective_qdrant_collection/embedding_dim
    db/
      models.py                   # Domain, Document, Conversation, Message (SQLAlchemy)
      session.py
      schema.sql                  # canonical Supabase DDL — safe to re-run, includes domains migration
    api/
      domains.py                  # CRUD + cascading delete (docs, vectors, conversations, messages)
      documents.py                 # upload, list, delete (deletes Qdrant chunks too)
      conversations.py             # create/list/rename/delete, message history
      chat.py                      # /chat and /chat/stream (SSE) - orchestrates history, domain scoping
    services/
      ingestion.py                 # load/split a file into chunks, drive the embed step, status transitions
      embeddings.py                # OpenAI embeddings client
      vectorstore.py               # Qdrant client, add/delete/similarity_search, rate-limit retry/backoff
      rag.py                       # shared condense/retrieve/rerank prep; run_rag (invoke) + stream_rag (astream)
      rerank.py                    # Voyage AI rerank-2 REST call, with graceful fallback to vector order
    schemas.py                     # Pydantic request/response models
  scripts/
    audit_document_vectors.py     # finds "ready" documents with zero vectors in the current collection
  tests/                           # pytest, mocks Anthropic/Voyage/OpenAI/Qdrant — no live network calls
frontend/
  app/
    documents/page.tsx             # document list + delete (no more "enabled" toggle - it did nothing)
    upload/page.tsx                # dropzone + live per-file Processing/Ready/Failed status
    chat/page.tsx                  # chat window, streams the answer live, auto-titles from the first message
    history/page.tsx               # past conversations + delete (cascades to messages)
    api/[...path]/route.ts         # runtime proxy to the backend - passes the SSE stream body through untouched
    lib/
      DomainContext.tsx            # domain/document/conversation state, polls GET /documents while processing
      api.ts                      # typed fetch client; streamChatMessage() reads /chat/stream via ReadableStream
    components/                    # Sidebar, FileUploader, DocumentList, ChatWindow, MessageBubble,
                                    # HistoryView, NewDomainModal, DocumentDrawer, ...
docker-compose.yml                 # backend + frontend (Supabase and Qdrant Cloud both stay external) - the deployment path
```

## Setup

Docker Compose is the one way this app runs — there's no separate hosted-deployment path (Render/Vercel) to configure. The frontend and backend run as local containers; Supabase (Postgres) and Qdrant Cloud (vectors) are both managed services the backend container just points at over the network — neither one runs in a container here. Supabase and Qdrant Cloud both have a free tier; OpenAI embeddings are billed from the first token (no meaningful free tier); Voyage's rerank calls are low-volume enough that its free tier (3 RPM / 10K TPM without a payment method) is normally fine.

### 1. Managed services

- **Supabase**: create a free project at [supabase.com](https://supabase.com), then run `backend/app/db/schema.sql` once in its SQL editor. Grab the Postgres connection string (Project Settings → Database → Connection string → URI) and rewrite its scheme to `postgresql+asyncpg://`.
- **Qdrant Cloud**: create a free cluster at [cloud.qdrant.io](https://cloud.qdrant.io). Note the cluster URL (`https://xxxxxxxx.<region>.<provider>.cloud.qdrant.io:6333`) and its API key. There's no local Qdrant container — the backend always talks to this cluster, so document vectors persist across `docker compose down`/`up` without needing a Docker volume for them.
- **Anthropic**: get a key at [console.anthropic.com](https://console.anthropic.com).
- **OpenAI**: get a key at [platform.openai.com](https://platform.openai.com/api-keys). This is the embeddings provider — requires billing set up, unlike the other keys here.
- **Voyage AI**: get a key at [dash.voyageai.com](https://dash.voyageai.com). Only used for reranking now, one call per chat turn, so the free tier's 3 RPM / 10K TPM cap is rarely an issue in normal use.

### 2. Run it with Docker Compose

```bash
cp backend/.env.example backend/.env
# fill in ANTHROPIC_API_KEY, OPENAI_API_KEY, VOYAGE_API_KEY, DATABASE_URL,
# QDRANT_URL, QDRANT_API_KEY in backend/.env
# for running the backend directly, without Docker (see below) - Docker Compose
# itself reads these from your shell environment via ${VAR} substitution in
# docker-compose.yml, so export them too before bringing the stack up:

export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
export VOYAGE_API_KEY=...
export DATABASE_URL=postgresql+asyncpg://...
export QDRANT_URL=https://xxxxxxxx.<region>.<provider>.cloud.qdrant.io:6333
export QDRANT_API_KEY=...
docker compose up --build
```

On Windows PowerShell, set the equivalent `$env:` variables in the same session instead of `export`, and use single quotes around any value that contains a `$` (a Supabase password often does):

```powershell
$env:ANTHROPIC_API_KEY = '...'
$env:OPENAI_API_KEY = '...'
$env:VOYAGE_API_KEY = '...'
$env:DATABASE_URL = 'postgresql+asyncpg://...'
$env:QDRANT_URL = 'https://xxxxxxxx.<region>.<provider>.cloud.qdrant.io:6333'
$env:QDRANT_API_KEY = '...'
docker compose up --build
```

**Don't** use `docker compose --env-file backend/.env` as a shortcut for this: Compose's env-file parser expands bare `$VAR` references inside the file's own values, so a password containing a literal `$` (e.g. `6_!+$jN5rxrNSWF`) gets silently truncated at the `$` before it ever reaches the container. Setting real shell/session environment variables (`export` or `$env:`) doesn't have this problem — Compose only interpolates `${VAR}` inside `docker-compose.yml` itself, once, and never re-scans the value it just substituted in.

Run `docker compose config` first if you want to double check the substitution worked — the printed `DATABASE_URL`/`QDRANT_URL` should be complete, with no "variable is not set" warnings above it.

- Frontend: http://localhost:3000
- Backend docs: http://localhost:8000/docs

This builds and runs the backend and frontend as two local containers; both Postgres (Supabase) and the vector store (Qdrant Cloud) stay external, so there's nothing to persist in a local Docker volume.

### 3. Try it

1. Open the app, pick or create a **domain** from the sidebar.
2. Go to **Documents** (or **Upload**), drop in a PDF/TXT/MD file, watch it go Processing → Ready live.
3. Go to **Chat**, ask a question about the document — the answer streams in live, token by token, and the conversation is auto-titled from your first message.
4. Ask a pronoun follow-up ("what about its pricing?") to see multi-turn memory in action, and try an unrelated follow-up right after to see that a genuine topic switch doesn't drag in the wrong context.
5. Click a citation chip under an assistant reply to expand the source snippet.
6. Try deleting a document, a conversation, and (if you're done testing it) a domain — each permanently removes its data, including vector chunks.

### Running the backend without Docker

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1        # or source .venv/bin/activate on macOS/Linux
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

`.env` is only read at process startup — editing it while `uvicorn --reload` is running won't take effect until you fully stop and restart the process, since `--reload` only watches Python source files, not `.env`.

## Tests

```bash
cd backend
pytest
```

Covers: chunking behavior, upload validation, document lifecycle (processing → ready/failed) and delete (with Qdrant cleanup), domain CRUD and cascading delete (documents, conversations, **and** messages — the case that used to leave orphans behind), conversation delete and its message cascade, chat citation extraction, conversation history persistence, and the `/chat/stream` SSE endpoint (token/done event framing, citation extraction on the accumulated answer, and message persistence) — all with Anthropic/OpenAI/Voyage/Qdrant calls mocked out, so the suite runs with no network access and no real credentials.

## Troubleshooting

- **A document is stuck "processing" or shows as `ready` but never gets cited.** Run `docker compose exec backend python scripts/audit_document_vectors.py --domain <domain_id>` (or, without Docker, `python scripts/audit_document_vectors.py --domain <domain_id>` from `backend/` with the venv active) to check whether it actually has vectors in the currently-active Qdrant collection. A `ready` document with zero vectors most often means it was embedded under a provider/collection this app no longer uses (e.g. before switching to OpenAI) — delete and re-upload it.
- **Embedding calls are failing with a rate-limit error.** Check whether it's OpenAI (embeddings) or Voyage (reranking) in the error, and whether billing/payment is set up for that provider — the backend logs retries clearly as `[vectorstore] batch N/M hit an embedding provider rate limit`.
- **Backend won't start after a dependency change.** With Docker, `docker compose up --build` rebuilds the image from the updated `requirements.txt` automatically. Without Docker, re-run `python -m pip install -r requirements.txt` inside the activated venv, then fully restart `uvicorn` (not just let `--reload` pick it up).
- **Backend crash-loops on startup with `OSError: [Errno 101] Network is unreachable`** (during `init_models()`/`create_async_engine`). This means `DATABASE_URL` is using Supabase's *direct* connection host (`db.<project-ref>.supabase.co`), which is IPv6-only on the free tier — Docker Desktop containers typically have no IPv6 route out, so the connection can't even be attempted, let alone succeed. Switch to Supabase's Session-mode connection pooler instead (Supabase dashboard → Project Settings → Database → Connection pooling → Session mode, port `5432`): it's IPv4-compatible and works from Docker. The pooler's username also changes format, to `postgres.<project-ref>` instead of plain `postgres` — copy the whole connection string from the dashboard rather than hand-editing the direct one. Use Session mode, not Transaction mode (port `6543`) — transaction pooling disables prepared statements, which `asyncpg` needs by default.
- **`docker compose config` shows `$$` in a value that should have a single `$`** (e.g. in a Supabase password). This is expected — `config`'s printed output escapes literal `$` as `$$` so it stays valid, re-parsable Compose syntax; the actual value delivered to the container is the original single `$`. Only worry if you instead see the value truncated right at the `$` (missing everything after it) — that means it was mangled by `docker compose --env-file`'s own variable expansion (see the warning in the setup section above about not using `--env-file` with secrets containing `$`).

## Bonus features (not implemented in this pass)

- Auth
- CI pipeline

Deferred to keep the core requirements solid first. Streaming and reranking (previously in this list) are both implemented now — see [Chat](#architecture) above and `POST /chat/stream`.
