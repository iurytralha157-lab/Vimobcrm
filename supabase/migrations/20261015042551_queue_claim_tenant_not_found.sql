begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- An absent tenant/queue pair is not lock contention. Both a missing queue and
-- a queue owned by another tenant must map to the API's opaque not-found path.
-- This existence lookup grants no capability: the delegated claim still
-- resolves current actor permissions/audience only after queue SHARE is held.
create or replace function private.claim_queue_pool(p_organization_id uuid,p_lead_id uuid,p_actor_id uuid,p_round_robin_id uuid,
  p_episode_id uuid,p_expected_revision bigint,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
begin
  if p_organization_id is null or p_round_robin_id is null then
    return jsonb_build_object('success',false,'reason','not_found');
  end if;
  if not exists(select 1 from public.round_robins where organization_id=p_organization_id and id=p_round_robin_id) then
    return jsonb_build_object('success',false,'reason','not_found');
  end if;

  perform 1 from public.round_robins where organization_id=p_organization_id and id=p_round_robin_id for share skip locked;
  if not found then
    -- A concurrent delete or tenant change can commit between the existence
    -- read and lock attempt. Preserve not-found after that race as well.
    if not exists(select 1 from public.round_robins where organization_id=p_organization_id and id=p_round_robin_id) then
      return jsonb_build_object('success',false,'reason','not_found');
    end if;
    return jsonb_build_object('success',false,'reason','queue_busy');
  end if;

  return private.claim_queue_pool_before_concurrency_guard(p_organization_id,p_lead_id,p_actor_id,p_round_robin_id,p_episode_id,p_expected_revision,p_idempotency_key);
end;
$function$;

alter function private.claim_queue_pool(uuid,uuid,uuid,uuid,uuid,bigint,text) owner to postgres;
revoke all on function private.claim_queue_pool(uuid,uuid,uuid,uuid,uuid,bigint,text)
  from public,anon,authenticated,service_role;

-- Rollback is a forward migration restoring the wrapper from 20261015033816.
-- No stored lead, runtime, receipt, schedule or permission is rewritten.
commit;
