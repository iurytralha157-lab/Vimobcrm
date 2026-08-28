-- Avoid catalog writes on the hot lead-distribution path.
--
-- Ticket sequences are created inside the private schema and have their ACL
-- revoked exactly once while still protected by the queue-scoped advisory
-- lock. Repeating REVOKE for an existing sequence makes two otherwise
-- independent lead assignments race on pg_class/pg_shdepend and can surface
-- as "tuple concurrently updated".

create or replace function private.ensure_round_robin_ticket_sequence(
  p_round_robin_id uuid
)
returns regclass
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name name;
  v_sequence regclass;
  v_start bigint;
begin
  if p_round_robin_id is null then
    raise exception using
      errcode = '22023',
      message = 'round_robin_id_required';
  end if;

  v_name := private.round_robin_ticket_sequence_name(p_round_robin_id);
  v_sequence := pg_catalog.to_regclass(
    pg_catalog.format('private.%I', v_name)
  );
  if v_sequence is not null then
    perform 1
    from pg_catalog.pg_class as relation
    where relation.oid = v_sequence
      and relation.relkind = 'S';
    if not found then
      raise exception using
        errcode = '42809',
        message = 'round_robin_ticket_object_is_not_sequence';
    end if;
    return v_sequence;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lead-distribution-ticket:' || p_round_robin_id::text,
      0
    )
  );

  v_sequence := pg_catalog.to_regclass(
    pg_catalog.format('private.%I', v_name)
  );
  if v_sequence is not null then
    perform 1
    from pg_catalog.pg_class as relation
    where relation.oid = v_sequence
      and relation.relkind = 'S';
    if not found then
      raise exception using
        errcode = '42809',
        message = 'round_robin_ticket_object_is_not_sequence';
    end if;
    return v_sequence;
  end if;

  select greatest(
    coalesce(queue.leads_distributed, 0)::bigint,
    coalesce(
      (
        select sum(coalesce(member.leads_count, 0))::bigint
        from public.round_robin_members as member
        where member.round_robin_id = p_round_robin_id
      ),
      0
    ),
    (
      select count(*)::bigint
      from public.round_robin_logs as distribution_log
      where distribution_log.round_robin_id = p_round_robin_id
        and distribution_log.reason = 'canonical_round_robin'
    ),
    coalesce(
      (
        select max(
          (distribution_log.metadata->>'distribution_ticket')::bigint
        )
        from public.round_robin_logs as distribution_log
        where distribution_log.round_robin_id = p_round_robin_id
          and distribution_log.metadata->>'distribution_ticket'
            ~ '^[0-9]+$'
      ),
      0
    ),
    coalesce(
      (
        select max(distribution_event.distribution_ticket)
        from private.lead_distribution_events as distribution_event
        where distribution_event.round_robin_id = p_round_robin_id
      ),
      0
    )
  ) + 1
  into v_start
  from public.round_robins as queue
  where queue.id = p_round_robin_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'round_robin_not_found';
  end if;

  execute pg_catalog.format(
    'create sequence private.%I as bigint start with %s',
    v_name,
    v_start
  );
  execute pg_catalog.format(
    'revoke all on sequence private.%I from public, anon, authenticated, service_role',
    v_name
  );

  return pg_catalog.to_regclass(
    pg_catalog.format('private.%I', v_name)
  );
end;
$$;

alter function private.ensure_round_robin_ticket_sequence(uuid)
  owner to postgres;

revoke all on function private.ensure_round_robin_ticket_sequence(uuid)
  from public, anon, authenticated, service_role;
