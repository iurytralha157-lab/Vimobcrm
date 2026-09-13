-- Pipeline, lead and pipeline-configuration mutations are validated by the
-- authenticated Go API. The
-- browser still needs tenant-filtered reads, including the SELECT privilege
-- required by authenticated Realtime subscriptions, but it must not be able
-- to bypass API permission checks with direct Data API writes.
--
-- REVOKE ALL is intentional: besides INSERT/UPDATE/DELETE it removes TRUNCATE,
-- which bypasses RLS entirely, plus REFERENCES and TRIGGER from client roles.
-- Backend roles are not revoked and service_role is granted the operational
-- privileges explicitly for installations with opt-in Data API grants.
alter table public.pipelines enable row level security;
alter table public.stages enable row level security;
alter table public.leads enable row level security;
alter table public.stage_automations enable row level security;
alter table public.stage_operational_configs enable row level security;
alter table public.pipeline_sla_settings enable row level security;

revoke all privileges
  on table public.pipelines,
           public.stages,
           public.leads,
           public.stage_automations,
           public.stage_operational_configs,
           public.pipeline_sla_settings
  from public, anon, authenticated;

grant select
  on table public.pipelines,
           public.stages,
           public.leads,
           public.stage_automations,
           public.stage_operational_configs,
           public.pipeline_sla_settings
  to authenticated;

grant select, insert, update, delete
  on table public.pipelines,
           public.stages,
           public.leads,
           public.stage_automations,
           public.stage_operational_configs,
           public.pipeline_sla_settings
  to service_role;

-- Remove legacy permissive write policies as defense in depth. Grants are the
-- primary Data API boundary, but leaving a write policy behind would silently
-- reopen the bypass if a future migration restored a client DML grant.
do $migration$
declare
  mutation_policy record;
begin
  for mutation_policy in
    select policy.schemaname, policy.tablename, policy.policyname
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'pipelines',
        'stages',
        'leads',
        'stage_automations',
        'stage_operational_configs',
        'pipeline_sla_settings'
      )
      and policy.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      mutation_policy.policyname,
      mutation_policy.schemaname,
      mutation_policy.tablename
    );
  end loop;
end
$migration$;

-- Cover additional SECURITY DEFINER functions beyond the compatibility names
-- above. PostgreSQL does not expose reliable relation dependencies for dynamic
-- PL/pgSQL statements, so inspect function definitions but combine that signal
-- with catalog-level SECURITY DEFINER, return type and effective privilege
-- checks. Trigger functions are excluded: they cannot be invoked as RPCs and
-- their EXECUTE privilege does not control trigger firing.
do $migration$
declare
  exposed_mutation_rpc record;
begin
  for exposed_mutation_rpc in
    select procedure.oid::regprocedure as signature
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    cross join lateral (
      select lower(pg_get_functiondef(procedure.oid)) as definition
    ) source
    where namespace.nspname = 'public'
      and procedure.prokind = 'f'
      and procedure.prosecdef = true
      and procedure.prorettype <> 'trigger'::regtype
      and (
        source.definition like '%leads%'
        or source.definition like '%pipelines%'
        or source.definition like '%stages%'
        or source.definition like '%stage_automations%'
        or source.definition like '%stage_operational_configs%'
        or source.definition like '%pipeline_sla_settings%'
      )
      and source.definition ~ '(insert[[:space:]]+into|update[[:space:]]|delete[[:space:]]+from|truncate[[:space:]])'
      and (
        has_function_privilege('anon', procedure.oid, 'execute')
        or has_function_privilege('authenticated', procedure.oid, 'execute')
      )
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      exposed_mutation_rpc.signature
    );
  end loop;
end
$migration$;

-- Reassert the common live-membership invariant as a restrictive read policy.
-- Existing permissive SELECT policies continue to define which pipeline or
-- lead rows an active member may see; this policy only adds the shared gate.
drop policy if exists vimob_active_membership_guard on public.pipelines;
create policy vimob_active_membership_guard
on public.pipelines
as restrictive
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists vimob_active_membership_guard on public.stages;
create policy vimob_active_membership_guard
on public.stages
as restrictive
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists vimob_active_membership_guard on public.leads;
create policy vimob_active_membership_guard
on public.leads
as restrictive
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists vimob_active_membership_guard on public.stage_automations;
create policy vimob_active_membership_guard
on public.stage_automations
as restrictive
for select
to authenticated
using (
  private.is_org_member(
    coalesce(
      organization_id,
      (select stage.organization_id from public.stages stage where stage.id = stage_id)
    )
  )
);

drop policy if exists vimob_active_membership_guard on public.stage_operational_configs;
create policy vimob_active_membership_guard
on public.stage_operational_configs
as restrictive
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists vimob_active_membership_guard on public.pipeline_sla_settings;
create policy vimob_active_membership_guard
on public.pipeline_sla_settings
as restrictive
for select
to authenticated
using (
  private.is_org_member(
    coalesce(
      organization_id,
      (select pipeline.organization_id from public.pipelines pipeline where pipeline.id = pipeline_id)
    )
  )
);

-- A restrictive policy can only narrow a permissive one. Abort safely if an
-- installation has drifted and no authenticated/public permissive SELECT
-- policy remains, instead of deploying a configuration that returns no rows.
do $migration$
declare
  missing_policy_table text;
  authenticated_role oid := (select oid from pg_roles where rolname = 'authenticated');
begin
  select target.table_name
  into missing_policy_table
  from unnest(array[
    'pipelines',
    'stages',
    'leads',
    'stage_automations',
    'stage_operational_configs',
    'pipeline_sla_settings'
  ]) as target(table_name)
  where not exists (
    select 1
    from pg_policy policy
    join pg_class relation on relation.oid = policy.polrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = target.table_name
      and policy.polpermissive = true
      and policy.polcmd in ('r', '*')
      and (
        0::oid = any(policy.polroles)
        or authenticated_role = any(policy.polroles)
      )
  )
  limit 1;

  if missing_policy_table is not null then
    raise exception using
      errcode = '55000',
      message = 'pipeline_gateway_missing_permissive_select_policy',
      detail = format(
        'public.%s needs a permissive SELECT policy for authenticated reads',
        missing_policy_table
      );
  end if;
end
$migration$;

-- These legacy RPCs mutate the same aggregate. Keep them unavailable to Data
-- API client roles so table-grant hardening cannot be bypassed through an old
-- SECURITY DEFINER entrypoint. Trigger functions are deliberately not matched.
do $migration$
declare
  mutation_rpc record;
begin
  for mutation_rpc in
    select procedure.oid::regprocedure as signature
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'create_default_stages_for_pipeline',
        'distribute_lead_from_backend',
        'handle_lead_intake',
        'handle_managed_whatsapp_message_lead',
        'handle_routed_lead_intake',
        'move_lead_stage',
        'redistribute_lead_from_pool',
        'redistribute_lead_round_robin',
        'register_lead_reentry',
        'reorder_stages',
        'transfer_lead_assignee',
        'upsert_whatsapp_webhook_lead'
      )
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      mutation_rpc.signature
    );
  end loop;
end
$migration$;
