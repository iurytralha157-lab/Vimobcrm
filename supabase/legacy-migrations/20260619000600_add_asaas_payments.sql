create table if not exists public.asaas_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asaas_payment_id text not null unique,
  asaas_subscription_id text,
  asaas_customer_id text,
  billing_type text,
  status text,
  value numeric(12,2),
  net_value numeric(12,2),
  due_date date,
  payment_date date,
  invoice_url text,
  raw_event jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_asaas_payments_organization_id
  on public.asaas_payments(organization_id);

create index if not exists idx_asaas_payments_status
  on public.asaas_payments(status);

drop trigger if exists set_updated_at_asaas_payments on public.asaas_payments;
create trigger set_updated_at_asaas_payments
before update on public.asaas_payments
for each row execute function private.set_updated_at();

alter table public.asaas_payments enable row level security;

revoke all on public.asaas_payments from anon, authenticated;
grant select on public.asaas_payments to authenticated;

drop policy if exists "members can read organization asaas payments" on public.asaas_payments;
create policy "members can read organization asaas payments"
on public.asaas_payments
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = asaas_payments.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
  )
);
