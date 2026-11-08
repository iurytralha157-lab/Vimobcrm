-- Additive preparation for the Go Agenda writer. Drain old create/comment
-- writers before sending traffic to the new writer. Keep existing entity IDs.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

alter table public.schedule_events add column client_request_id uuid;
alter table public.schedule_event_comments add column client_request_id uuid;

create unique index schedule_events_client_request_scope_uidx
  on public.schedule_events (organization_id, created_by, client_request_id)
  where client_request_id is not null;

create unique index schedule_event_comments_client_request_scope_uidx
  on public.schedule_event_comments (organization_id, user_id, client_request_id)
  where client_request_id is not null;

commit;
