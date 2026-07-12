-- The application switches the selected sender inside a short transaction, while
-- this partial unique index remains the final concurrency guard at database level.
create unique index if not exists whatsapp_sessions_one_notification_sender_per_org_idx
  on public.whatsapp_sessions (organization_id)
  where is_notification_session = true;

comment on index public.whatsapp_sessions_one_notification_sender_per_org_idx is
  'Allows at most one WhatsApp notification sender per organization.';
