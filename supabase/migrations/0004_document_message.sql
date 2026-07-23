-- Lets the uploader write an optional message to recipients when sending a document.
-- Run once in Supabase Dashboard -> SQL Editor.

alter table documents add column if not exists message text;
