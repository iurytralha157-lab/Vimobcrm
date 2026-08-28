begin;

-- The checkout-capability hardening migration immediately following this one
-- observes provider confirmation changes through this nullable field. Some
-- long-lived environments already had the column through pre-baseline drift,
-- while a clean database built from the canonical baseline did not.
alter table public.asaas_payments
  add column if not exists confirmed_date date;

comment on column public.asaas_payments.confirmed_date is
  'Provider-reported date on which the payment was confirmed.';

commit;
