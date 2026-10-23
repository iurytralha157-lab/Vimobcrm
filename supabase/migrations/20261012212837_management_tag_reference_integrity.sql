-- Configuration references have no relational FK when stored in JSON. Keep
-- deletion and reference creation serialized without locking unrelated tenants.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.management_tag_reference_ids(payload jsonb)
returns uuid[] language sql immutable set search_path = '' as $function$

  with recursive nodes(value) as (
    select coalesce(payload, '{}'::jsonb)
    union all
    select child.value from nodes node cross join lateral (
      select item.value from jsonb_each(case when jsonb_typeof(node.value) = 'object' then node.value else '{}'::jsonb end) item
      union all
      select item.value from jsonb_array_elements(case when jsonb_typeof(node.value) = 'array' then node.value else '[]'::jsonb end) item
    ) child
  ), candidates(value) as (
    -- Legacy rule columns and conditions may each contain half of the matcher.
    -- Read them together using the same fallback as the distribution selector.
    select entry from nodes node
    cross join lateral unnest(string_to_array(coalesce(nullif(node.value->>'match_value', ''),
      node.value->'conditions'->>'match_value', ''), ',')) entry
    where node.value ? 'round_robin_id' and lower(coalesce(nullif(node.value->>'match_type', ''),
      node.value->'conditions'->>'match_type', node.value->>'name', '')) = 'tag'
    union all
    select reference.value #>> '{}' from nodes node
    cross join lateral jsonb_each(case when jsonb_typeof(node.value) = 'object' then node.value else '{}'::jsonb end) field
    cross join lateral jsonb_path_query(field.value, '$.** ? (@.type() == "string")') reference(value)
    where lower(replace(field.key, '_', '')) in ('tag', 'tags', 'tagid', 'tagids', 'autotags', 'autotagids', 'targettagids')
    union all
    select entry from nodes node
    cross join lateral unnest(string_to_array(coalesce(node.value->>'match_value', node.value->>'matchValue', ''), ',')) entry
    where lower(coalesce(nullif(node.value->>'match_type', ''), node.value->>'matchType',
      case when node.value ? 'round_robin_id' then node.value->>'name' end, '')) = 'tag'
    union all
    select reference.value #>> '{}' from nodes node
    cross join lateral jsonb_path_query(coalesce(node.value->'values', '[]'::jsonb), '$.** ? (@.type() == "string")') reference(value)
    where lower(coalesce(node.value->>'type', '')) = 'tag'
  ), ids as (
    select distinct private.safe_uuid(btrim(value)) id from candidates
  )
  select coalesce(array_agg(id order by id) filter (where id is not null), '{}'::uuid[]) from ids;

$function$;
revoke all on function private.management_tag_reference_ids(jsonb) from public, anon, authenticated;

create or replace function private.management_tag_usages(uuid, uuid)
returns table(kind text, count bigint)
language sql volatile security definer set search_path = ''
as $function$

  with references_to_tag as (
    select 'distribution_rule'::text kind, rule.id::text id
    from public.round_robin_rules rule
    join public.round_robins queue on queue.id = rule.round_robin_id and queue.organization_id = $1
    where rule.organization_id = $1 and queue.deleted_at is null
      and $2 = any(private.management_tag_reference_ids(to_jsonb(rule)))
    union
    select 'distribution_auto_tags', queue.id::text from public.round_robins queue
    where queue.organization_id = $1 and queue.deleted_at is null
      and $2 = any(private.management_tag_reference_ids(to_jsonb(queue)))
    union
    select 'automation', automation.id::text from public.automations automation
    where automation.organization_id = $1 and automation.deleted_at is null and (
      $2 = any(private.management_tag_reference_ids(to_jsonb(automation)))
      or exists (select 1 from public.automation_nodes node where node.automation_id = automation.id
        and $2 = any(private.management_tag_reference_ids(to_jsonb(node))))
      or exists (select 1 from public.automation_flow_versions version
        where version.id = automation.active_flow_version_id and version.organization_id = $1
          and $2 = any(private.management_tag_reference_ids(to_jsonb(version))))
    )
    union
    select 'automation_execution', execution.id::text from public.automation_executions execution
    join public.automation_flow_versions version on version.id = execution.flow_version_id
      and version.organization_id = execution.organization_id
    where execution.organization_id = $1 and execution.status in ('queued','running','waiting')
      and $2 = any(private.management_tag_reference_ids(to_jsonb(version)))
    union
    select 'stage_automation', automation.id::text from public.stage_automations automation
    where automation.organization_id = $1
      and $2 = any(private.management_tag_reference_ids(to_jsonb(automation)))
    union
    select 'meta_form', form.id::text from public.meta_form_configs form
    where form.organization_id = $1
      and $2 = any(private.management_tag_reference_ids(to_jsonb(form)))
    union
    select 'webhook', webhook.id::text from public.webhooks_integrations webhook
    where webhook.organization_id = $1 and $2 = any(webhook.target_tag_ids)
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
  new_ids := private.management_tag_reference_ids(new_payload);
  old_ids := private.management_tag_reference_ids(old_payload);
  -- Restoration or a tenant move must also revalidate dormant child records.
  if tg_op = 'UPDATE' and (old_tenant_id is distinct from tenant_id or
      (old_payload->>'deleted_at' is not null and new_payload->>'deleted_at' is null)) then
    if tg_table_name = 'round_robins' then
      select coalesce(array_agg(distinct tag), '{}'::uuid[]) into old_ids
      from public.round_robin_rules rule
      cross join lateral unnest(private.management_tag_reference_ids(to_jsonb(rule))) tag
      where rule.round_robin_id = private.safe_uuid(new_payload->>'id');
      new_ids := new_ids || old_ids;
    elsif tg_table_name = 'automations' then
      select coalesce(array_agg(distinct tag), '{}'::uuid[]) into old_ids
      from public.automation_nodes node
      cross join lateral unnest(private.management_tag_reference_ids(to_jsonb(node))) tag
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
    select jsonb_build_object('graph', graph, 'trigger', trigger_config) into flow_payload
    from public.automation_flow_versions where id = version_id and organization_id = tenant_id;
    new_ids := new_ids || private.management_tag_reference_ids(flow_payload);
    if tg_op = 'UPDATE' and (tg_table_name = 'automations' or old_payload->>'status' in ('queued','running','waiting')) then
      version_id := private.safe_uuid(coalesce(old_payload->>'active_flow_version_id', old_payload->>'flow_version_id'));
      select jsonb_build_object('graph', graph, 'trigger', trigger_config) into flow_payload
      from public.automation_flow_versions where id = version_id and organization_id = old_tenant_id;
      old_ids := old_ids || private.management_tag_reference_ids(flow_payload);
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

create or replace function private.guard_management_tag_deletion()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  -- Organization removal cascades configuration and tags together. Do not
  -- block that existing administrative lifecycle while the parent is gone.
  if not exists (select 1 from public.organizations where id = old.organization_id) then return old; end if;
  if exists (select 1 from private.management_tag_usages(old.organization_id, old.id)) then
    raise exception 'The tag is referenced by management configuration'
    using errcode = '23503', constraint = 'tags_management_dependency_guard';
  end if;
  return old;
end
$function$;
revoke all on function private.guard_management_tag_deletion() from public, anon, authenticated;
create trigger guard_management_tag_deletion before delete on public.tags
for each row execute function private.guard_management_tag_deletion();

do $migration$
declare table_name text;
begin
  foreach table_name in array array['round_robin_rules','round_robins','automations','automation_nodes',
    'automation_flow_versions','automation_executions','stage_automations','meta_form_configs','webhooks_integrations']
  loop
    execute format('create trigger guard_management_tag_references before insert or update on public.%I for each row execute function private.guard_management_tag_references()', table_name);
  end loop;
end
$migration$;
commit;

