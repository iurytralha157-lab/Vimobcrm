-- JSON field mappings, webhook payloads, flow variables and labels are opaque.
-- Read tag references only where each configuration producer consumes them.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.management_tag_value_ids(payload jsonb)
returns uuid[] language sql immutable set search_path = '' as $function$
  with ids as (
    select distinct private.safe_uuid(btrim(item.value #>> '{}')) id
    from jsonb_array_elements(case jsonb_typeof(payload)
      when 'array' then payload when 'string' then jsonb_build_array(payload) else '[]'::jsonb end) item
    where jsonb_typeof(item.value) = 'string'
  )
  select coalesce(array_agg(id order by id) filter (where id is not null), '{}'::uuid[]) from ids;
$function$;
revoke all on function private.management_tag_value_ids(jsonb) from public, anon, authenticated;

-- Meta's legacy default_values reader also accepts a JSON-encoded string array
-- (apps/api/internal/meta/repository.go:stringSlice). Do not recurse into it.
create or replace function private.management_meta_default_tag_ids(payload jsonb)
returns uuid[] language plpgsql immutable set search_path = '' as $function$
declare values_payload jsonb := payload;
begin
  if jsonb_typeof(values_payload) = 'string' then
    begin
      values_payload := (values_payload #>> '{}')::jsonb;
    exception when invalid_text_representation then return '{}'::uuid[];
    end;
  end if;
  if jsonb_typeof(values_payload) is distinct from 'array' then return '{}'::uuid[]; end if;
  return private.management_tag_value_ids(values_payload);
end
$function$;
revoke all on function private.management_meta_default_tag_ids(jsonb) from public, anon, authenticated;

create or replace function private.management_automation_graph_tag_ids(graph jsonb)
returns uuid[] language sql immutable set search_path = '' as $function$
  with nodes as (
    select item.value node from jsonb_array_elements(case when jsonb_typeof(graph->'nodes') = 'array'
      then graph->'nodes' else '[]'::jsonb end) item
  ), references_to_tags as (
    select unnest(private.management_tag_value_ids(node->'config'->'tag_id')) id
    from nodes where node->>'type' = 'trigger' or
      (node->>'type' = 'action' and node->>'action_type' in ('add_tag','remove_tag'))
    union
    -- Older visual drafts use ReactFlow tag nodes; published Go graphs above
    -- use action nodes with the same tag_id in their config.
    select unnest(private.management_tag_value_ids(node->'data'->'tag_id')) id
    from nodes where node->>'type' = 'tag'
  )
  select coalesce(array_agg(distinct id order by id), '{}'::uuid[]) from references_to_tags;
$function$;
revoke all on function private.management_automation_graph_tag_ids(jsonb) from public, anon, authenticated;

create or replace function private.management_tag_configuration_ids(table_name text, payload jsonb)
returns uuid[] language sql immutable set search_path = '' as $function$
  with references_to_tags as (
    select unnest(case table_name
      when 'round_robin_rules' then case when lower(coalesce(nullif(payload->>'match_type',''),
        payload->'conditions'->>'match_type',payload->>'name','')) = 'tag'
        then private.management_tag_value_ids(to_jsonb(string_to_array(coalesce(nullif(payload->>'match_value',''),
          payload->'conditions'->>'match_value',''),','))) else '{}'::uuid[] end
      when 'round_robins' then private.management_tag_value_ids(payload->'settings'->'auto_tag_ids')
      when 'webhooks_integrations' then private.management_tag_value_ids(payload->'target_tag_ids')
      when 'meta_form_configs' then private.management_tag_value_ids(payload->'auto_tags') ||
        private.management_meta_default_tag_ids(payload->'default_values'->'auto_tags')
      when 'automation_nodes' then case when payload->>'node_type' = 'trigger' or
        (payload->>'node_type' = 'action' and payload->>'action_type' in ('add_tag','remove_tag'))
        then private.management_tag_value_ids(payload->'node_config'->'tag_id') else '{}'::uuid[] end
      when 'automations' then private.management_automation_graph_tag_ids(payload->'flow_definition') ||
        case when payload->>'trigger_type' = 'tag_added' then
          private.management_tag_value_ids(payload->'trigger_config'->'tag_id') else '{}'::uuid[] end
      when 'automation_flow_versions' then private.management_automation_graph_tag_ids(payload->'graph') ||
        case when payload->>'trigger_type' = 'tag_added' then
          private.management_tag_value_ids(payload->'trigger_config'->'tag_id') else '{}'::uuid[] end
      -- Stage actions currently support assignee/status/alerts, not tags.
      -- Execution runtime data is also opaque; its pinned flow is read below.
      else '{}'::uuid[] end) id
  )
  select coalesce(array_agg(distinct id order by id), '{}'::uuid[]) from references_to_tags;
$function$;
revoke all on function private.management_tag_configuration_ids(text, jsonb) from public, anon, authenticated;

create or replace function private.management_tag_usages(uuid, uuid)
returns table(kind text, count bigint)
language sql volatile security definer set search_path = ''
as $function$

  with references_to_tag as (
    select 'distribution_rule'::text kind, rule.id::text id
    from public.round_robin_rules rule
    join public.round_robins queue on queue.id = rule.round_robin_id and queue.organization_id = $1
    where rule.organization_id = $1 and queue.deleted_at is null
      and $2 = any(private.management_tag_configuration_ids('round_robin_rules', to_jsonb(rule)))
    union
    select 'distribution_auto_tags', queue.id::text from public.round_robins queue
    where queue.organization_id = $1 and queue.deleted_at is null
      and $2 = any(private.management_tag_configuration_ids('round_robins', to_jsonb(queue)))
    union
    select 'automation', automation.id::text from public.automations automation
    where automation.organization_id = $1 and automation.deleted_at is null and (
      $2 = any(private.management_tag_configuration_ids('automations', to_jsonb(automation)))
      or exists (select 1 from public.automation_nodes node where node.automation_id = automation.id
        and $2 = any(private.management_tag_configuration_ids('automation_nodes', to_jsonb(node))))
      or exists (select 1 from public.automation_flow_versions version
        where version.id = automation.active_flow_version_id and version.organization_id = $1
          and $2 = any(private.management_tag_configuration_ids('automation_flow_versions', to_jsonb(version))))
    )
    union
    select 'automation_execution', execution.id::text from public.automation_executions execution
    join public.automation_flow_versions version on version.id = execution.flow_version_id
      and version.organization_id = execution.organization_id
    where execution.organization_id = $1 and execution.status in ('queued','running','waiting')
      and $2 = any(private.management_tag_configuration_ids('automation_flow_versions', to_jsonb(version)))
    union
    select 'stage_automation', automation.id::text from public.stage_automations automation
    where automation.organization_id = $1
      and $2 = any(private.management_tag_configuration_ids('stage_automations', to_jsonb(automation)))
    union
    select 'meta_form', form.id::text from public.meta_form_configs form
    where form.organization_id = $1
      and $2 = any(private.management_tag_configuration_ids('meta_form_configs', to_jsonb(form)))
    union
    select 'webhook', webhook.id::text from public.webhooks_integrations webhook
    where webhook.organization_id = $1
      and $2 = any(private.management_tag_configuration_ids('webhooks_integrations', to_jsonb(webhook)))
  )
  select kind, count(distinct id)::bigint from references_to_tag group by kind order by kind

$function$;
revoke all on function private.management_tag_usages(uuid, uuid) from public, anon, authenticated;
grant execute on function private.management_tag_usages(uuid, uuid) to service_role;

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

commit;
