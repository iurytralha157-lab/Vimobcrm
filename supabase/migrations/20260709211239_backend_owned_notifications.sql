-- Notification delivery is backend-owned.
-- The database may store notifications/outbox state, but must not call Edge
-- Functions, WhatsApp, push, e-mail or other external services by trigger.

drop trigger if exists trigger_push_on_notification_insert on public.notifications;
drop trigger if exists notify_push_on_notification_insert on public.notifications;
drop trigger if exists trigger_send_push_notification on public.notifications;
drop trigger if exists send_push_notification_on_insert on public.notifications;

drop trigger if exists trigger_notify_new_lead on public.leads;
drop trigger if exists notify_new_lead on public.leads;
drop trigger if exists trigger_notify_lead_assigned on public.leads;
drop trigger if exists notify_lead_assigned on public.leads;
drop trigger if exists trigger_notify_stage_change on public.leads;
drop trigger if exists notify_stage_change on public.leads;

comment on table public.notifications is
  'In-app notification and backend-owned delivery outbox. External delivery is performed only by the Go API notification dispatcher.';

comment on column public.notifications.metadata is
  'Notification metadata. Backend dispatcher uses metadata.dispatch.{whatsapp,push,email} for per-channel delivery state.';

create index if not exists idx_notifications_dispatch_pending
  on public.notifications (created_at)
  where metadata ? 'dispatch'
     or lower(coalesce(metadata->>'whatsapp_dispatch_required', 'false')) in ('true', '1', 'yes');

update public.notifications
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{dispatch,whatsapp}',
  jsonb_build_object(
    'required', true,
    'status', coalesce(metadata->'whatsapp_dispatch'->>'status', 'pending'),
    'attempts', coalesce(nullif(metadata->'whatsapp_dispatch'->>'attempts', '')::int, 0)
  ),
  true
)
where lower(coalesce(metadata->>'whatsapp_dispatch_required', 'false')) in ('true', '1', 'yes')
  and not coalesce(((coalesce(metadata, '{}'::jsonb) #> '{dispatch,whatsapp}') ? 'required'), false);
