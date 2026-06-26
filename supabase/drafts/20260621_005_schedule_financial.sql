-- Vimob CRM - DRAFT ONLY - Schedule, financial, contracts, commissions and DRE
-- Do not run before review.
-- Pages covered:
--   /agenda
--   /financeiro
--   /financeiro/contas
--   /financeiro/contratos
--   /financeiro/contratos/[id]
--   /financeiro/comissoes
--   /financeiro/corretor
--   /financeiro/dre
--
-- Security principle:
--   Agenda can be visible to organization members, but private events only to participants/admins.
--   Financial data is restricted to financial managers, owners/admins and the broker's own commissions.

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  title text not null,
  description text,
  event_type text not null default 'task',
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_all_day boolean not null default false,
  location text,
  status text not null default 'scheduled',
  visibility text not null default 'default',
  reminder_minutes integer,
  recurrence_parent_id uuid references public.schedule_events(id) on delete cascade,
  recurrence_rule text,
  recurrence_until timestamptz,
  recurrence_count integer,
  google_event_id text,
  completed_by uuid references public.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_events_type_check check (event_type in ('call', 'email', 'meeting', 'task', 'message', 'visit')),
  constraint schedule_events_status_check check (status in ('scheduled', 'completed', 'cancelled', 'canceled', 'no_show')),
  constraint schedule_events_visibility_check check (visibility in ('default', 'public', 'private')),
  constraint schedule_events_time_check check (end_time >= start_time)
);

create table if not exists public.schedule_event_assignees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.schedule_events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint schedule_event_assignees_unique unique (event_id, user_id)
);

create table if not exists public.schedule_event_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.schedule_events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null,
  category_group text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_categories_type_check check (type in ('income', 'expense')),
  constraint financial_categories_unique unique (organization_id, name, type)
);

create table if not exists public.contract_sequences (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_number text,
  contract_type text,
  status text not null default 'draft',
  property_id uuid references public.properties(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  value numeric(14,2),
  commission_percentage numeric(7,4),
  commission_value numeric(14,2),
  client_name text,
  client_email text,
  client_phone text,
  client_document text,
  down_payment numeric(14,2),
  installments integer,
  payment_conditions text,
  start_date date,
  end_date date,
  signing_date date,
  closing_date date,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_unique_number unique (organization_id, contract_number),
  constraint contracts_status_check check (status in ('draft', 'pending', 'active', 'signed', 'completed', 'cancelled', 'canceled')),
  constraint contracts_value_non_negative check (value is null or value >= 0)
);

create table if not exists public.contract_brokers (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  commission_percentage numeric(7,4) not null default 0,
  commission_value numeric(14,2),
  role text,
  created_at timestamptz not null default now(),
  constraint contract_brokers_unique unique (contract_id, user_id)
);

create table if not exists public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null,
  category text,
  category_group text,
  contract_id uuid references public.contracts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  broker_id uuid references public.users(id) on delete set null,
  description text,
  amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  paid_value numeric(14,2) not null default 0,
  due_date date,
  paid_date date,
  payment_method text,
  status text not null default 'pending',
  notes text,
  created_by uuid references public.users(id) on delete set null,
  installment_number integer,
  total_installments integer,
  is_recurring boolean not null default false,
  recurring_type text,
  parent_entry_id uuid references public.financial_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_entries_type_check check (type in ('payable', 'receivable')),
  constraint financial_entries_status_check check (status in ('pending', 'partial', 'paid', 'overdue', 'cancelled', 'canceled')),
  constraint financial_entries_amount_non_negative check (amount >= 0),
  constraint financial_entries_recurring_type_check check (recurring_type is null or recurring_type in ('monthly', 'weekly', 'yearly'))
);

create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  business_type text not null default 'all',
  commission_type text not null default 'percentage',
  commission_value numeric(14,4) not null default 0,
  percentage numeric(7,4) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_rules_business_type_check check (business_type in ('sale', 'rental', 'service', 'all')),
  constraint commission_rules_type_check check (commission_type in ('percentage', 'fixed'))
);

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  rule_id uuid references public.commission_rules(id) on delete set null,
  amount numeric(14,2),
  base_value numeric(14,2) not null default 0,
  percentage numeric(7,4),
  calculated_value numeric(14,2) not null default 0,
  status text not null default 'forecast',
  forecast_date date,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references public.users(id) on delete set null,
  payment_proof text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commissions_status_check check (status in ('forecast', 'pending', 'approved', 'paid', 'cancelled', 'canceled', 'prevista', 'pendente', 'aprovada', 'paga'))
);

create table if not exists public.dre_account_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  group_type text not null,
  display_order integer not null default 0,
  parent_id uuid references public.dre_account_groups(id) on delete cascade,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  constraint dre_account_groups_type_check check (group_type in ('revenue', 'deduction', 'cost', 'expense', 'financial_expense', 'financial_revenue', 'tax'))
);

create table if not exists public.dre_account_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_id uuid not null references public.dre_account_groups(id) on delete cascade,
  category text not null,
  entry_type text not null,
  created_at timestamptz not null default now(),
  constraint dre_account_mappings_entry_type_check check (entry_type in ('payable', 'receivable')),
  constraint dre_account_mappings_unique unique (organization_id, category, entry_type)
);

create index if not exists idx_schedule_events_org_time on public.schedule_events(organization_id, start_time, end_time);
create index if not exists idx_schedule_events_user_time on public.schedule_events(user_id, start_time, end_time);
create index if not exists idx_schedule_assignees_event on public.schedule_event_assignees(event_id);
create index if not exists idx_schedule_comments_event on public.schedule_event_comments(event_id, created_at);
create index if not exists idx_financial_entries_org_due on public.financial_entries(organization_id, due_date, status);
create index if not exists idx_financial_entries_contract on public.financial_entries(contract_id);
create index if not exists idx_contracts_org_status on public.contracts(organization_id, status);
create index if not exists idx_contract_brokers_user on public.contract_brokers(user_id);
create index if not exists idx_commissions_org_user on public.commissions(organization_id, user_id, status);
create index if not exists idx_dre_groups_org_order on public.dre_account_groups(organization_id, display_order);
create index if not exists idx_dre_mappings_org_category on public.dre_account_mappings(organization_id, category, entry_type);

drop trigger if exists set_updated_at_schedule_events on public.schedule_events;
create trigger set_updated_at_schedule_events before update on public.schedule_events for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at_financial_categories on public.financial_categories;
create trigger set_updated_at_financial_categories before update on public.financial_categories for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at_contracts on public.contracts;
create trigger set_updated_at_contracts before update on public.contracts for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at_financial_entries on public.financial_entries;
create trigger set_updated_at_financial_entries before update on public.financial_entries for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at_commission_rules on public.commission_rules;
create trigger set_updated_at_commission_rules before update on public.commission_rules for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at_commissions on public.commissions;
create trigger set_updated_at_commissions before update on public.commissions for each row execute function private.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array[
    'schedule_events', 'schedule_event_assignees', 'schedule_event_comments',
    'financial_categories', 'contract_sequences', 'contracts', 'contract_brokers',
    'financial_entries', 'commission_rules', 'commissions',
    'dre_account_groups', 'dre_account_mappings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists "schedule members read visible events" on public.schedule_events;
create policy "schedule members read visible events"
on public.schedule_events
for select
to authenticated
using (
  private.is_org_member(organization_id)
  and (
    visibility <> 'private'
    or user_id = auth.uid()
    or private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
    or exists (
      select 1
      from public.schedule_event_assignees sea
      where sea.event_id = schedule_events.id
        and sea.user_id = auth.uid()
    )
  )
);

drop policy if exists "schedule participants manage events" on public.schedule_events;
create policy "schedule participants manage events"
on public.schedule_events
for all
to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  or user_id = auth.uid()
)
with check (
  private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  or user_id = auth.uid()
);

drop policy if exists "schedule members read assignees" on public.schedule_event_assignees;
create policy "schedule members read assignees"
on public.schedule_event_assignees
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists "schedule owners manage assignees" on public.schedule_event_assignees;
create policy "schedule owners manage assignees"
on public.schedule_event_assignees
for all
to authenticated
using (
  exists (
    select 1
    from public.schedule_events se
    where se.id = schedule_event_assignees.event_id
      and (
        se.user_id = auth.uid()
        or private.has_org_role(se.organization_id, array['owner', 'admin', 'manager'])
      )
  )
)
with check (
  exists (
    select 1
    from public.schedule_events se
    where se.id = schedule_event_assignees.event_id
      and (
        se.user_id = auth.uid()
        or private.has_org_role(se.organization_id, array['owner', 'admin', 'manager'])
      )
  )
);

drop policy if exists "schedule members read comments" on public.schedule_event_comments;
create policy "schedule members read comments"
on public.schedule_event_comments
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists "schedule members create comments" on public.schedule_event_comments;
create policy "schedule members create comments"
on public.schedule_event_comments
for insert
to authenticated
with check (private.is_org_member(organization_id) and user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array[
    'financial_categories', 'contract_sequences', 'contracts',
    'financial_entries', 'commission_rules', 'dre_account_groups', 'dre_account_mappings'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'financial admins read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'financial admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.has_permission(organization_id, ''financial_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'financial admins read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_permission(organization_id, ''financial_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin''])) with check (private.has_permission(organization_id, ''financial_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'financial admins manage ' || t, t);
  end loop;
end $$;

drop policy if exists "brokers read own contracts" on public.contracts;
create policy "brokers read own contracts"
on public.contracts
for select
to authenticated
using (
  exists (
    select 1
    from public.contract_brokers cb
    where cb.contract_id = contracts.id
      and cb.user_id = auth.uid()
  )
);

drop policy if exists "financial admins read contract brokers" on public.contract_brokers;
create policy "financial admins read contract brokers"
on public.contract_brokers
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.contracts c
    where c.id = contract_brokers.contract_id
      and (
        private.has_permission(c.organization_id, 'financial_manage')
        or private.has_org_role(c.organization_id, array['owner', 'admin'])
      )
  )
);

drop policy if exists "financial admins manage contract brokers" on public.contract_brokers;
create policy "financial admins manage contract brokers"
on public.contract_brokers
for all
to authenticated
using (
  exists (
    select 1
    from public.contracts c
    where c.id = contract_brokers.contract_id
      and (
        private.has_permission(c.organization_id, 'financial_manage')
        or private.has_org_role(c.organization_id, array['owner', 'admin'])
      )
  )
)
with check (
  exists (
    select 1
    from public.contracts c
    where c.id = contract_brokers.contract_id
      and (
        private.has_permission(c.organization_id, 'financial_manage')
        or private.has_org_role(c.organization_id, array['owner', 'admin'])
      )
  )
);

drop policy if exists "brokers read own commissions" on public.commissions;
create policy "brokers read own commissions"
on public.commissions
for select
to authenticated
using (
  user_id = auth.uid()
  or private.has_permission(organization_id, 'financial_manage')
  or private.has_org_role(organization_id, array['owner', 'admin'])
);

drop policy if exists "financial admins manage commissions" on public.commissions;
create policy "financial admins manage commissions"
on public.commissions
for all
to authenticated
using (private.has_permission(organization_id, 'financial_manage') or private.has_org_role(organization_id, array['owner', 'admin']))
with check (private.has_permission(organization_id, 'financial_manage') or private.has_org_role(organization_id, array['owner', 'admin']));

create or replace function private.get_schedule_events_secure_impl(
  p_user_id uuid default null,
  p_lead_id uuid default null,
  p_start_time timestamptz default null,
  p_end_time timestamptz default null
)
returns table (
  id uuid,
  organization_id uuid,
  user_id uuid,
  lead_id uuid,
  property_id uuid,
  title text,
  description text,
  event_type text,
  start_time timestamptz,
  end_time timestamptz,
  is_all_day boolean,
  location text,
  status text,
  visibility text,
  reminder_minutes integer,
  recurrence_parent_id uuid,
  recurrence_rule text,
  recurrence_until timestamptz,
  recurrence_count integer,
  google_event_id text,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  user_name text,
  user_avatar_url text,
  lead_name text,
  lead_phone text,
  property_title text,
  property_code text,
  completed_by_user_name text,
  assignee_user_ids uuid[],
  is_masked boolean
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with current_memberships as (
    select om.organization_id, om.role
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.is_active = true
  ),
  base as (
    select
      se.*,
      array_remove(array_agg(distinct sea.user_id), null) as assignees,
      bool_or(se.user_id = auth.uid() or sea.user_id = auth.uid()) as is_participant,
      bool_or(cm.role in ('owner', 'admin', 'manager')) as is_manager
    from public.schedule_events se
    join current_memberships cm on cm.organization_id = se.organization_id
    left join public.schedule_event_assignees sea on sea.event_id = se.id
    where (p_user_id is null or se.user_id = p_user_id or sea.user_id = p_user_id)
      and (p_lead_id is null or se.lead_id = p_lead_id)
      and (p_start_time is null or se.end_time >= p_start_time)
      and (p_end_time is null or se.start_time <= p_end_time)
    group by se.id
  )
  select
    b.id,
    b.organization_id,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else b.user_id end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else b.lead_id end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else b.property_id end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then 'Horario ocupado' else b.title end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then 'Informacao privada' else b.description end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then 'task' else b.event_type end,
    b.start_time,
    b.end_time,
    b.is_all_day,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else b.location end,
    b.status,
    b.visibility,
    b.reminder_minutes,
    b.recurrence_parent_id,
    b.recurrence_rule,
    b.recurrence_until,
    b.recurrence_count,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else b.google_event_id end,
    b.completed_by,
    b.completed_at,
    b.created_at,
    b.updated_at,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else u.name end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else u.avatar_url end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else l.name end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else l.phone end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else p.title end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else p.code end,
    cbu.name,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then array[]::uuid[] else b.assignees end,
    (b.visibility = 'public' and not b.is_participant and not b.is_manager)
  from base b
  left join public.users u on u.id = b.user_id
  left join public.leads l on l.id = b.lead_id
  left join public.properties p on p.id = b.property_id
  left join public.users cbu on cbu.id = b.completed_by
  where b.visibility <> 'private' or b.is_participant or b.is_manager;
$$;

create or replace function public.get_schedule_events_secure(
  p_user_id uuid default null,
  p_lead_id uuid default null,
  p_start_time timestamptz default null,
  p_end_time timestamptz default null
)
returns table (
  id uuid,
  organization_id uuid,
  user_id uuid,
  lead_id uuid,
  property_id uuid,
  title text,
  description text,
  event_type text,
  start_time timestamptz,
  end_time timestamptz,
  is_all_day boolean,
  location text,
  status text,
  visibility text,
  reminder_minutes integer,
  recurrence_parent_id uuid,
  recurrence_rule text,
  recurrence_until timestamptz,
  recurrence_count integer,
  google_event_id text,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  user_name text,
  user_avatar_url text,
  lead_name text,
  lead_phone text,
  property_title text,
  property_code text,
  completed_by_user_name text,
  assignee_user_ids uuid[],
  is_masked boolean
)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select * from private.get_schedule_events_secure_impl(p_user_id, p_lead_id, p_start_time, p_end_time);
$$;

grant execute on function public.get_schedule_events_secure(uuid, uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.copy_default_dre_groups(org_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if not (private.has_permission(org_id, 'financial_manage') or private.has_org_role(org_id, array['owner', 'admin'])) then
    raise exception 'Sem permissao para configurar DRE';
  end if;

  insert into public.dre_account_groups (organization_id, name, group_type, display_order, is_system)
  values
    (org_id, 'Receita operacional bruta', 'revenue', 10, true),
    (org_id, 'Deducoes da receita', 'deduction', 20, true),
    (org_id, 'Custos operacionais', 'cost', 30, true),
    (org_id, 'Despesas operacionais', 'expense', 40, true),
    (org_id, 'Despesas financeiras', 'financial_expense', 50, true),
    (org_id, 'Receitas financeiras', 'financial_revenue', 60, true),
    (org_id, 'Impostos sobre lucro', 'tax', 70, true)
  on conflict do nothing;
end;
$$;

grant execute on function public.copy_default_dre_groups(uuid) to authenticated;
