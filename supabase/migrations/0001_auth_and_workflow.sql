-- Mahanaim E-Sign: auth, profiles, multi-recipient signing workflow.
-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- This drops the old single-signer `documents` table (fine: this project has
-- no real production documents signed yet). If you have real data you want to
-- keep, back it up first.

drop table if exists document_events;
drop table if exists document_recipients;
drop table if exists documents;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  is_admin boolean not null default false,
  saved_signature text,
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  file_name text not null,
  original_file_url text not null,
  current_file_url text not null,
  signing_mode text not null default 'parallel',
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

create table document_recipients (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid not null references profiles(id),
  role text not null,
  order_index int not null default 1,
  status text not null default 'pending',
  signed_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

create table document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  recipient_id uuid references document_recipients(id),
  event_type text not null,
  created_at timestamptz not null default now()
);

create index document_recipients_document_id_idx on document_recipients(document_id);
create index document_recipients_user_id_idx on document_recipients(user_id);
create index document_events_document_id_idx on document_events(document_id);

alter table profiles enable row level security;
alter table documents enable row level security;
alter table document_recipients enable row level security;
alter table document_events enable row level security;
-- No policies added on purpose: all access goes through Next.js API routes using
-- the service-role key (which bypasses RLS), keeping authorization logic in one
-- place instead of duplicated SQL policies.
