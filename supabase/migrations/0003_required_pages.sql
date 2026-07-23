-- Lets the document owner require a signer to sign on specific page(s).
-- The signer still freely chooses exact position/size on those pages (per user
-- decision: only the page is locked, not x/y). Run once in Supabase SQL Editor.

create table if not exists document_required_pages (
  id uuid primary key default gen_random_uuid(),
  document_recipient_id uuid not null references document_recipients(id) on delete cascade,
  page_number int not null,
  fulfilled boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists document_required_pages_recipient_id_idx on document_required_pages(document_recipient_id);

alter table document_required_pages enable row level security;
-- No policies added, same as other tables: access goes through API routes using the service-role key.
