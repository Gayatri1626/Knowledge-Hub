-- KnowledgeHub schema — run once in the Supabase SQL editor before first use.
-- Mirrors app/db/models.py (SQLAlchemy is used at runtime; this is the canonical
-- DDL for the hosted Supabase Postgres instance).
--
-- IDs are `text`, not `uuid`: the app always supplies its own client-generated
-- uuid4 string at insert time (see app/db/models.py's `_uuid()` default), and
-- SQLAlchemy binds it as a plain string. A native `uuid` column type rejects
-- that with "column is of type uuid but expression is of type character
-- varying" — caught by testing this schema against a real Supabase database.
--
-- This file is safe to re-run on a database that already has documents/
-- conversations/messages tables from before domains existed: the `alter table
-- ... add column if not exists` + backfill + `set not null` block below brings
-- an old table up to the current shape without touching existing rows' data
-- (they're all assigned to the 'jordi-visser' domain, matching the app's
-- historical default).

create extension if not exists "pgcrypto";

-- Domains are the top-level partition every document, conversation, and (via
-- conversations) message belongs to. Created first so documents/conversations
-- can reference it, and seeded before any domain_id backfill runs below.
create table if not exists domains (
    id           text primary key,
    name         text not null,
    description  text,
    created_at   timestamptz not null default now()
);

insert into domains (id, name, description) values
    ('jordi-visser', 'Jordi Visser', 'Macro economy, AI market developments, physical bottlenecks, and technology research.'),
    ('tech-ai', 'Tech & AI Research', 'LLMs, RAG architectures, neural networks, and AI hardware specifications.'),
    ('company-policy', 'Company Policies & HR', 'Employee guidelines, standard operating procedures, and administrative protocols.')
on conflict (id) do nothing;

create table if not exists documents (
    id            text primary key default gen_random_uuid()::text,
    domain_id     text not null default 'jordi-visser',
    filename      text not null,
    content_type  text not null,
    size_bytes    integer not null,
    status        text not null default 'processing'
                    check (status in ('processing', 'ready', 'failed')),
    chunk_count   integer not null default 0,
    error         text,
    created_at    timestamptz not null default now()
);

create table if not exists conversations (
    id          text primary key default gen_random_uuid()::text,
    domain_id   text not null default 'jordi-visser',
    title       text not null default 'New conversation',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists messages (
    id               text primary key default gen_random_uuid()::text,
    conversation_id  text not null references conversations(id) on delete cascade,
    role             text not null check (role in ('user', 'assistant')),
    content          text not null,
    citations        jsonb,
    created_at       timestamptz not null default now()
);

-- Migration for tables that pre-date domains: add the column if missing,
-- backfill existing rows to 'jordi-visser' (every document/conversation ever
-- created before this migration used that domain by default), then lock in
-- not-null + a FK back to domains so every document and every conversation
-- (and, through it, every message in its history) is always attributed to a
-- real domain.
alter table documents add column if not exists domain_id text;
update documents set domain_id = 'jordi-visser' where domain_id is null;
alter table documents alter column domain_id set default 'jordi-visser';
alter table documents alter column domain_id set not null;
alter table documents drop constraint if exists documents_domain_id_fkey;
alter table documents
    add constraint documents_domain_id_fkey
    foreign key (domain_id) references domains(id) on delete cascade;

alter table conversations add column if not exists domain_id text;
update conversations set domain_id = 'jordi-visser' where domain_id is null;
alter table conversations alter column domain_id set default 'jordi-visser';
alter table conversations alter column domain_id set not null;
alter table conversations drop constraint if exists conversations_domain_id_fkey;
alter table conversations
    add constraint conversations_domain_id_fkey
    foreign key (domain_id) references domains(id) on delete cascade;

create index if not exists idx_messages_conversation_id on messages(conversation_id);
create index if not exists idx_documents_status on documents(status);
create index if not exists idx_documents_domain_id on documents(domain_id);
create index if not exists idx_conversations_domain_id on conversations(domain_id);
