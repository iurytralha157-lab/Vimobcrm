-- Align contracts used by the Go backend after switching Supabase projects.
-- The lead timeline needs actor_user_id for the unified lead history, while
-- audit logs store entity identifiers from several domains, not only UUIDs.

alter table if exists public.lead_timeline_events
  add column if not exists actor_user_id uuid references public.users(id) on delete set null;

update public.lead_timeline_events
set actor_user_id = user_id
where actor_user_id is null
  and user_id is not null;

create index if not exists idx_lead_timeline_events_actor_user
  on public.lead_timeline_events(actor_user_id);

alter table if exists public.audit_logs
  alter column entity_id type text using entity_id::text;
