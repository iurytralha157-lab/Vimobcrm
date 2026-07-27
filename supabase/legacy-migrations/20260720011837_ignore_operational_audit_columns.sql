begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.write_audit_log_for_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  row_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  row_diff jsonb := '{}'::jsonb;
  excluded_columns text[] := array['updated_at'];
  target_organization_id uuid;
  target_entity_id text;
  actor_user_id uuid;
  audit_action text;
  audit_entity_type text := coalesce(nullif(tg_argv[0], ''), tg_table_name);
  arg_index integer;
begin
  if tg_nargs > 1 then
    for arg_index in 1..(tg_nargs - 1) loop
      excluded_columns := excluded_columns || tg_argv[arg_index];
    end loop;
  end if;

  if tg_op = 'UPDATE' then
    row_diff := private.audit_jsonb_diff(row_old, row_new, excluded_columns);
    if row_diff = '{}'::jsonb then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    row_diff := private.audit_jsonb_diff('{}'::jsonb, row_new, excluded_columns);
  elsif tg_op = 'DELETE' then
    row_diff := private.audit_jsonb_diff(row_old, '{}'::jsonb, excluded_columns);
  end if;

  target_organization_id := coalesce(
    private.safe_uuid(row_new ->> 'organization_id'),
    private.safe_uuid(row_old ->> 'organization_id')
  );
  target_entity_id := coalesce(row_new ->> 'id', row_old ->> 'id');
  actor_user_id := coalesce(
    private.current_audit_actor_id(),
    private.safe_uuid(row_new ->> 'created_by'),
    private.safe_uuid(row_old ->> 'created_by')
  );

  audit_action := case tg_op
    when 'INSERT' then 'create'
    when 'UPDATE' then 'update'
    when 'DELETE' then 'delete'
    else lower(tg_op)
  end;

  insert into public.audit_logs (
    organization_id,
    user_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    diff,
    source,
    metadata
  )
  values (
    target_organization_id,
    actor_user_id,
    audit_action,
    audit_entity_type,
    target_entity_id,
    case when tg_op in ('UPDATE', 'DELETE') then row_old else null end,
    case when tg_op in ('INSERT', 'UPDATE') then row_new else null end,
    row_diff,
    'database_trigger',
    jsonb_build_object(
      'schema', tg_table_schema,
      'table', tg_table_name,
      'operation', tg_op
    )
  );

  return null;
end;
$$;

revoke all on function private.write_audit_log_for_row() from public, anon, authenticated;
grant execute on function private.write_audit_log_for_row() to service_role;

drop trigger if exists audit_round_robins_changes on public.round_robins;
create trigger audit_round_robins_changes
after insert or update or delete on public.round_robins
for each row execute function private.write_audit_log_for_row('distribution_queue', 'current_position');

drop trigger if exists audit_round_robin_members_changes on public.round_robin_members;
create trigger audit_round_robin_members_changes
after insert or update or delete on public.round_robin_members
for each row execute function private.write_audit_log_for_row('distribution_queue_member', 'leads_count');

commit;
