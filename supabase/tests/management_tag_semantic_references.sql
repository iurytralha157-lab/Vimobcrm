-- Run only against a disposable local database with the forward migrations.
-- All IDs/data are synthetic and all fixture writes roll back. This checks
-- actual trigger behavior, not source-text matches or a second JSON parser.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Initialize this connection's private temporary namespace for the helper.
create temporary table management_tag_semantic_test_scope(id integer) on commit drop;

create function pg_temp.assert_management_tag_guard(command text, expected_constraint text)
returns void language plpgsql as $test$
declare actual_constraint text;
begin
  begin
    execute command;
  exception when foreign_key_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint is distinct from expected_constraint then
      raise exception 'Expected %, received % for %', expected_constraint, actual_constraint, command;
    end if;
    return;
  end;
  raise exception 'Expected % to reject %', expected_constraint, command;
end
$test$;

do $test$
declare
  org_a constant uuid := 'dc101000-0000-4000-8000-000000000001';
  org_b constant uuid := 'dc101000-0000-4000-8000-000000000002';
  tag_a constant uuid := 'dc102000-0000-4000-8000-000000000001';
  tag_b constant uuid := 'dc102000-0000-4000-8000-000000000002';
  foreign_tag constant uuid := 'dc102000-0000-4000-8000-000000000003';
  opaque_id constant uuid := 'dc102000-0000-4000-8000-000000000004';
  queue_a constant uuid := 'dc103000-0000-4000-8000-000000000001';
  webhook_a constant uuid := 'dc104000-0000-4000-8000-000000000001';
  legacy_automation constant uuid := 'dc105000-0000-4000-8000-000000000001';
  versioned_automation constant uuid := 'dc105000-0000-4000-8000-000000000002';
  old_version constant uuid := 'dc106000-0000-4000-8000-000000000001';
  new_version constant uuid := 'dc106000-0000-4000-8000-000000000002';
  execution_a constant uuid := 'dc107000-0000-4000-8000-000000000001';
  integration_a constant uuid := 'dc108000-0000-4000-8000-000000000001';
  form_a constant uuid := 'dc109000-0000-4000-8000-000000000001';
  extracted uuid[];
  graph_payload jsonb;
begin
  insert into public.organizations(id,name,slug,is_active) values
    (org_a,'Tag semantic QA A','tag-semantic-qa-a',true),
    (org_b,'Tag semantic QA B','tag-semantic-qa-b',true);
  insert into public.tags(id,organization_id,name,color) values
    (tag_a,org_a,'Tag semantic A','#ff745a'),
    (tag_b,org_a,'Tag semantic B','#008000'),
    (foreign_tag,org_b,'Tag semantic foreign','#008000');

  -- This valid webhook mapping was rejected by the previous recursive guard:
  -- the external field name happens to be a UUID, while target_tag_ids is empty.
  insert into public.webhooks_integrations(id,organization_id,name,api_token,field_mapping,target_tag_ids)
  values(webhook_a,org_a,'Semantic webhook','synthetic-tag-semantic-fixture',
    jsonb_build_object('tags',opaque_id::text),array[]::uuid[]);
  if exists(select 1 from private.management_tag_usages(org_a,opaque_id)) then
    raise exception 'Opaque webhook mapping became a catalog reference';
  end if;
  update public.webhooks_integrations set target_tag_ids=array[tag_a] where id=webhook_a;
  if not exists(select 1 from private.management_tag_usages(org_a,tag_a) where kind='webhook' and count=1) then
    raise exception 'Webhook usage and reference guard disagree';
  end if;
  perform pg_temp.assert_management_tag_guard(format('update public.webhooks_integrations set target_tag_ids=array[%L::uuid] where id=%L',foreign_tag,webhook_a),'tags_management_reference_guard');
  perform pg_temp.assert_management_tag_guard(format('delete from public.tags where id=%L',tag_a),'tags_management_dependency_guard');
  update public.webhooks_integrations set target_tag_ids=array[]::uuid[] where id=webhook_a;

  -- Both Meta producer locations are references. Arbitrary mapping/default
  -- keys are not; the legacy JSON-encoded default array is still consumed.
  insert into public.meta_integrations(id,organization_id,page_id) values(integration_a,org_a,'synthetic-tag-page');
  insert into public.meta_form_configs(id,organization_id,integration_id,form_id,auto_tags,default_values,field_mapping)
  values(form_a,org_a,integration_a,'synthetic-tag-form','[]'::jsonb,
    jsonb_build_object('auto_tags',to_jsonb(jsonb_build_array(tag_a::text)::text),'tags',opaque_id::text),
    jsonb_build_object('tags',opaque_id::text));
  if not exists(select 1 from private.management_tag_usages(org_a,tag_a) where kind='meta_form' and count=1) then
    raise exception 'Legacy Meta default auto_tags string array was missed';
  end if;
  perform pg_temp.assert_management_tag_guard(format('delete from public.tags where id=%L',tag_a),'tags_management_dependency_guard');
  perform pg_temp.assert_management_tag_guard(format('update public.meta_form_configs set auto_tags=jsonb_build_array(%L::text) where id=%L',foreign_tag,form_a),'tags_management_reference_guard');
  delete from public.meta_form_configs where id=form_a;

  -- Inactive queues/rules remain editable configurations. The selector's
  -- column/conditions/name fallback must retain legacy and hybrid tag rules.
  insert into public.round_robins(id,organization_id,name,is_active,settings,rules)
  values(queue_a,org_a,'Semantic queue',false,
    jsonb_build_object('field_mapping',jsonb_build_object('tags',opaque_id::text)),
    jsonb_build_object('unrelated_variable',jsonb_build_object('tags',opaque_id::text)));
  update public.round_robins set settings=jsonb_build_object(
    'auto_tag_ids',jsonb_build_array(tag_b::text),
    'field_mapping',jsonb_build_object('tags',opaque_id::text)) where id=queue_a;
  if not exists(select 1 from private.management_tag_usages(org_a,tag_b) where kind='distribution_auto_tags' and count=1) then
    raise exception 'Inactive queue auto_tag_ids producer was missed';
  end if;
  perform pg_temp.assert_management_tag_guard(format('update public.round_robins set settings=jsonb_build_object(''auto_tag_ids'',jsonb_build_array(%L::text)) where id=%L',foreign_tag,queue_a),'tags_management_reference_guard');
  perform pg_temp.assert_management_tag_guard(format('delete from public.tags where id=%L',tag_b),'tags_management_dependency_guard');
  update public.round_robins set settings=jsonb_build_object(
    'field_mapping',jsonb_build_object('tags',opaque_id::text)) where id=queue_a;
  insert into public.round_robin_rules(round_robin_id,organization_id,name,match_type,match_value,is_active,conditions)
  values(queue_a,org_a,'tag','','',false,jsonb_build_object('match_value',tag_a::text));
  if not exists(select 1 from private.management_tag_usages(org_a,tag_a) where kind='distribution_rule' and count=1) then
    raise exception 'Legacy inactive tag matcher was missed';
  end if;
  extracted:=private.management_tag_configuration_ids('round_robin_rules',jsonb_build_object(
    'match_type','tag','match_value','','conditions',jsonb_build_object('match_value',tag_a::text||', '||tag_b::text)));
  if extracted<>array[tag_a,tag_b] then raise exception 'Hybrid tag rule value fallback was lost'; end if;
  extracted:=private.management_tag_configuration_ids('round_robin_rules',jsonb_build_object(
    'match_type','','match_value',tag_a::text,'conditions',jsonb_build_object('match_type','tag')));
  if extracted<>array[tag_a] then raise exception 'Hybrid tag rule type fallback was lost'; end if;
  perform pg_temp.assert_management_tag_guard(format('update public.round_robins set organization_id=%L where id=%L',org_b,queue_a),'tags_management_reference_guard');
  update public.round_robins set deleted_at=now() where id=queue_a;
  delete from public.tags where id=tag_a;
  perform pg_temp.assert_management_tag_guard(format('update public.round_robins set deleted_at=null where id=%L',queue_a),'tags_management_reference_guard');
  insert into public.tags(id,organization_id,name,color) values(tag_a,org_a,'Tag semantic restored A','#ff745a');
  update public.round_robins set deleted_at=null where id=queue_a;
  delete from public.round_robin_rules where round_robin_id=queue_a;

  -- Legacy automation_nodes use node_config, not the API's config alias.
  insert into public.automations(id,organization_id,name,trigger_type,is_active)
  values(legacy_automation,org_a,'Semantic legacy automation','manual',false);
  insert into public.automation_nodes(automation_id,node_type,action_type,node_config)
  values(legacy_automation,'action','add_tag',jsonb_build_object('tag_id',tag_a::text));
  if not exists(select 1 from private.management_tag_usages(org_a,tag_a) where kind='automation' and count=1) then
    raise exception 'Legacy automation node was missed';
  end if;
  perform pg_temp.assert_management_tag_guard(format('delete from public.tags where id=%L',tag_a),'tags_management_dependency_guard');
  perform pg_temp.assert_management_tag_guard(format('update public.automations set organization_id=%L where id=%L',org_b,legacy_automation),'tags_management_reference_guard');
  update public.automations set deleted_at=now() where id=legacy_automation;
  delete from public.tags where id=tag_a;
  perform pg_temp.assert_management_tag_guard(format('update public.automations set deleted_at=null where id=%L',legacy_automation),'tags_management_reference_guard');

  -- Opaque graph variables/webhook payloads cannot look like tag actions.
  graph_payload:=jsonb_build_object('nodes',jsonb_build_array(
    jsonb_build_object('type','action','action_type','add_tag','config',jsonb_build_object('tag_id',tag_b::text)),
    jsonb_build_object('type','action','action_type','webhook','config',jsonb_build_object('payload',jsonb_build_object('tags',opaque_id::text))),
    jsonb_build_object('type','action','action_type','set_variable','config',jsonb_build_object('tag_id',opaque_id::text)),
    jsonb_build_object('type','condition','config',jsonb_build_object('tags',opaque_id::text))
  ),'settings',jsonb_build_object('tags',opaque_id::text));
  extracted:=private.management_automation_graph_tag_ids(graph_payload);
  if extracted<>array[tag_b] then raise exception 'Graph references are not restricted to tag producers: %',extracted; end if;
  extracted:=private.management_automation_graph_tag_ids(jsonb_build_object('nodes',jsonb_build_array(
    jsonb_build_object('type','tag','data',jsonb_build_object('tag_id',tag_b::text))
  )));
  if extracted<>array[tag_b] then raise exception 'Legacy visual tag draft was lost'; end if;
  extracted:=private.management_tag_configuration_ids('automation_flow_versions',jsonb_build_object(
    'trigger_type','tag_added','trigger_config',jsonb_build_object('tag_id',tag_b::text),'graph','{}'::jsonb));
  if extracted<>array[tag_b] then raise exception 'Published tag trigger was missed'; end if;
  extracted:=private.management_tag_configuration_ids('stage_automations',jsonb_build_object(
    'config',jsonb_build_object('tags',opaque_id::text,'tag_id',opaque_id::text)));
  if cardinality(extracted)<>0 then raise exception 'Unsupported stage config is being treated as a tag action'; end if;
  extracted:=private.management_tag_configuration_ids('automation_executions',jsonb_build_object(
    'execution_data',jsonb_build_object('tag_id',opaque_id::text)));
  if cardinality(extracted)<>0 then raise exception 'Execution runtime variables became catalog references'; end if;

  -- The current version is empty, but a running execution pins the older graph.
  -- Removal of its parent does not release that execution dependency.
  insert into public.automations(id,organization_id,name,trigger_type,is_active)
  values(versioned_automation,org_a,'Semantic versioned automation','manual',false);
  insert into public.automation_flow_versions(id,automation_id,organization_id,version,trigger_type,graph,graph_checksum,first_node_key)
  values(old_version,versioned_automation,org_a,1,'manual',graph_payload,'synthetic-old','tag-action'),
    (new_version,versioned_automation,org_a,2,'manual','{}'::jsonb,'synthetic-current','noop');
  update public.automations set active_flow_version_id=new_version,is_active=true where id=versioned_automation;
  if exists(select 1 from private.management_tag_usages(org_a,tag_b)) then
    raise exception 'An unreferenced historical version blocks tag deletion';
  end if;
  insert into public.automation_executions(id,automation_id,organization_id,flow_version_id,status,execution_data)
  values(execution_a,versioned_automation,org_a,old_version,'waiting',jsonb_build_object('tags',opaque_id::text));
  update public.automations set is_active=false,deleted_at=now() where id=versioned_automation;
  if not exists(select 1 from private.management_tag_usages(org_a,tag_b) where kind='automation_execution' and count=1)
    or exists(select 1 from private.management_tag_usages(org_b,tag_b)) then
    raise exception 'Pinned execution dependency or its tenant isolation was lost';
  end if;
  perform pg_temp.assert_management_tag_guard(format('delete from public.tags where id=%L',tag_b),'tags_management_dependency_guard');
  update public.automation_executions set status='completed' where id=execution_a;
  delete from public.tags where id=tag_b;
  perform pg_temp.assert_management_tag_guard(format('update public.automation_executions set status=''queued'' where id=%L',execution_a),'tags_management_reference_guard');
  perform pg_temp.assert_management_tag_guard(format('update public.automations set active_flow_version_id=%L,deleted_at=null where id=%L',old_version,versioned_automation),'tags_management_reference_guard');
end
$test$;
rollback;
