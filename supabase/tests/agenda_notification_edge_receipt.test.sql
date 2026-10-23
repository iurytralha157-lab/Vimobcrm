do $test$
declare
  v_result jsonb;
begin
  if has_function_privilege('anon', 'public.evolution_go_reconcile_notification_receipt(uuid,uuid,text,text,timestamptz)', 'execute')
    or has_function_privilege('authenticated', 'public.evolution_go_reconcile_notification_receipt(uuid,uuid,text,text,timestamptz)', 'execute')
    or not has_function_privilege('service_role', 'public.evolution_go_reconcile_notification_receipt(uuid,uuid,text,text,timestamptz)', 'execute') then
    raise exception 'receipt gateway ACL regression';
  end if;
  v_result := public.evolution_go_reconcile_notification_receipt(
    'aa000000-0000-4000-8000-000000000010', 'bb000000-0000-4000-8000-000000000001',
    'synthetic-message', 'delivered', '2026-10-12T18:00:00Z');
  if v_result->>'outcome' <> 'invalid_scope' then raise exception 'foreign session was accepted'; end if;
  v_result := public.evolution_go_reconcile_notification_receipt(
    'aa000000-0000-4000-8000-000000000010', 'aa000000-0000-4000-8000-000000000002',
    'synthetic-message', 'delivered', '2026-10-12T18:00:00Z');
  if v_result->>'outcome' <> 'invalid_scope' then raise exception 'wrong provider was accepted'; end if;
  v_result := public.evolution_go_reconcile_notification_receipt(
    'aa000000-0000-4000-8000-000000000010', 'aa000000-0000-4000-8000-000000000003',
    'synthetic-message', 'delivered', '2026-10-12T18:00:00Z');
  if v_result->>'outcome' <> 'invalid_scope' then raise exception 'different sender in same tenant was accepted'; end if;
  v_result := public.evolution_go_reconcile_notification_receipt(
    'aa000000-0000-4000-8000-000000000010', 'aa000000-0000-4000-8000-000000000001',
    'synthetic-legacy', 'delivered', '2026-10-12T18:00:00Z');
  if v_result->>'outcome' <> 'not_found' then raise exception 'missing sender provenance was inferred'; end if;
end
$test$;
set local role authenticated;
do $test$
begin
  begin
    perform public.evolution_go_reconcile_notification_receipt(
      'aa000000-0000-4000-8000-000000000010', 'aa000000-0000-4000-8000-000000000001',
      'synthetic-message', 'delivered', '2026-10-12T18:00:00Z');
    raise exception 'authenticated caller executed receipt gateway';
  exception when insufficient_privilege then null;
  end;
end
$test$;
reset role;
set local role service_role;
do $test$
declare v_result jsonb;
begin
  v_result := public.evolution_go_reconcile_notification_receipt(
    'aa000000-0000-4000-8000-000000000010', 'aa000000-0000-4000-8000-000000000001',
    'synthetic-message', 'read', '2026-10-12T18:00:00Z');
  if v_result->>'outcome' <> 'applied'
    or v_result->>'organization_id' <> 'aa000000-0000-4000-8000-000000000010'
    or v_result->>'message_id' <> 'synthetic-message'
    or v_result->>'status' <> 'read'
    or (v_result->>'occurred_at')::timestamptz <> '2026-10-12T18:00:00Z'::timestamptz then
    raise exception 'receipt gateway did not preserve trusted arguments';
  end if;
end
$test$;
reset role;
