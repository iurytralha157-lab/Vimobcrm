-- Keep the onboarding, billing and transactional-delivery foreign keys cheap
-- to validate and join as these tables grow. Existing composite indexes cover
-- the organization-led access paths; these indexes cover the remaining FK
-- columns reported by the database advisor.

create index if not exists billing_payment_receipts_plan_id_idx
  on public.billing_payment_receipts(plan_id)
  where plan_id is not null;

create index if not exists email_delivery_events_email_log_id_idx
  on public.email_delivery_events(email_log_id)
  where email_log_id is not null;

create index if not exists email_delivery_events_organization_id_idx
  on public.email_delivery_events(organization_id)
  where organization_id is not null;

create index if not exists email_delivery_events_user_id_idx
  on public.email_delivery_events(user_id)
  where user_id is not null;

create index if not exists email_logs_template_id_idx
  on public.email_logs(template_id)
  where template_id is not null;

create index if not exists email_logs_user_id_idx
  on public.email_logs(user_id)
  where user_id is not null;

create index if not exists organizations_plan_id_idx
  on public.organizations(plan_id)
  where plan_id is not null;

create index if not exists organizations_pending_plan_id_idx
  on public.organizations(pending_plan_id)
  where pending_plan_id is not null;

create index if not exists billing_checkout_intents_pending_plan_id_idx
  on private.billing_checkout_intents(pending_plan_id)
  where pending_plan_id is not null;
