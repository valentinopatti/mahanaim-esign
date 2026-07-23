-- Adds: per-recipient view timestamp, and support for multiple signature
-- placements (different pages) per recipient in one document.
-- Run once in Supabase Dashboard -> SQL Editor.

alter table document_recipients add column if not exists viewed_at timestamptz;

create table if not exists document_signatures (
  id uuid primary key default gen_random_uuid(),
  document_recipient_id uuid not null references document_recipients(id) on delete cascade,
  page_number int not null,
  percent_x numeric not null,
  percent_y numeric not null,
  percent_width numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists document_signatures_recipient_id_idx on document_signatures(document_recipient_id);

alter table document_signatures enable row level security;
-- No policies added, same as other tables: access goes through API routes using the service-role key.
