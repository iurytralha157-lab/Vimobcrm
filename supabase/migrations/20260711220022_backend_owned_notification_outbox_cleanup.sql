-- Notifications must be backend-owned:
-- lead/schedule writes enqueue notification rows only; external delivery is
-- performed by the Go notification dispatcher worker.

drop trigger if exists notify_push_on_notification_insert on public.notifications;
drop trigger if exists trigger_send_push_notification on public.notifications;
drop trigger if exists send_push_notification_on_insert on public.notifications;

drop trigger if exists trigger_notify_new_lead on public.leads;
drop trigger if exists notify_new_lead on public.leads;
drop trigger if exists trigger_notify_lead_assigned on public.leads;
drop trigger if exists notify_lead_assigned on public.leads;
drop trigger if exists trigger_notify_stage_change on public.leads;
drop trigger if exists notify_stage_change on public.leads;
drop trigger if exists trg_notify_neximob_lancamentos_webhook_lead on public.leads;

-- Legacy visual automation triggers called Edge Functions from inside lead
-- writes. If lead-created/stage automations are reintroduced, they must use
-- an outbox/worker path instead of database HTTP calls.
drop trigger if exists tr_visual_automation_lead_created on public.leads;
drop trigger if exists tr_visual_automation_stage_change on public.leads;

drop function if exists public.notify_new_lead();
drop function if exists public.notify_lead_assigned();
drop function if exists public.notify_stage_change();
drop function if exists public.notify_neximob_lancamentos_webhook_lead();
drop function if exists public.trigger_push_notification();
drop function if exists public.trigger_visual_automations_on_lead_created();
drop function if exists public.trigger_visual_automations_on_stage_change();

create unique index if not exists notifications_unique_dedupe_key
  on public.notifications (
    organization_id,
    user_id,
    ((metadata ->> 'dedupe_key'))
  )
  where nullif(metadata ->> 'dedupe_key', '') is not null;

create index if not exists idx_notifications_dispatch_pending_created_at
  on public.notifications (created_at)
  where created_at >= '2026-01-01'::timestamptz
    and (
      lower(coalesce(metadata->'dispatch'->'whatsapp'->>'required', metadata->>'whatsapp_dispatch_required', 'false')) in ('true', '1', 'yes')
      or lower(coalesce(metadata->'dispatch'->'push'->>'required', 'false')) in ('true', '1', 'yes')
      or lower(coalesce(metadata->'dispatch'->'email'->>'required', 'false')) in ('true', '1', 'yes')
    );

comment on table public.notifications is
  'In-app notifications and backend-owned delivery outbox. External delivery must be performed by the Go API notification dispatcher.';
