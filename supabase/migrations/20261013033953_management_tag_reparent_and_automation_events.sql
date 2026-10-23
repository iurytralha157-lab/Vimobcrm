-- Revalidate parent moves and publish automation tag associations atomically.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
do $preflight$
begin
  if pg_catalog.to_regprocedure('private.guard_management_tag_references()') is null
     or pg_catalog.to_regclass('private.realtime_events') is null
     or pg_catalog.to_regclass('public.automation_effect_dispatches') is null then
    raise exception 'management_tag_event_preflight_failed';
  end if;
end;
$preflight$;

create or replace function private.guard_management_tag_references()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  tenant_id uuid;
  old_tenant_id uuid;
  new_payload jsonb := to_jsonb(new);
  old_payload jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  new_ids uuid[];
  old_ids uuid[];
  tag_id uuid;
  flow_payload jsonb;
  version_id uuid;
begin
  tenant_id := private.safe_uuid(new_payload->>'organization_id');
  if tenant_id is null and tg_table_name = 'automation_nodes' then
    select organization_id into tenant_id from public.automations
    where id = private.safe_uuid(new_payload->>'automation_id');
  end if;
  old_tenant_id := private.safe_uuid(old_payload->>'organization_id');
  if old_tenant_id is null and tg_table_name = 'automation_nodes' and tg_op = 'UPDATE' then
    select organization_id into old_tenant_id from public.automations
    where id = private.safe_uuid(old_payload->>'automation_id');
  end if;
  new_ids := private.management_tag_configuration_ids(tg_table_name, new_payload);
  old_ids := private.management_tag_configuration_ids(tg_table_name, old_payload);
  -- Restoration or a tenant move must also revalidate dormant child records.
  if tg_op = 'UPDATE' and (old_tenant_id is distinct from tenant_id or
      (old_payload->>'deleted_at' is not null and new_payload->>'deleted_at' is null)) then
    if tg_table_name = 'round_robins' then
      select coalesce(array_agg(distinct tag), '{}'::uuid[]) into old_ids
      from public.round_robin_rules rule
      cross join lateral unnest(private.management_tag_configuration_ids('round_robin_rules', to_jsonb(rule))) tag
      where rule.round_robin_id = private.safe_uuid(new_payload->>'id');
      new_ids := new_ids || old_ids;
    elsif tg_table_name = 'automations' then
      select coalesce(array_agg(distinct tag), '{}'::uuid[]) into old_ids
      from public.automation_nodes node
      cross join lateral unnest(private.management_tag_configuration_ids('automation_nodes', to_jsonb(node))) tag
      where node.automation_id = private.safe_uuid(new_payload->>'id');
      new_ids := new_ids || old_ids;
    end if;
    old_ids := '{}'::uuid[];
  end if;
  -- Published and in-flight versions must be checked when they become usable,
  -- even if the tag was removed while that version was an inactive draft.
  if tg_table_name = 'automations' or
     (tg_table_name = 'automation_executions' and new_payload->>'status' in ('queued','running','waiting')) then
    version_id := private.safe_uuid(coalesce(new_payload->>'active_flow_version_id', new_payload->>'flow_version_id'));
    select to_jsonb(version) into flow_payload
    from public.automation_flow_versions version where id = version_id and organization_id = tenant_id;
    new_ids := new_ids || private.management_tag_configuration_ids('automation_flow_versions', flow_payload);
    if tg_op = 'UPDATE' and (tg_table_name = 'automations' or old_payload->>'status' in ('queued','running','waiting')) then
      version_id := private.safe_uuid(coalesce(old_payload->>'active_flow_version_id', old_payload->>'flow_version_id'));
      select to_jsonb(version) into flow_payload
      from public.automation_flow_versions version where id = version_id and organization_id = old_tenant_id;
      old_ids := old_ids || private.management_tag_configuration_ids('automation_flow_versions', flow_payload);
    end if;
  end if;
  -- Moving a configuration to another tenant requires validating every tag,
  -- even if its JSON reference set did not change.
  if old_tenant_id is distinct from tenant_id then old_ids := '{}'::uuid[]; end if;
  if tg_op = 'UPDATE' and (
    (tg_table_name in ('round_robins','automations') and old_payload->>'deleted_at' is not null and new_payload->>'deleted_at' is null)
    or (tg_table_name = 'automation_executions' and new_payload->>'status' in ('queued','running','waiting')
      and coalesce(old_payload->>'status', '') not in ('queued','running','waiting'))
  ) then old_ids := '{}'::uuid[]; end if;
  -- Unchanged IDs are not grandfathered across a same-tenant parent move.
  if tg_op = 'UPDATE' and (
    (tg_table_name in ('automation_nodes','automation_flow_versions','automation_executions')
      and old_payload->>'automation_id' is distinct from new_payload->>'automation_id')
    or (tg_table_name = 'round_robin_rules'
      and old_payload->>'round_robin_id' is distinct from new_payload->>'round_robin_id')
  ) then old_ids := '{}'::uuid[]; end if;
  for tag_id in select distinct id from unnest(new_ids) id where not id = any(old_ids) order by id loop
    perform id from public.tags where id = tag_id and organization_id = tenant_id for key share;
    if not found then
      raise exception 'A referenced tag is unavailable in this organization'
      using errcode = '23503', constraint = 'tags_management_reference_guard';
    end if;
  end loop;
  return new;
end
$function$;
revoke all on function private.guard_management_tag_references() from public, anon, authenticated;

create function private.publish_automation_tag_association()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  association jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_execution_id uuid := private.safe_uuid(nullif(current_setting('vimob.automation_execution_id', true), ''));
  v_tenant_id uuid := private.safe_uuid(association->>'organization_id');
  v_lead_id uuid := private.safe_uuid(association->>'lead_id');
  v_tag_id uuid := private.safe_uuid(association->>'tag_id');
  v_effect_type text := case when tg_op = 'DELETE' then 'remove_tag' else 'add_tag' end;
begin
  -- The canonical RPC locks the execution/lead and reserves its effect first.
  -- Derive scope from the association, never from a client event payload.
  if v_execution_id is not null and exists (
    select 1 from public.automation_executions execution
    join public.automation_effect_dispatches dispatch
      on dispatch.execution_id = execution.id and dispatch.organization_id = execution.organization_id
    where execution.id = v_execution_id and execution.organization_id = v_tenant_id
      and execution.lead_id = v_lead_id and execution.status = 'running'
      and execution.cancellation_requested_at is null
      and dispatch.node_key = execution.current_node_key and dispatch.status = 'sending'
      and dispatch.effect_type = v_effect_type
      and private.safe_uuid(dispatch.request->>'tag_id') = v_tag_id
  ) then
    insert into private.realtime_events (organization_id, user_id, audience_user_id, event_type, data)
    values (v_tenant_id, null, null,
      case when tg_op = 'DELETE' then 'lead.untagged' else 'lead.tagged' end,
      jsonb_build_object('leadId', v_lead_id, 'tagId', v_tag_id));
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function private.publish_automation_tag_association()
  from public, anon, authenticated, service_role;
create trigger publish_automation_tag_association
  after insert or delete on public.lead_tags
  for each row execute function private.publish_automation_tag_association();

-- Association and event share the RPC transaction; rollback removes both.
-- ON CONFLICT DO NOTHING / DELETE of an absent row produce no event.
-- Reversal: reviewed forward drop of this trigger/function and restoration of
-- the previous semantic guard. Already committed durable events remain history.
commit;
