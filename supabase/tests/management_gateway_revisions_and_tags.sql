-- Disposable local fixture only, after all four management migrations.
-- Uses synthetic data; every fixture mutation rolls back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $contract$
declare
  target text;
  client_role text;
  org_a constant uuid := 'da101000-0000-4000-8000-000000000001';
  org_b constant uuid := 'da101000-0000-4000-8000-000000000002';
  tag_a constant uuid := 'da102000-0000-4000-8000-000000000001';
  tag_b constant uuid := 'da102000-0000-4000-8000-000000000002';
  queue_a constant uuid := 'da103000-0000-4000-8000-000000000001';
  before_revision bigint;
  after_revision bigint;
  before_time timestamptz;
  after_time timestamptz;
  extracted uuid[];
  rejected boolean;
begin
  foreach target in array array['tags','round_robins','round_robin_rules','round_robin_members'] loop
    foreach client_role in array array['anon','authenticated'] loop
      if has_table_privilege(client_role, 'public.' || target, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(client_role, 'public.' || target, 'INSERT,UPDATE,REFERENCES') then
        raise exception 'management mutation boundary is open: %.%', client_role, target;
      end if;
    end loop;
    if not has_table_privilege('authenticated', 'public.' || target, 'SELECT') then
      raise exception 'management catalog SELECT was removed: %', target;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.round_robins', 'DELETE') then
    raise exception 'queue tombstone deletion protection was reversed';
  end if;
  if has_table_privilege('authenticated', 'private.crm_management_create_requests', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'private.crm_management_create_requests', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'private creation ledger is exposed';
  end if;

  -- Ordinary text containing a UUID is not a tag reference. Typed configuration
  -- fields, nested automation graphs and legacy comma-separated rules are.
  extracted := private.management_tag_reference_ids(jsonb_build_object('message', tag_a::text, 'campaign', tag_a::text));
  if cardinality(extracted) <> 0 then raise exception 'free text is being treated as a tag'; end if;
  extracted := private.management_tag_reference_ids(jsonb_build_object('graph', jsonb_build_object('nodes', jsonb_build_array(
    jsonb_build_object('config', jsonb_build_object('tag_id', tag_a::text)),
    jsonb_build_object('config', jsonb_build_object('tagIds', jsonb_build_array(tag_b::text, tag_a::text)))
  ))));
  if extracted <> array[tag_a,tag_b] then raise exception 'nested typed tag references were lost: %', extracted; end if;
  extracted := private.management_tag_reference_ids(jsonb_build_object('round_robin_id', queue_a, 'name', 'tag', 'match_value', tag_a::text || ', ' || tag_b::text));
  if extracted <> array[tag_a,tag_b] then raise exception 'legacy tag rules were lost'; end if;
  extracted := private.management_tag_reference_ids(jsonb_build_object('round_robin_id',queue_a,'match_type','tag',
    'match_value','','conditions',jsonb_build_object('match_value',tag_a::text)));
  if extracted <> array[tag_a] then raise exception 'hybrid legacy rule value was lost'; end if;
  extracted := private.management_tag_reference_ids(jsonb_build_object('round_robin_id',queue_a,'match_type','',
    'match_value',tag_a::text,'conditions',jsonb_build_object('match_type','tag')));
  if extracted <> array[tag_a] then raise exception 'hybrid legacy rule type was lost'; end if;

  insert into public.organizations(id,name,slug,is_active) values
    (org_a,'Management QA A','management-qa-a',true),
    (org_b,'Management QA B','management-qa-b',true);
  insert into public.tags(id,organization_id,name,color) values
    (tag_a,org_a,'Management QA A','#ff745a'),
    (tag_b,org_b,'Management QA B','#ff745a');
  select updated_at into before_time from public.tags where id = tag_a;
  update public.tags set name = name where id = tag_a;
  select updated_at into after_time from public.tags where id = tag_a;
  if before_time <> after_time then raise exception 'no-op tag update advanced the revision'; end if;
  update public.tags set name = 'Management QA renamed' where id = tag_a;
  select updated_at into after_time from public.tags where id = tag_a;
  if after_time <= before_time then raise exception 'changed tag revision did not advance'; end if;

  insert into public.round_robins(id,organization_id,name,is_active,settings)
    values (queue_a,org_a,'Management QA queue',false,jsonb_build_object('auto_tag_ids',jsonb_build_array(tag_a::text)));
  select revision into before_revision from public.round_robins where id = queue_a;
  update public.round_robins set current_position = coalesce(current_position,0) + 1 where id = queue_a;
  select revision into after_revision from public.round_robins where id = queue_a;
  if before_revision <> after_revision then raise exception 'runtime rotation invalidated the editor'; end if;
  update public.round_robins set name = 'Management QA queue renamed' where id = queue_a;
  select revision into after_revision from public.round_robins where id = queue_a;
  if after_revision <> before_revision + 1 then raise exception 'queue configuration revision did not advance'; end if;

  if not exists(select 1 from private.management_tag_usages(org_a,tag_a))
    or exists(select 1 from private.management_tag_usages(org_b,tag_a)) then
    raise exception 'usage counts failed tenant isolation or disabled configuration coverage';
  end if;
  rejected := false;
  begin
    update public.round_robins set settings = jsonb_build_object('auto_tag_ids',jsonb_build_array(tag_b::text)) where id = queue_a;
  exception when foreign_key_violation then rejected := true;
  end;
  if not rejected then raise exception 'cross-tenant new tag reference was accepted'; end if;
  rejected := false;
  begin
    delete from public.tags where id = tag_a;
  exception when foreign_key_violation then rejected := true;
  end;
  if not rejected then raise exception 'referenced tag deletion was accepted'; end if;

  update public.round_robins set deleted_at = now(), is_active = false where id = queue_a;
  if exists(select 1 from private.management_tag_usages(org_a,tag_a)) then
    raise exception 'a removed queue permanently blocks tag deletion';
  end if;
  delete from public.tags where id = tag_a;

  if private.management_distribution_source('Facebook Lead Ads') <> 'meta'
    or private.management_distribution_source('facebook_ads') <> 'meta'
    or private.management_distribution_source('wpp') <> 'whatsapp' then
    raise exception 'established source aliases are inconsistent';
  end if;
end;
$contract$;
rollback;
