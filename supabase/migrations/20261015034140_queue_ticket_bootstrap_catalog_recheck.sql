begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Preserve the warm allocator from 20260729021500: existing sequences perform
-- no runtime ACL/catalog DDL. The eight-connection PostgreSQL fixture still
-- reproduced duplicate sequence creation on its first-ever allocation after
-- loading that exact canonical helper.
--
-- Do not depend on the name resolved before waiting. After the existing
-- queue-scoped advisory lock, read pg_class explicitly in a new VOLATILE SQL
-- command rather than repeating the simple to_regclass expression. Return the
-- visible OID directly, including after local creation.
-- No queue/lead row lock or counter UPDATE is added here. This advisory remains
-- a leaf lock: callers may already hold queue/lead locks, and this helper must
-- never acquire or upgrade those locks after taking the advisory lock.
create or replace function private.ensure_round_robin_ticket_sequence(
  p_round_robin_id uuid
)
returns regclass
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_name name;
  v_sequence regclass;
  v_relkind text;
  v_start bigint;
begin
  if p_round_robin_id is null then
    raise exception using errcode = '22023', message = 'round_robin_id_required';
  end if;

  v_name := private.round_robin_ticket_sequence_name(p_round_robin_id);
  v_sequence := pg_catalog.to_regclass(pg_catalog.format('private.%I', v_name));
  if v_sequence is not null then
    perform 1 from pg_catalog.pg_class as relation
      where relation.oid = v_sequence and relation.relkind = 'S';
    if not found then
      raise exception using errcode = '42809', message = 'round_robin_ticket_object_is_not_sequence';
    end if;
    return v_sequence;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'lead-distribution-ticket:' || p_round_robin_id::text, 0
  ));

  -- This lookup must run after the wait, not reuse the pre-wait resolution.
  select relation.oid::regclass, relation.relkind::text
    into v_sequence, v_relkind
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as relation_namespace
    on relation_namespace.oid = relation.relnamespace
  where relation_namespace.nspname = 'private' and relation.relname = v_name;
  if found then
    if v_relkind <> 'S' then
      raise exception using errcode = '42809', message = 'round_robin_ticket_object_is_not_sequence';
    end if;
    return v_sequence;
  end if;

  select greatest(
    coalesce(queue.leads_distributed, 0)::bigint,
    coalesce((select sum(coalesce(member.leads_count, 0))::bigint
      from public.round_robin_members as member where member.round_robin_id = p_round_robin_id), 0),
    (select count(*)::bigint from public.round_robin_logs as distribution_log
      where distribution_log.round_robin_id = p_round_robin_id and distribution_log.reason = 'canonical_round_robin'),
    coalesce((select max((distribution_log.metadata->>'distribution_ticket')::bigint)
      from public.round_robin_logs as distribution_log
      where distribution_log.round_robin_id = p_round_robin_id
        and distribution_log.metadata->>'distribution_ticket' ~ '^[0-9]+$'), 0),
    coalesce((select max(distribution_event.distribution_ticket)
      from private.lead_distribution_events as distribution_event
      where distribution_event.round_robin_id = p_round_robin_id), 0)
  ) + 1 into v_start
  from public.round_robins as queue where queue.id = p_round_robin_id;
  if not found then
    raise exception using errcode = '23503', message = 'round_robin_not_found';
  end if;

  -- IF NOT EXISTS is a final defensive check, never a counter reset. Legitimate
  -- allocator callers still serialize initialization using the advisory above.
  execute pg_catalog.format('create sequence if not exists private.%I as bigint start with %s', v_name, v_start);
  select relation.oid::regclass, relation.relkind::text
    into v_sequence, v_relkind
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as relation_namespace
    on relation_namespace.oid = relation.relnamespace
  where relation_namespace.nspname = 'private' and relation.relname = v_name;
  if not found or v_relkind <> 'S' then
    raise exception using errcode = '42809', message = 'round_robin_ticket_object_is_not_sequence';
  end if;
  -- Cold path only, under the same advisory lock and transaction as creation.
  execute pg_catalog.format(
    'revoke all on sequence private.%I from public, anon, authenticated, service_role', v_name
  );
  return v_sequence;
end;
$function$;

alter function private.ensure_round_robin_ticket_sequence(uuid) owner to postgres;
revoke all on function private.ensure_round_robin_ticket_sequence(uuid) from public, anon, authenticated, service_role;

commit;
