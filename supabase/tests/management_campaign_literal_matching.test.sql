-- Disposable local database only, after the management forward migrations.
-- Synthetic fixtures roll back; this file is prepared, never an automatic rollout.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $test$
declare
  org_a constant uuid := 'dd101000-0000-4000-8000-000000000001';
  org_b constant uuid := 'dd101000-0000-4000-8000-000000000002';
  literal_queue constant uuid := 'dd102000-0000-4000-8000-000000000001';
  legacy_queue constant uuid := 'dd102000-0000-4000-8000-000000000002';
  foreign_queue constant uuid := 'dd102000-0000-4000-8000-000000000003';
  lead_id constant uuid := 'dd103000-0000-4000-8000-000000000001';
  rule_id constant uuid := 'dd104000-0000-4000-8000-000000000001';
  selected_queue uuid;
  extracted text[];
  malformed jsonb;
begin
  extracted := private.management_campaign_match_values(
    '{"campaign_name_contains_literals":[" Lançamento, Torre A ","50% OFF"]}', 'ignored,legacy');
  if extracted <> array['lançamento, torre a','50% off'] then
    raise exception 'campaign literal punctuation, casing or order was lost: %', extracted;
  end if;
  if private.management_campaign_match_values('{}', ' Torre A, Torre B ,') <> array['torre a','torre b'] then
    raise exception 'unmarked historical CSV alternatives changed';
  end if;
  if strpos('desconto 50% off', extracted[2]) = 0 or strpos('desconto 50x off', extracted[2]) <> 0 then
    raise exception 'percent must remain literal text';
  end if;
  foreach malformed in array array[
    '{"campaign_name_contains_literals":null}'::jsonb,
    '{"campaign_name_contains_literals":"Torre A"}'::jsonb,
    '{"campaign_name_contains_literals":["Torre A",false]}'::jsonb,
    '{"campaign_name_contains_literals":[" "]}'::jsonb,
    '{"campaign_name_contains_literals":[]}'::jsonb
  ] loop
    if cardinality(private.management_campaign_match_values(malformed, 'fallback')) <> 0 then
      raise exception 'malformed literal marker fell back to CSV: %', malformed;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'private.management_campaign_match_values(jsonb,text)', 'execute')
    or has_function_privilege('anon', 'private.management_campaign_match_values(jsonb,text)', 'execute')
    or not has_function_privilege('service_role', 'private.management_campaign_match_values(jsonb,text)', 'execute') then
    raise exception 'campaign helper execution grants changed';
  end if;

  insert into public.organizations(id,name,slug,is_active) values
    (org_a,'Campaign QA A','campaign-literal-qa-a',true),
    (org_b,'Campaign QA B','campaign-literal-qa-b',true);
  insert into public.round_robins(id,organization_id,name,is_active) values
    (literal_queue,org_a,'Literal campaign',true),
    (legacy_queue,org_a,'Historical CSV',true),
    (foreign_queue,org_b,'Foreign campaign',true);
  insert into public.round_robin_rules(id,organization_id,round_robin_id,match_type,match_value,match,priority,is_active) values
    (rule_id,org_a,literal_queue,'campaign_contains','Torre A,Torre B',
      '{"campaign_name_contains_literals":["Torre A,Torre B"]}',100,true),
    ('dd104000-0000-4000-8000-000000000002',org_a,legacy_queue,'campaign_contains','Torre A,Torre B','{}',50,true),
    ('dd104000-0000-4000-8000-000000000003',org_b,foreign_queue,'campaign_contains','Torre A,Torre B',
      '{"campaign_name_contains_literals":["Torre A,Torre B"]}',999,true);
  insert into public.leads(id,organization_id,name,source,utm_campaign,metadata)
    values(lead_id,org_a,'Campaign fixture','manual','Promo Torre A', '{"distribution_deferred":true}');
  selected_queue := public.pick_round_robin_for_lead(lead_id);
  if selected_queue is distinct from legacy_queue then
    raise exception 'literal comma matched only half of a criterion: %', selected_queue;
  end if;
  update public.leads set utm_campaign = 'Promo Torre A,Torre B' where id = lead_id;
  selected_queue := public.pick_round_robin_for_lead(lead_id);
  if selected_queue is distinct from literal_queue then
    raise exception 'whole literal criterion or priority/tenant isolation failed: %', selected_queue;
  end if;
  -- Match metadata in conditions is supported for historical hybrid rows.
  update public.round_robin_rules set match = '{}', conditions =
    '{"match":{"campaign_name_contains_literals":["50% OFF"]}}' where id = rule_id;
  update public.leads set utm_campaign = 'Promo 50% off' where id = lead_id;
  if public.pick_round_robin_for_lead(lead_id) is distinct from literal_queue then
    raise exception 'conditions match metadata was ignored';
  end if;
  update public.leads set utm_campaign = 'Promo 50x off' where id = lead_id;
  if public.pick_round_robin_for_lead(lead_id) is not null then
    raise exception 'percent was treated as a wildcard';
  end if;
end;
$test$;
rollback;
