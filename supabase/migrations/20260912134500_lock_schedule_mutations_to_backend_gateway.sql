-- Agenda reads and mutations are projected, authorized and audited by the Go
-- API. Raw browser access would bypass module/permission checks and the lead /
-- property masks applied per caller, so these operational tables are private
-- to the backend and trusted workers.
begin;

do $preflight$
declare
  missing_relation text;
  authenticated_role oid := (select oid from pg_catalog.pg_roles where rolname = 'authenticated');
begin
  select target.relation_name
    into missing_relation
  from unnest(array[
    'schedule_events',
    'schedule_event_assignees',
    'schedule_event_comments'
  ]::text[]) as target(relation_name)
  where to_regclass('public.' || target.relation_name) is null
  limit 1;

  if missing_relation is not null then
    raise exception using
      errcode = '42P01',
      message = 'schedule backend-only boundary preflight failed',
      detail = format('Missing relation public.%s', missing_relation),
      hint = 'Reconcile the Agenda schema prerequisites before this migration.';
  end if;

  if authenticated_role is null then
    raise exception using
      errcode = '42704',
      message = 'schedule backend-only boundary requires the authenticated role';
  end if;

  if to_regprocedure(
    'public.get_schedule_events_secure(uuid,uuid,timestamp with time zone,timestamp with time zone)'
  ) is null then
    raise exception using
      errcode = '42883',
      message = 'schedule backend-only boundary requires get_schedule_events_secure';
  end if;
end;
$preflight$;

alter table public.schedule_events enable row level security;
alter table public.schedule_event_assignees enable row level security;
alter table public.schedule_event_comments enable row level security;

-- REVOKE ALL also removes SELECT, TRUNCATE, REFERENCES and TRIGGER. Trusted
-- backend/Edge paths retain the only explicit table privileges.
revoke all privileges
  on table public.schedule_events,
           public.schedule_event_assignees,
           public.schedule_event_comments
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.schedule_events,
           public.schedule_event_assignees,
           public.schedule_event_comments
  to service_role;

-- Retire the legacy browser RPC too; its historical projection does not know
-- the current Agenda module, dedicated permissions or property access scope.
revoke all privileges
  on function public.get_schedule_events_secure(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute
  on function public.get_schedule_events_secure(uuid, uuid, timestamptz, timestamptz)
  to service_role;

-- Grants are the primary boundary. Remove every legacy browser policy as
-- defense in depth so a later broad grant cannot silently restore raw access.
do $drop_browser_policies$
declare
  browser_policy record;
begin
  for browser_policy in
    select policy.schemaname, policy.tablename, policy.policyname
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'schedule_events',
        'schedule_event_assignees',
        'schedule_event_comments'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      browser_policy.policyname,
      browser_policy.schemaname,
      browser_policy.tablename
    );
  end loop;
end;
$drop_browser_policies$;

comment on table public.schedule_events is
  'Agenda events: browser access is blocked; reads and mutations use the tenant-scoped Go API or trusted service workers.';
comment on table public.schedule_event_assignees is
  'Agenda participants: browser access is blocked; reads and mutations use the tenant-scoped Go API.';
comment on table public.schedule_event_comments is
  'Agenda comments: browser access is blocked; reads and mutations use the tenant-scoped Go API.';

do $postconditions$
declare
  target_relation text;
begin
  foreach target_relation in array array[
    'public.schedule_events',
    'public.schedule_event_assignees',
    'public.schedule_event_comments'
  ]::text[]
  loop
    if has_table_privilege('anon', target_relation, 'SELECT')
      or has_table_privilege('anon', target_relation, 'INSERT')
      or has_table_privilege('anon', target_relation, 'UPDATE')
      or has_table_privilege('anon', target_relation, 'DELETE')
      or has_table_privilege('authenticated', target_relation, 'SELECT')
      or has_table_privilege('authenticated', target_relation, 'INSERT')
      or has_table_privilege('authenticated', target_relation, 'UPDATE')
      or has_table_privilege('authenticated', target_relation, 'DELETE') then
      raise exception 'Browser table privilege survived on %', target_relation;
    end if;

    if not has_table_privilege('service_role', target_relation, 'SELECT')
      or not has_table_privilege('service_role', target_relation, 'INSERT')
      or not has_table_privilege('service_role', target_relation, 'UPDATE')
      or not has_table_privilege('service_role', target_relation, 'DELETE') then
      raise exception 'Trusted service privileges are incomplete on %', target_relation;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'schedule_events',
        'schedule_event_assignees',
        'schedule_event_comments'
      )
  ) then
    raise exception 'A browser policy survived the Agenda backend-only cutover';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.get_schedule_events_secure(uuid,uuid,timestamptz,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated execution survived on public.get_schedule_events_secure';
  end if;
end;
$postconditions$;

commit;
