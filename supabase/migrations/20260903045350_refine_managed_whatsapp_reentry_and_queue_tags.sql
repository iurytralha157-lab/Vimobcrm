-- Complete the managed WhatsApp lifecycle without replacing the production
-- release it is based on. The canonical distributor remains the only writer
-- for queue selection/assignment; this migration adds a message-scoped intake
-- ledger, reentry semantics and queue output tags around that boundary.

do $managed_whatsapp_refinement_preflight$
begin
  if pg_catalog.to_regprocedure(
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)'
  ) is null
     or not exists (
       select 1
       from pg_catalog.pg_proc as procedure_definition
       where procedure_definition.oid = pg_catalog.to_regprocedure(
         'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)'
       )
         and procedure_definition.prorettype = pg_catalog.to_regtype('pg_catalog.jsonb')
         and not procedure_definition.proretset
     ) then
    raise exception using
      errcode = '55000',
      message = 'managed_whatsapp_refinement_requires_canonical_distribution';
  end if;

  if pg_catalog.to_regprocedure(
    'public.handle_managed_whatsapp_message_lead(uuid)'
  ) is null then
    raise exception using
      errcode = '55000',
      message = 'managed_whatsapp_refinement_requires_managed_routing';
  end if;

  if position(
    'private.distribute_lead' in lower(pg_catalog.pg_get_functiondef(
      'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
    ))
  ) = 0 then
    raise exception using
      errcode = '55000',
      message = 'managed_whatsapp_refinement_requires_canonical_managed_routing';
  end if;

  if pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.lead_entry_events') is null
     or pg_catalog.to_regclass('public.lead_redistribution_jobs') is null
     or pg_catalog.to_regclass('private.lead_distribution_events') is null
     or pg_catalog.to_regclass('public.lead_tags') is null
     or pg_catalog.to_regclass('public.whatsapp_inbound_logs') is null
     or pg_catalog.to_regclass('public.whatsapp_messages') is null then
    raise exception using
      errcode = '55000',
      message = 'managed_whatsapp_refinement_schema_is_incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.lead_entry_events'::regclass
      and attribute.attname = 'provider_event_id'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) then
    raise exception using
      errcode = '55000',
      message = 'managed_whatsapp_refinement_requires_provider_event_id';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(text,text)') is null
     or not exists (
       select 1
       from pg_catalog.pg_index as index_definition
       where index_definition.indexrelid = pg_catalog.to_regclass(
         'public.lead_entry_events_provider_event_unique_idx'
       )
         and index_definition.indisunique
         and index_definition.indisvalid
         and index_definition.indisready
     )
     or not exists (
       select 1
       from pg_catalog.pg_index as index_definition
       where index_definition.indexrelid = pg_catalog.to_regclass(
         'public.idx_lead_redistribution_jobs_one_active'
       )
         and index_definition.indisunique
         and index_definition.indisvalid
         and index_definition.indisready
     ) then
    raise exception using
      errcode = '55000',
      message = 'managed_whatsapp_refinement_idempotency_prerequisites_missing';
  end if;
end;
$managed_whatsapp_refinement_preflight$;

-- The redistribution worker is deployed with this release and must never
-- depend on an out-of-band/local migration for its canonical distribution RPC.
create or replace function public.distribute_lead_from_backend(
  p_organization_id uuid,
  p_lead_id uuid,
  p_idempotency_key text,
  p_round_robin_id uuid default null,
  p_preserve_assignee boolean default true,
  p_source text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.distribute_lead(
    p_organization_id,
    p_lead_id,
    p_idempotency_key,
    p_round_robin_id,
    p_preserve_assignee,
    p_source,
    p_now
  );
$$;

revoke all on function public.distribute_lead_from_backend(
  uuid, uuid, text, uuid, boolean, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.distribute_lead_from_backend(
  uuid, uuid, text, uuid, boolean, text, timestamptz
) to service_role;

-- The provider delivery identity deliberately excludes mutable routing state.
-- A rule edit cannot change whether the same org/session/provider message was
-- already accepted, while different payload content remains a hard collision.
create or replace function private.managed_whatsapp_message_fingerprint(
  p_organization_id uuid,
  p_session_id uuid,
  p_provider_message_id text,
  p_message text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      coalesce(p_organization_id::text, '') || chr(31)
        || coalesce(p_session_id::text, '') || chr(31)
        || coalesce(p_provider_message_id, '') || chr(31)
        || coalesce(p_message, ''),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.managed_whatsapp_message_fingerprint(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;

-- Runtime calls this before looking at today's rules. A completed ledger wins;
-- during the narrow post-create/pre-ledger window, only immutable provenance on
-- the managed lead may recover the original rule and queue. No current rule or
-- queue is consulted here, so a retry can never silently move to new routing.
create or replace function public.lookup_managed_whatsapp_lead_entry(
  p_organization_id uuid,
  p_session_id uuid,
  p_provider_message_id text,
  p_message text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider_message_id text := btrim(coalesce(p_provider_message_id, ''));
  v_provider_event_id text;
  v_message_fingerprint text;
  v_existing_entry public.lead_entry_events%rowtype;
  v_pending_lead public.leads%rowtype;
  v_pending_log public.whatsapp_inbound_logs%rowtype;
  v_legacy_log public.whatsapp_inbound_logs%rowtype;
  v_legacy_message public.whatsapp_messages%rowtype;
  v_intake_result jsonb := '{}'::jsonb;
  v_rule_id_text text;
  v_round_robin_id_text text;
  v_session_id_text text;
  v_log_message_fingerprint text;
  v_has_persisted_message boolean := false;
begin
  -- This lookup runs for every inbound payload, including media without text.
  -- Missing identity is simply not a managed ledger hit and must not create an
  -- endless webhook retry.
  if p_organization_id is null
     or p_session_id is null
     or length(v_provider_message_id) not between 1 and 500
     or p_provider_message_id <> v_provider_message_id then
    return jsonb_build_object('handled', false, 'pending', false);
  end if;

  v_provider_event_id := p_session_id::text || ':' || v_provider_message_id;
  v_message_fingerprint := private.managed_whatsapp_message_fingerprint(
    p_organization_id,
    p_session_id,
    v_provider_message_id,
    p_message
  );

  select entry.*
    into v_existing_entry
    from public.lead_entry_events as entry
   where entry.organization_id = p_organization_id
     and entry.provider = 'whatsapp'
     and entry.provider_event_id = v_provider_event_id
     and entry.is_countable = true
   limit 1;

  if found then
    if coalesce(v_existing_entry.metadata->>'message_fingerprint', '')
         is distinct from v_message_fingerprint
       or not exists (
         select 1
         from public.leads as ledger_lead
         where ledger_lead.organization_id = p_organization_id
           and ledger_lead.id = v_existing_entry.lead_id
       ) then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_provider_message_collision';
    end if;

    if jsonb_typeof(v_existing_entry.metadata->'intake_result') = 'object' then
      v_intake_result := v_existing_entry.metadata->'intake_result';
    else
      -- The provider ledger remains authoritative even if a legacy/corrupt row
      -- is missing the cached response. Never manufacture a successful outcome.
      v_intake_result := jsonb_build_object(
        'success', false,
        'reason', 'managed_whatsapp_ledger_result_missing'
      );
    end if;

    return v_intake_result || jsonb_build_object(
      'handled', true,
      'pending', false,
      'duplicate_retry', true,
      'lead_id', v_existing_entry.lead_id,
      'entry_event_id', v_existing_entry.id,
      'matched_rule_id', nullif(v_existing_entry.metadata->>'matched_rule_id', ''),
      'target_round_robin_id', nullif(coalesce(
        v_existing_entry.metadata->>'target_round_robin_id',
        v_intake_result->>'round_robin_id'
      ), ''),
      'provider_event_id', v_provider_event_id
    );
  end if;

  select lead.*
    into v_pending_lead
    from public.leads as lead
   where lead.organization_id = p_organization_id
     and lower(btrim(coalesce(lead.source, ''))) = 'whatsapp'
     and lead.source_session_id = p_session_id
     and lower(btrim(coalesce(
       lead.metadata->>'managed_whatsapp_message_distribution',
       'false'
     ))) in ('true', '1', 'yes')
     and btrim(coalesce(
       lead.metadata->>'managed_whatsapp_initial_provider_event_id',
       ''
     )) = v_provider_event_id
   order by lead.created_at, lead.id
   limit 1;

  if found then
    if exists (
      select 1
      from public.leads as conflicting_lead
      where conflicting_lead.organization_id = p_organization_id
        and conflicting_lead.id <> v_pending_lead.id
        and lower(btrim(coalesce(conflicting_lead.source, ''))) = 'whatsapp'
        and conflicting_lead.source_session_id = p_session_id
        and lower(btrim(coalesce(
          conflicting_lead.metadata->>'managed_whatsapp_message_distribution',
          'false'
        ))) in ('true', '1', 'yes')
        and btrim(coalesce(
          conflicting_lead.metadata->>'managed_whatsapp_initial_provider_event_id',
          ''
        )) = v_provider_event_id
    )
       or coalesce(v_pending_lead.initial_message, '')
            is distinct from coalesce(p_message, '') then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_provider_message_collision';
    end if;

    v_rule_id_text := btrim(coalesce(v_pending_lead.metadata->>'matched_rule_id', ''));
    v_round_robin_id_text := btrim(coalesce(
      v_pending_lead.metadata->>'target_round_robin_id',
      ''
    ));
    v_session_id_text := btrim(coalesce(
      v_pending_lead.metadata->>'whatsapp_session_id',
      ''
    ));

    if v_rule_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or v_round_robin_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or v_session_id_text is distinct from p_session_id::text then
      raise exception using
        errcode = '23514',
        message = 'managed_whatsapp_pending_context_invalid';
    end if;

    return jsonb_build_object(
      'handled', false,
      'pending', true,
      'reason', 'managed_whatsapp_intake_pending',
      'lead_id', v_pending_lead.id,
      'matched_rule_id', v_rule_id_text,
      'target_round_robin_id', v_round_robin_id_text,
      'managed_whatsapp_message_distribution', true,
      'provider_event_id', v_provider_event_id
    );
  end if;

  -- Existing leads do not receive a new immutable provider marker. For them,
  -- the inbound log is the pre-ledger provenance: runtimes persist the managed
  -- marker, chosen queue and content fingerprint before calling the intake RPC.
  select inbound_log.*
    into v_pending_log
    from public.whatsapp_inbound_logs as inbound_log
   where inbound_log.organization_id = p_organization_id
     and inbound_log.session_id = p_session_id
     and inbound_log.match_details->>'message_id' = v_provider_message_id
     and lower(btrim(coalesce(
       inbound_log.match_details->>'managed_whatsapp_message_distribution',
       'false'
     ))) in ('true', '1', 'yes')
   order by inbound_log.created_at, inbound_log.id
   limit 1;

  if not found then
    -- A legacy/non-managed log is also an immutable consumption marker. If
    -- its following message write never completed, quarantine the retry before
    -- today's rules can promote the old delivery into managed distribution.
    select inbound_log.*
      into v_legacy_log
      from public.whatsapp_inbound_logs as inbound_log
     where inbound_log.organization_id = p_organization_id
       and inbound_log.session_id = p_session_id
       and inbound_log.match_details->>'message_id' = v_provider_message_id
       and lower(btrim(coalesce(
         inbound_log.match_details->>'managed_whatsapp_message_distribution',
         'false'
       ))) not in ('true', '1', 'yes')
     order by inbound_log.created_at, inbound_log.id
     limit 1;

    if found and exists (
      select 1
      from public.whatsapp_inbound_logs as conflicting_legacy_log
      where conflicting_legacy_log.organization_id = p_organization_id
        and conflicting_legacy_log.session_id = p_session_id
        and conflicting_legacy_log.id <> v_legacy_log.id
        and conflicting_legacy_log.match_details->>'message_id' = v_provider_message_id
        and lower(btrim(coalesce(
          conflicting_legacy_log.match_details->>'managed_whatsapp_message_distribution',
          'false'
        ))) not in ('true', '1', 'yes')
        and (
          conflicting_legacy_log.lead_id is distinct from v_legacy_log.lead_id
          or conflicting_legacy_log.conversation_id
               is distinct from v_legacy_log.conversation_id
          or conflicting_legacy_log.matched_rule_id
               is distinct from v_legacy_log.matched_rule_id
          or btrim(coalesce(
            conflicting_legacy_log.match_details->>'message_fingerprint',
            ''
          )) is distinct from btrim(coalesce(
            v_legacy_log.match_details->>'message_fingerprint',
            ''
          ))
        )
    ) then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_provider_message_collision';
    end if;

    -- A delivery persisted by the legacy/non-managed path is already consumed.
    -- Resolve it before consulting current rules so a later configuration edit
    -- cannot retroactively turn an old inbound message into a managed entry.
    select message.*
      into v_legacy_message
      from public.whatsapp_messages as message
     where message.organization_id = p_organization_id
       and message.session_id = p_session_id
       and (
         message.provider_message_id = v_provider_message_id
         or (
           message.provider_message_id is null
           and message.message_id = v_provider_message_id
         )
       )
     order by message.created_at, message.id
     limit 1;

    if not found then
      if v_legacy_log.id is not null then
        return jsonb_build_object(
          'handled', false,
          'pending', false,
          'quarantined', true,
          'reason', 'legacy_whatsapp_intake_incomplete',
          'lead_id', v_legacy_log.lead_id,
          'matched_rule_id', null,
          'target_round_robin_id', null,
          'provider_event_id', v_provider_event_id
        );
      end if;

      return jsonb_build_object('handled', false, 'pending', false);
    end if;

    if coalesce(v_legacy_message.content, '')
         is distinct from coalesce(p_message, '')
       or coalesce(v_legacy_message.from_me, false) = true
       or lower(coalesce(v_legacy_message.direction, 'inbound')) = 'outbound'
       or (
         v_legacy_log.id is not null
         and (
           v_legacy_log.lead_id is distinct from v_legacy_message.lead_id
           or v_legacy_log.conversation_id
                is distinct from v_legacy_message.conversation_id
         )
       )
       or exists (
         select 1
         from public.whatsapp_messages as conflicting_legacy_message
         where conflicting_legacy_message.organization_id = p_organization_id
           and conflicting_legacy_message.session_id = p_session_id
           and (
             conflicting_legacy_message.provider_message_id = v_provider_message_id
             or (
               conflicting_legacy_message.provider_message_id is null
               and conflicting_legacy_message.message_id = v_provider_message_id
             )
           )
           and (
             coalesce(conflicting_legacy_message.content, '')
               is distinct from coalesce(p_message, '')
             or coalesce(conflicting_legacy_message.from_me, false) = true
             or lower(coalesce(
               conflicting_legacy_message.direction,
               'inbound'
             )) = 'outbound'
             or conflicting_legacy_message.lead_id
                  is distinct from v_legacy_message.lead_id
             or conflicting_legacy_message.conversation_id
                  is distinct from v_legacy_message.conversation_id
           )
       ) then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_provider_message_collision';
    end if;

    return jsonb_build_object(
      'handled', true,
      'pending', false,
      'duplicate_retry', true,
      'legacy_non_managed_retry', true,
      'reason', 'legacy_whatsapp_message_already_persisted',
      'lead_id', v_legacy_message.lead_id,
      'matched_rule_id', null,
      'target_round_robin_id', null,
      'provider_event_id', v_provider_event_id
    );
  end if;

  if exists (
    select 1
    from public.whatsapp_inbound_logs as conflicting_log
    where conflicting_log.organization_id = p_organization_id
      and conflicting_log.session_id = p_session_id
      and conflicting_log.id <> v_pending_log.id
      and conflicting_log.match_details->>'message_id' = v_provider_message_id
      and lower(btrim(coalesce(
        conflicting_log.match_details->>'managed_whatsapp_message_distribution',
        'false'
      ))) in ('true', '1', 'yes')
      and (
        conflicting_log.lead_id is distinct from v_pending_log.lead_id
        or conflicting_log.matched_rule_id is distinct from v_pending_log.matched_rule_id
        or btrim(coalesce(
          conflicting_log.match_details->>'target_round_robin_id',
          ''
        )) is distinct from btrim(coalesce(
          v_pending_log.match_details->>'target_round_robin_id',
          ''
        ))
        or btrim(coalesce(
          conflicting_log.match_details->>'message_fingerprint',
          ''
        )) is distinct from btrim(coalesce(
          v_pending_log.match_details->>'message_fingerprint',
          ''
        ))
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'managed_whatsapp_provider_message_collision';
  end if;

  v_rule_id_text := btrim(coalesce(v_pending_log.matched_rule_id::text, ''));
  v_round_robin_id_text := btrim(coalesce(
    v_pending_log.match_details->>'target_round_robin_id',
    ''
  ));
  v_log_message_fingerprint := btrim(coalesce(
    v_pending_log.match_details->>'message_fingerprint',
    ''
  ));

  if v_pending_log.lead_id is null
     or v_rule_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_round_robin_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not exists (
       select 1
       from public.leads as lead
       where lead.organization_id = p_organization_id
         and lead.id = v_pending_log.lead_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_pending_context_invalid';
  end if;

  if v_log_message_fingerprint <> ''
     and v_log_message_fingerprint is distinct from v_message_fingerprint then
    raise exception using
      errcode = '23505',
      message = 'managed_whatsapp_provider_message_collision';
  end if;

  select exists (
    select 1
    from public.whatsapp_messages as message
    where message.organization_id = p_organization_id
      and message.session_id = p_session_id
      and message.lead_id = v_pending_log.lead_id
      and message.conversation_id = v_pending_log.conversation_id
      and (
        message.provider_message_id = v_provider_message_id
        or (
          message.provider_message_id is null
          and message.message_id = v_provider_message_id
        )
      )
      and coalesce(message.from_me, false) = false
      and lower(coalesce(message.direction, 'inbound')) <> 'outbound'
      and coalesce(message.content, '') is not distinct from coalesce(p_message, '')
  ) into v_has_persisted_message;

  if exists (
    select 1
    from public.whatsapp_messages as conflicting_message
    where conflicting_message.organization_id = p_organization_id
      and conflicting_message.session_id = p_session_id
      and (
        conflicting_message.provider_message_id = v_provider_message_id
        or (
          conflicting_message.provider_message_id is null
          and conflicting_message.message_id = v_provider_message_id
        )
      )
      and (
        conflicting_message.lead_id is distinct from v_pending_log.lead_id
        or conflicting_message.conversation_id
             is distinct from v_pending_log.conversation_id
        or coalesce(conflicting_message.content, '')
             is distinct from coalesce(p_message, '')
        or coalesce(conflicting_message.from_me, false) = true
        or lower(coalesce(conflicting_message.direction, 'inbound')) = 'outbound'
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'managed_whatsapp_provider_message_collision';
  end if;

  if v_log_message_fingerprint = '' and not v_has_persisted_message then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_pending_message_evidence_missing';
  end if;

  return jsonb_build_object(
    'handled', false,
    'pending', true,
    'reason', 'managed_whatsapp_intake_pending',
    'lead_id', v_pending_log.lead_id,
    'matched_rule_id', v_rule_id_text,
    'target_round_robin_id', v_round_robin_id_text,
    'managed_whatsapp_message_distribution', true,
    'provider_event_id', v_provider_event_id
  );
end;
$$;

revoke all on function public.lookup_managed_whatsapp_lead_entry(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.lookup_managed_whatsapp_lead_entry(
  uuid, uuid, text, text
) to service_role;

-- Keep the initial managed intake immutable. The provider event id is added to
-- the protected provenance set so a later webhook cannot turn itself into the
-- first message simply by merging lead metadata.
create or replace function private.preserve_managed_whatsapp_lead_intake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_metadata jsonb := coalesce(old.metadata, '{}'::jsonb);
  v_new_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_old_marker boolean;
  v_new_marker boolean;
  v_key text;
begin
  v_old_marker := lower(btrim(coalesce(
    v_old_metadata->>'managed_whatsapp_message_distribution',
    'false'
  ))) in ('true', '1', 'yes');
  v_new_marker := lower(btrim(coalesce(
    v_new_metadata->>'managed_whatsapp_message_distribution',
    'false'
  ))) in ('true', '1', 'yes');

  if not v_old_marker and not v_new_marker then
    return new;
  end if;

  if jsonb_typeof(v_old_metadata) <> 'object'
     or jsonb_typeof(v_new_metadata) <> 'object' then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_metadata_must_be_object';
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_organization_immutable';
  end if;

  foreach v_key in array array[
    'managed_whatsapp_message_distribution',
    'managed_whatsapp_initial_provider_event_id',
    'matched_rule_id',
    'whatsapp_session_id',
    'target_round_robin_id',
    'target_team_id'
  ]
  loop
    v_new_metadata := v_new_metadata - v_key;
    if v_old_metadata ? v_key then
      v_new_metadata := v_new_metadata
        || jsonb_build_object(v_key, v_old_metadata->v_key);
    end if;
  end loop;

  new.metadata := v_new_metadata;
  new.source := old.source;
  new.source_session_id := old.source_session_id;
  new.initial_message := old.initial_message;
  return new;
end;
$$;

revoke all on function private.preserve_managed_whatsapp_lead_intake()
from public, anon, authenticated, service_role;

drop trigger if exists preserve_managed_whatsapp_lead_intake on public.leads;
create trigger preserve_managed_whatsapp_lead_intake
before update of organization_id, source, source_session_id, initial_message, metadata
on public.leads
for each row
execute function private.preserve_managed_whatsapp_lead_intake();

-- Output tags are stored in round_robins.settings.auto_tag_ids. Invalid or
-- deleted ids are ignored at execution time; tenant ownership is enforced by
-- joining both the queue and every tag to the same organization.
create or replace function private.apply_round_robin_auto_tags(
  p_organization_id uuid,
  p_round_robin_id uuid,
  p_lead_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_applied integer := 0;
begin
  if p_organization_id is null
     or p_round_robin_id is null
     or p_lead_id is null then
    return 0;
  end if;

  insert into public.lead_tags (organization_id, lead_id, tag_id)
  select
    p_organization_id,
    p_lead_id,
    valid_tag.id
  from public.round_robins as queue
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(queue.settings->'auto_tag_ids') = 'array'
        then queue.settings->'auto_tag_ids'
      else '[]'::jsonb
    end
  ) with ordinality as requested_tag(value, ordinality)
  join public.tags as valid_tag
    on valid_tag.organization_id = queue.organization_id
   and lower(valid_tag.id::text) = lower(btrim(requested_tag.value))
  where queue.organization_id = p_organization_id
    and queue.id = p_round_robin_id
    and coalesce(queue.is_active, true) = true
    and requested_tag.ordinality <= 50
    and exists (
      select 1
      from public.leads as lead
      where lead.organization_id = p_organization_id
        and lead.id = p_lead_id
    )
  group by valid_tag.id
  on conflict (lead_id, tag_id) do nothing;

  select count(distinct valid_tag.id)::integer
    into v_applied
    from public.round_robins as queue
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(queue.settings->'auto_tag_ids') = 'array'
          then queue.settings->'auto_tag_ids'
        else '[]'::jsonb
      end
    ) with ordinality as requested_tag(value, ordinality)
    join public.tags as valid_tag
      on valid_tag.organization_id = queue.organization_id
     and lower(valid_tag.id::text) = lower(btrim(requested_tag.value))
    join public.lead_tags as attached_tag
      on attached_tag.lead_id = p_lead_id
     and attached_tag.tag_id = valid_tag.id
     and attached_tag.organization_id = p_organization_id
   where queue.organization_id = p_organization_id
     and queue.id = p_round_robin_id
     and coalesce(queue.is_active, true) = true
     and requested_tag.ordinality <= 50;

  return v_applied;
end;
$$;

revoke all on function private.apply_round_robin_auto_tags(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function private.apply_round_robin_auto_tags_from_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is not null
     and new.round_robin_id is not null
     and new.lead_id is not null
     and (
       new.assigned_user_id is not null
       or coalesce(new.reason, '') = 'no_available_members'
     ) then
    perform private.apply_round_robin_auto_tags(
      new.organization_id,
      new.round_robin_id,
      new.lead_id
    );
  end if;
  return new;
end;
$$;

revoke all on function private.apply_round_robin_auto_tags_from_log()
from public, anon, authenticated, service_role;

drop trigger if exists trg_apply_round_robin_auto_tags
on public.round_robin_logs;
create trigger trg_apply_round_robin_auto_tags
after insert on public.round_robin_logs
for each row
execute function private.apply_round_robin_auto_tags_from_log();

-- The canonical distributor previously used a lead/user-only notification
-- dedupe key. Scope it to the durable distribution event so the same broker can
-- legitimately receive the same lead again in a later reentry cycle.
create or replace function private.scope_distribution_notification_dedupe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_distribution_event_id text;
begin
  v_distribution_event_id := btrim(coalesce(
    new.metadata->>'distribution_event_id',
    ''
  ));

  if coalesce(new.metadata->>'event_key', '') = 'new_lead_received'
     and v_distribution_event_id <> '' then
    new.metadata := jsonb_set(
      coalesce(new.metadata, '{}'::jsonb),
      '{dedupe_key}',
      to_jsonb(
        concat_ws(
          ':',
          'new_lead_received',
          new.lead_id::text,
          new.user_id::text,
          v_distribution_event_id
        )
      ),
      true
    );
  end if;
  return new;
end;
$$;

revoke all on function private.scope_distribution_notification_dedupe()
from public, anon, authenticated, service_role;

drop trigger if exists trg_scope_distribution_notification_dedupe
on public.notifications;
create trigger trg_scope_distribution_notification_dedupe
before insert on public.notifications
for each row
execute function private.scope_distribution_notification_dedupe();

-- A lead received outside the queue schedule has no assignee yet, so the
-- existing redistribution enrollment trigger cannot track it. The same durable
-- job can also represent a redistribute reentry whose old assignee was retained;
-- explicit metadata keeps those two worker modes separate.
create or replace function private.enqueue_managed_whatsapp_initial_distribution(
  p_organization_id uuid,
  p_round_robin_id uuid,
  p_lead_id uuid,
  p_entry_event_id uuid,
  p_now timestamptz default clock_timestamp(),
  p_allow_assigned_redistribution boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
  v_timeout_minutes integer;
  v_warning_minutes integer;
  v_max_attempts integer;
  v_job_id uuid;
  v_job_assigned_user_id uuid;
  v_allow_assigned_redistribution boolean := false;
begin
  select lead.assigned_user_id
    into v_job_assigned_user_id
    from public.leads as lead
   where lead.organization_id = p_organization_id
     and lead.id = p_lead_id
   for no key update;

  if not found then
    return null;
  end if;

  v_allow_assigned_redistribution :=
    coalesce(p_allow_assigned_redistribution, false)
    and v_job_assigned_user_id is not null;

  select coalesce(queue.settings, '{}'::jsonb)
    into v_settings
    from public.round_robins as queue
   where queue.organization_id = p_organization_id
     and queue.id = p_round_robin_id
     and coalesce(queue.is_active, true) = true;

  if not found then
    return null;
  end if;

  v_timeout_minutes := least(10080, greatest(1, coalesce(
    case when coalesce(v_settings->>'redistribution_timeout_minutes', '') ~ '^[0-9]{1,9}$'
      then (v_settings->>'redistribution_timeout_minutes')::integer end,
    20
  )));
  v_warning_minutes := greatest(0, coalesce(
    case when coalesce(v_settings->>'redistribution_warning_minutes', '') ~ '^[0-9]{1,9}$'
      then (v_settings->>'redistribution_warning_minutes')::integer end,
    5
  ));
  v_warning_minutes := least(v_warning_minutes, v_timeout_minutes - 1);
  v_max_attempts := least(1000, greatest(0, coalesce(
    case when coalesce(v_settings->>'redistribution_max_attempts', '') ~ '^[0-9]{1,9}$'
      then (v_settings->>'redistribution_max_attempts')::integer end,
    10
  )));

  insert into public.lead_redistribution_jobs (
    organization_id,
    lead_id,
    round_robin_id,
    original_assigned_user_id,
    current_assigned_user_id,
    max_attempts,
    timeout_minutes,
    warning_minutes,
    enrolled_at,
    due_at,
    warning_due_at,
    metadata
  )
  values (
    p_organization_id,
    p_lead_id,
    p_round_robin_id,
    case when v_allow_assigned_redistribution then v_job_assigned_user_id else null end,
    case when v_allow_assigned_redistribution then v_job_assigned_user_id else null end,
    v_max_attempts,
    v_timeout_minutes,
    v_warning_minutes,
    coalesce(p_now, clock_timestamp()),
    coalesce(p_now, clock_timestamp()),
    null,
    jsonb_build_object(
      'source', 'managed_whatsapp',
      'initial_distribution_pending', true,
      'allow_assigned_redistribution', v_allow_assigned_redistribution,
      'entry_event_id', p_entry_event_id
    )
  )
  on conflict do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select job.id
      into v_job_id
      from public.lead_redistribution_jobs as job
     where job.organization_id = p_organization_id
       and job.lead_id = p_lead_id
       and job.status in ('pending', 'warning_sent')
     order by job.created_at, job.id
     limit 1;
  end if;

  return v_job_id;
end;
$$;

revoke all on function private.enqueue_managed_whatsapp_initial_distribution(
  uuid, uuid, uuid, uuid, timestamptz, boolean
) from public, anon, authenticated, service_role;

create or replace function public.process_managed_whatsapp_lead_entry(
  p_organization_id uuid,
  p_lead_id uuid,
  p_session_id uuid,
  p_rule_id uuid,
  p_provider_message_id text,
  p_message text,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_occurred_at timestamptz;
  v_provider_message_id text := btrim(coalesce(p_provider_message_id, ''));
  v_provider_event_id text;
  v_distribution_key text;
  v_message_fingerprint text;
  v_effective_rule_id uuid := p_rule_id;
  v_pending_context jsonb := '{}'::jsonb;
  v_pending_round_robin_id uuid;
  v_has_pending_context boolean := false;
  v_lead public.leads%rowtype;
  v_existing_entry public.lead_entry_events%rowtype;
  v_initial_entry public.lead_entry_events%rowtype;
  v_entry_id uuid;
  v_initial_entry_id uuid;
  v_round_robin_id uuid;
  v_keyword text;
  v_reentry_behavior text;
  v_initial_provider_event_id text;
  v_last_provider_event_id text;
  v_is_initial boolean := false;
  v_should_apply_state boolean := true;
  v_previous_job public.lead_redistribution_jobs%rowtype;
  v_had_previous_job boolean := false;
  v_previous_assigned_user_id uuid;
  v_assigned_user_id uuid;
  v_same_assignee_redistribution boolean := false;
  v_pending_job_id uuid;
  v_pending_queue_settings jsonb;
  v_pending_timeout_minutes integer;
  v_pending_warning_minutes integer;
  v_pending_max_attempts integer;
  v_tags_applied integer := 0;
  v_initial_distribution_result jsonb;
  v_distribution_result jsonb := '{}'::jsonb;
  v_intake_result jsonb;
  v_event_metadata jsonb;
begin
  if p_organization_id is null
     or p_lead_id is null
     or p_session_id is null
     or length(v_provider_message_id) not between 1 and 500
     or p_provider_message_id <> v_provider_message_id
     or nullif(btrim(coalesce(p_message, '')), '') is null
     or octet_length(p_message) > 65536 then
    raise exception using
      errcode = '22023',
      message = 'managed_whatsapp_entry_invalid_input';
  end if;

  v_occurred_at := least(
    coalesce(p_occurred_at, v_now),
    v_now + interval '5 minutes'
  );
  v_provider_event_id := p_session_id::text || ':' || v_provider_message_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'managed-whatsapp-entry:'
        || p_organization_id::text || ':' || v_provider_event_id,
      0
    )
  );

  select lead.*
    into v_lead
    from public.leads as lead
   where lead.organization_id = p_organization_id
     and lead.id = p_lead_id
   for no key update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'managed_whatsapp_entry_lead_not_found';
  end if;

  -- The immutable provider message is the idempotency boundary. Resolve it
  -- before checking mutable rule/queue state, so a later configuration change
  -- cannot turn an already committed delivery into an endless retry.
  v_message_fingerprint := private.managed_whatsapp_message_fingerprint(
    p_organization_id,
    p_session_id,
    v_provider_message_id,
    p_message
  );
  v_distribution_key := 'managed-whatsapp-entry:' || pg_catalog.encode(
    extensions.digest(v_provider_event_id, 'sha256'),
    'hex'
  );

  select entry.*
    into v_existing_entry
    from public.lead_entry_events as entry
   where entry.organization_id = p_organization_id
     and entry.provider = 'whatsapp'
     and entry.provider_event_id = v_provider_event_id
     and entry.is_countable = true
   limit 1
   for update;

  if found then
    if v_existing_entry.lead_id is distinct from p_lead_id
       or coalesce(v_existing_entry.metadata->>'message_fingerprint', '')
          is distinct from v_message_fingerprint
       or coalesce(v_existing_entry.metadata->>'whatsapp_session_id', '')
          is distinct from p_session_id::text then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_provider_message_collision';
    end if;

    return (
      case
        when jsonb_typeof(v_existing_entry.metadata->'intake_result') = 'object'
          then v_existing_entry.metadata->'intake_result'
        else jsonb_build_object(
          'success', false,
          'reason', 'managed_whatsapp_ledger_result_missing'
        )
      end
    ) || jsonb_build_object(
      'handled', true,
      'pending', false,
      'duplicate_retry', true,
      'lead_id', v_existing_entry.lead_id,
      'entry_event_id', v_existing_entry.id,
      'matched_rule_id', nullif(v_existing_entry.metadata->>'matched_rule_id', ''),
      'target_round_robin_id', nullif(coalesce(
        v_existing_entry.metadata->>'target_round_robin_id',
        v_existing_entry.metadata->'intake_result'->>'round_robin_id'
      ), '')
    );
  end if;

  -- A new lifecycle event must correspond to the inbound message already
  -- persisted by the authenticated webhook path. Exact retries returned above
  -- remain valid even if old message history is later archived.
  if not exists (
    select 1
    from public.whatsapp_messages as message
    where message.organization_id = p_organization_id
      and message.session_id = p_session_id
      and message.lead_id = p_lead_id
      and (
        message.provider_message_id = v_provider_message_id
        or (
          message.provider_message_id is null
          and message.message_id = v_provider_message_id
        )
      )
      and coalesce(message.from_me, false) = false
      and lower(coalesce(message.direction, 'inbound')) <> 'outbound'
      and coalesce(message.content, '') is not distinct from coalesce(p_message, '')
  ) then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_entry_message_not_persisted';
  end if;

  -- Bind an unfinished delivery to the immutable context captured before the
  -- ledger write. This intentionally runs before any current rule lookup. A
  -- caller may omit p_rule_id on retry; if it supplies one, it must be the
  -- original rule recovered from lead/log provenance.
  v_pending_context := public.lookup_managed_whatsapp_lead_entry(
    p_organization_id,
    p_session_id,
    v_provider_message_id,
    p_message
  );
  v_has_pending_context := lower(coalesce(v_pending_context->>'pending', 'false'))
    in ('true', '1', 'yes');

  if v_has_pending_context then
    if coalesce(v_pending_context->>'lead_id', '') is distinct from p_lead_id::text then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_provider_message_collision';
    end if;

    begin
      v_effective_rule_id := nullif(
        btrim(v_pending_context->>'matched_rule_id'),
        ''
      )::uuid;
      v_pending_round_robin_id := nullif(
        btrim(v_pending_context->>'target_round_robin_id'),
        ''
      )::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '23514',
          message = 'managed_whatsapp_pending_context_invalid';
    end;

    if v_effective_rule_id is null
       or v_pending_round_robin_id is null
       or (
         p_rule_id is not null
         and p_rule_id is distinct from v_effective_rule_id
       ) then
      raise exception using
        errcode = '23514',
        message = 'managed_whatsapp_pending_context_invalid';
    end if;
  elsif p_rule_id is null then
    raise exception using
      errcode = '22023',
      message = 'managed_whatsapp_entry_invalid_input';
  end if;

  if v_has_pending_context then
    select
      queue.id,
      case
        when lower(btrim(coalesce(queue.reentry_behavior, 'redistribute')))
          = 'keep_assignee' then 'keep_assignee'
        else 'redistribute'
      end,
      ''::text
      into v_round_robin_id, v_reentry_behavior, v_keyword
      from public.round_robins as queue
      join public.whatsapp_sessions as whatsapp_session
        on whatsapp_session.organization_id = queue.organization_id
       and whatsapp_session.id = p_session_id
     where queue.organization_id = p_organization_id
       and queue.id = v_pending_round_robin_id
       and coalesce(queue.is_active, true) = true
       and whatsapp_session.provider = 'evolution_go'
       and coalesce(whatsapp_session.is_active, true) = true
       and lower(btrim(coalesce(whatsapp_session.status, '')))
         not in ('deleted', 'disabled')
     limit 1
     for no key update of queue;
  else
    select
      queue.id,
      case
        when lower(btrim(coalesce(queue.reentry_behavior, 'redistribute')))
          = 'keep_assignee' then 'keep_assignee'
        else 'redistribute'
      end,
      normalized.keyword
      into v_round_robin_id, v_reentry_behavior, v_keyword
      from public.round_robin_rules as round_robin_rule
      join public.whatsapp_inbound_rules as inbound_rule
        on inbound_rule.organization_id = round_robin_rule.organization_id
       and inbound_rule.id = round_robin_rule.id
       and inbound_rule.target_round_robin_id = round_robin_rule.round_robin_id
      join public.round_robins as queue
        on queue.organization_id = round_robin_rule.organization_id
       and queue.id = round_robin_rule.round_robin_id
      join public.whatsapp_sessions as whatsapp_session
        on whatsapp_session.organization_id = inbound_rule.organization_id
       and whatsapp_session.id = inbound_rule.session_id
      cross join lateral (
        select btrim(coalesce(
          nullif(round_robin_rule.match_value, ''),
          round_robin_rule.conditions->>'match_value',
          ''
        )) as keyword
      ) as normalized
     where round_robin_rule.organization_id = p_organization_id
       and round_robin_rule.id = v_effective_rule_id
       and inbound_rule.session_id = p_session_id
       and coalesce(round_robin_rule.is_active, true) = true
       and coalesce(inbound_rule.is_active, true) = true
       and coalesce(queue.is_active, true) = true
       and whatsapp_session.provider = 'evolution_go'
       and coalesce(whatsapp_session.is_active, true) = true
       and lower(btrim(coalesce(whatsapp_session.status, '')))
         not in ('deleted', 'disabled')
       and coalesce(
         nullif(round_robin_rule.match_type, ''),
         round_robin_rule.conditions->>'match_type',
         round_robin_rule.name,
         ''
       ) = 'whatsapp_message_contains'
       and coalesce(
         nullif(btrim(round_robin_rule.match->>'whatsapp_session_id'), ''),
         nullif(btrim(round_robin_rule.conditions->'match'->>'whatsapp_session_id'), '')
       ) = p_session_id::text
       and lower(btrim(coalesce(inbound_rule.match_type, ''))) = 'contains'
       and lower(btrim(coalesce(inbound_rule.match_field, 'message'))) = 'message'
       and normalized.keyword <> ''
       and lower(btrim(coalesce(inbound_rule.match_value, '')))
         = lower(normalized.keyword)
       and lower(btrim(coalesce(queue.settings->>'require_checkin', 'false')))
         not in ('true', '1', 'yes')
       and position(lower(normalized.keyword) in lower(p_message)) > 0
     limit 1
     for no key update of queue;
  end if;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'managed_whatsapp_entry_context_invalid';
  end if;

  v_initial_provider_event_id := btrim(coalesce(
    v_lead.metadata->>'managed_whatsapp_initial_provider_event_id',
    ''
  ));
  v_last_provider_event_id := btrim(coalesce(
    v_lead.metadata->>'last_whatsapp_provider_event_id',
    ''
  ));
  v_is_initial := v_initial_provider_event_id = v_provider_event_id;

  select entry.*
    into v_initial_entry
    from public.lead_entry_events as entry
   where entry.organization_id = p_organization_id
     and entry.lead_id = p_lead_id
     and entry.entry_type = 'initial'
   order by entry.created_at, entry.id
   limit 1
   for update;
  if found then
    v_initial_entry_id := v_initial_entry.id;
  end if;

  -- Compatibility for managed leads created by the previous image: the
  -- provider id was not persisted yet, but its original timestamp/message can
  -- still identify a replay without turning it into a false reentry.
  if not v_is_initial
     and v_initial_provider_event_id = ''
     and lower(btrim(coalesce(v_lead.source, ''))) = 'whatsapp'
     and v_lead.source_session_id = p_session_id
     and lower(btrim(coalesce(
       v_lead.metadata->>'managed_whatsapp_message_distribution',
       'false'
     ))) in ('true', '1', 'yes')
     and coalesce(v_lead.metadata->>'whatsapp_session_id', '') = p_session_id::text
     and coalesce(v_lead.metadata->>'matched_rule_id', '') = v_effective_rule_id::text
     and coalesce(v_lead.metadata->>'target_round_robin_id', '') = v_round_robin_id::text
     and btrim(coalesce(v_lead.initial_message, '')) = btrim(p_message)
     and abs(extract(epoch from (v_lead.created_at - v_occurred_at))) <= 600
     and v_initial_entry_id is not null
     and coalesce(v_initial_entry.provider, 'whatsapp') = 'whatsapp'
     and (
       v_initial_entry.provider_event_id is null
       or v_initial_entry.provider_event_id in (
         v_provider_event_id,
         v_provider_message_id
       )
     )
     and not exists (
       select 1
       from public.lead_entry_events as prior_reentry
       where prior_reentry.organization_id = p_organization_id
         and prior_reentry.lead_id = p_lead_id
         and prior_reentry.entry_type = 'reentry'
         and prior_reentry.is_countable = true
     ) then
    v_is_initial := true;
  end if;

  v_event_metadata := jsonb_build_object(
    'managed_whatsapp_message_distribution', true,
    'whatsapp_session_id', p_session_id,
    'matched_rule_id', v_effective_rule_id,
    'target_round_robin_id', v_round_robin_id,
    'provider_message_id', v_provider_message_id,
    'message_fingerprint', v_message_fingerprint,
    'keyword', v_keyword
  );

  if v_is_initial then
    if v_initial_entry_id is null then
      raise exception using
        errcode = '55000',
        message = 'managed_whatsapp_initial_entry_missing';
    end if;

    -- Establish the same chronological projection used by later reentries,
    -- without incrementing reentry_count. A newer provider event may already
    -- have won while the first webhook was between its database calls; in that
    -- case only the monotonic contact/entry timestamps are retained.
    v_should_apply_state :=
      v_lead.last_entry_at is null
      or v_occurred_at > v_lead.last_entry_at
      or (
        v_occurred_at = v_lead.last_entry_at
        and v_provider_event_id > v_last_provider_event_id
      );

    update public.leads as lead
       set message = case
             when v_should_apply_state then p_message
             else lead.message
           end,
           last_contact_at = greatest(
             coalesce(lead.last_contact_at, v_occurred_at),
             v_occurred_at
           ),
           last_entry_at = greatest(
             coalesce(lead.last_entry_at, v_occurred_at),
             v_occurred_at
           ),
           metadata = case
             when v_should_apply_state then
               coalesce(lead.metadata, '{}'::jsonb) || jsonb_build_object(
                 'last_whatsapp_session_id', p_session_id,
                 'last_whatsapp_provider_event_id', v_provider_event_id,
                 'last_whatsapp_entry_event_id', v_initial_entry_id
               )
             else coalesce(lead.metadata, '{}'::jsonb)
           end,
           updated_at = v_now
     where lead.organization_id = p_organization_id
       and lead.id = p_lead_id;

    v_assigned_user_id := v_lead.assigned_user_id;

    -- Initial assignment was performed by the lead INSERT trigger. Read its
    -- canonical ledger instead of reporting a fixed success that could hide a
    -- no-available-members outcome. Both keys cover the known canonical and
    -- managed routing entrypoints used by the production baseline.
    select distribution_event.result
      into v_initial_distribution_result
      from private.lead_distribution_events as distribution_event
     where distribution_event.organization_id = p_organization_id
       and distribution_event.lead_id = p_lead_id
       and distribution_event.idempotency_key in (
         'managed-whatsapp:' || p_lead_id::text || ':' || v_effective_rule_id::text,
         'trigger:' || p_lead_id::text
       )
       and distribution_event.outcome <> 'processing'
     order by
       case
         when distribution_event.idempotency_key =
            'managed-whatsapp:' || p_lead_id::text || ':' || v_effective_rule_id::text
           then 0
         else 1
       end,
       distribution_event.completed_at desc nulls last,
       distribution_event.created_at desc,
       distribution_event.id desc
     limit 1;

    if v_initial_distribution_result is null
       or jsonb_typeof(v_initial_distribution_result) <> 'object'
       or not (v_initial_distribution_result ? 'success') then
      v_initial_distribution_result := jsonb_build_object(
        'success', v_assigned_user_id is not null,
        'reason', case
          when v_assigned_user_id is not null then 'assigned_state_observed'
          else 'initial_distribution_result_missing'
        end,
        'lead_id', p_lead_id,
        'round_robin_id', v_round_robin_id,
        'assigned_user_id', v_assigned_user_id
      );
    end if;

    v_tags_applied := private.apply_round_robin_auto_tags(
      p_organization_id,
      v_round_robin_id,
      p_lead_id
    );

    -- Only the chronologically current initial event may create a pending
    -- distribution job. If a newer message already assigned the lead, replaying
    -- the initial webhook must not supersede that newer lifecycle state.
    v_pending_job_id := null;
    if v_should_apply_state and v_assigned_user_id is null then
      select job.id
        into v_pending_job_id
        from public.lead_redistribution_jobs as job
       where job.organization_id = p_organization_id
         and job.lead_id = p_lead_id
         and job.status in ('pending', 'warning_sent')
       order by job.created_at, job.id
       limit 1
       for update;

      if v_pending_job_id is null then
        v_pending_job_id := private.enqueue_managed_whatsapp_initial_distribution(
          p_organization_id,
          v_round_robin_id,
          p_lead_id,
          v_initial_entry_id,
          v_now
        );
      end if;

      if v_pending_job_id is null then
        raise exception using
          errcode = '55000',
          message = 'managed_whatsapp_pending_distribution_job_missing';
      end if;
    end if;

    v_intake_result := jsonb_build_object(
      'handled', true,
      'initial_distribution_result', v_initial_distribution_result
    ) || v_initial_distribution_result || jsonb_build_object(
      'handled', true,
      'entry_type', 'initial',
      'lead_id', p_lead_id,
      'entry_event_id', v_initial_entry_id,
      'round_robin_id', v_round_robin_id,
      'assigned_user_id', v_assigned_user_id,
      'applied_to_current_state', v_should_apply_state,
      'tags_applied', v_tags_applied
    );

    if v_pending_job_id is not null then
      v_intake_result := v_intake_result || jsonb_build_object(
        'distribution_pending', true,
        'pending_distribution_job_id', v_pending_job_id
      );
    end if;

    update public.lead_entry_events as entry
       set source = 'whatsapp',
           provider = 'whatsapp',
           provider_event_id = v_provider_event_id,
           occurred_at = v_occurred_at,
           is_countable = true,
           source_detail = coalesce(nullif(entry.source_detail, ''), 'managed_whatsapp_message'),
           metadata = coalesce(entry.metadata, '{}'::jsonb)
             || v_event_metadata
             || jsonb_build_object('intake_result', v_intake_result)
     where entry.id = v_initial_entry_id
       and (
         entry.provider_event_id is null
         or entry.provider_event_id in (
           v_provider_event_id,
           v_provider_message_id
         )
       );

    if not found then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_initial_provider_message_conflict';
    end if;

    update public.whatsapp_conversations as conversation
       set assigned_user_id = v_assigned_user_id,
           updated_at = v_now
     where conversation.organization_id = p_organization_id
       and conversation.session_id = p_session_id
       and conversation.lead_id = p_lead_id;

    update public.whatsapp_inbound_logs as inbound_log
       set lead_id = p_lead_id,
           matched_rule_id = v_effective_rule_id,
           assigned_user_id = v_assigned_user_id,
           match_details = coalesce(inbound_log.match_details, '{}'::jsonb)
             || jsonb_build_object(
               'entry_event_id', v_initial_entry_id,
               'intake_outcome', v_intake_result->>'reason',
               'distribution_pending', v_pending_job_id is not null,
               'pending_distribution_job_id', v_pending_job_id
             )
     where inbound_log.organization_id = p_organization_id
       and inbound_log.session_id = p_session_id
       and inbound_log.match_details->>'message_id' = v_provider_message_id;

    return v_intake_result;
  end if;

  insert into public.lead_entry_events (
    organization_id,
    lead_id,
    source,
    provider,
    provider_event_id,
    occurred_at,
    is_countable,
    source_detail,
    entry_type,
    pipeline_id,
    stage_id,
    metadata
  )
  values (
    p_organization_id,
    p_lead_id,
    'whatsapp',
    'whatsapp',
    v_provider_event_id,
    v_occurred_at,
    true,
    'managed_whatsapp_message',
    'reentry',
    v_lead.pipeline_id,
    v_lead.stage_id,
    v_event_metadata
  )
  on conflict (organization_id, provider, provider_event_id)
    where provider_event_id is not null and is_countable = true
  do nothing
  returning id into v_entry_id;

  if v_entry_id is null then
    select entry.*
      into v_existing_entry
      from public.lead_entry_events as entry
     where entry.organization_id = p_organization_id
       and entry.provider = 'whatsapp'
       and entry.provider_event_id = v_provider_event_id
       and entry.is_countable = true
     limit 1;

    if not found
       or v_existing_entry.lead_id is distinct from p_lead_id
       or coalesce(v_existing_entry.metadata->>'message_fingerprint', '')
          is distinct from v_message_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_provider_message_collision';
    end if;

    return (
      case
        when jsonb_typeof(v_existing_entry.metadata->'intake_result') = 'object'
          then v_existing_entry.metadata->'intake_result'
        else jsonb_build_object(
          'success', false,
          'reason', 'managed_whatsapp_ledger_result_missing'
        )
      end
    ) || jsonb_build_object(
      'handled', true,
      'pending', false,
      'duplicate_retry', true,
      'lead_id', v_existing_entry.lead_id,
      'entry_event_id', v_existing_entry.id,
      'matched_rule_id', nullif(v_existing_entry.metadata->>'matched_rule_id', ''),
      'target_round_robin_id', nullif(coalesce(
        v_existing_entry.metadata->>'target_round_robin_id',
        v_existing_entry.metadata->'intake_result'->>'round_robin_id'
      ), '')
    );
  end if;

  v_should_apply_state :=
    v_lead.last_entry_at is null
    or v_occurred_at > v_lead.last_entry_at
    or (
      v_occurred_at = v_lead.last_entry_at
      and v_provider_event_id > v_last_provider_event_id
    );

  update public.leads as lead
     set message = case
           when v_should_apply_state then p_message
           else lead.message
         end,
         last_contact_at = greatest(
           coalesce(lead.last_contact_at, v_occurred_at),
           v_occurred_at
         ),
         last_entry_at = greatest(
           coalesce(lead.last_entry_at, v_occurred_at),
           v_occurred_at
         ),
         reentry_count = coalesce(lead.reentry_count, 0) + 1,
         metadata = case
           when v_should_apply_state then
             coalesce(lead.metadata, '{}'::jsonb) || jsonb_build_object(
               'last_whatsapp_session_id', p_session_id,
               'last_whatsapp_provider_event_id', v_provider_event_id,
               'last_whatsapp_entry_event_id', v_entry_id
             )
           else coalesce(lead.metadata, '{}'::jsonb)
         end,
         updated_at = v_now
   where lead.organization_id = p_organization_id
     and lead.id = p_lead_id;

  insert into public.lead_timeline_events (
    organization_id,
    lead_id,
    event_type,
    title,
    description,
    metadata,
    event_at
  )
  values (
    p_organization_id,
    p_lead_id,
    'lead_reentry',
    'Lead reentrou pelo WhatsApp',
    'Uma nova mensagem compatível com a fila iniciou uma nova entrada.',
    v_event_metadata || jsonb_build_object(
      'entry_event_id', v_entry_id,
      'reentry_behavior', v_reentry_behavior,
      'applied_to_current_state', v_should_apply_state
    ),
    v_occurred_at
  );

  if not v_should_apply_state then
    v_tags_applied := private.apply_round_robin_auto_tags(
      p_organization_id,
      v_round_robin_id,
      p_lead_id
    );
    v_intake_result := jsonb_build_object(
      'handled', true,
      'success', true,
      'reason', 'stale_reentry_recorded',
      'entry_type', 'reentry',
      'lead_id', p_lead_id,
      'entry_event_id', v_entry_id,
      'round_robin_id', v_round_robin_id,
      'tags_applied', v_tags_applied
    );

    update public.lead_entry_events
       set metadata = metadata || jsonb_build_object('intake_result', v_intake_result)
     where id = v_entry_id;
    return v_intake_result;
  end if;

  select job.*
    into v_previous_job
    from public.lead_redistribution_jobs as job
   where job.organization_id = p_organization_id
     and job.lead_id = p_lead_id
     and job.status in ('pending', 'warning_sent')
   limit 1
   for update;
  v_had_previous_job := found;
  v_previous_assigned_user_id := v_lead.assigned_user_id;

  if v_had_previous_job then
    update public.lead_redistribution_jobs
       set status = 'stopped',
           stopped_at = v_now,
           stopped_reason = 'superseded_by_whatsapp_reentry',
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'superseded_by_entry_event_id', v_entry_id,
             'superseded_by_provider_event_id', v_provider_event_id
           ),
           updated_at = v_now
     where id = v_previous_job.id;
  end if;

  v_distribution_result := private.distribute_lead(
    p_organization_id,
    p_lead_id,
    v_distribution_key,
    v_round_robin_id,
    v_reentry_behavior = 'keep_assignee',
    'whatsapp',
    v_now
  );

  select lead.assigned_user_id
    into v_assigned_user_id
    from public.leads as lead
   where lead.organization_id = p_organization_id
     and lead.id = p_lead_id;

  v_same_assignee_redistribution :=
    v_reentry_behavior = 'redistribute'
    and v_assigned_user_id is not distinct from v_previous_assigned_user_id;

  if v_same_assignee_redistribution then
    v_distribution_result := coalesce(v_distribution_result, '{}'::jsonb)
      || jsonb_build_object(
        'success', false,
        'reason', case
          when lower(coalesce(v_distribution_result->>'success', 'false'))
            in ('true', '1', 'yes')
            then 'redistribution_pending_same_assignee'
          else coalesce(
            nullif(v_distribution_result->>'reason', ''),
            'redistribution_pending_same_assignee'
          )
        end,
        'assigned_user_id', v_assigned_user_id
      );
  end if;

  v_pending_job_id := null;

  if v_reentry_behavior = 'keep_assignee'
     and v_assigned_user_id is not null
     and coalesce(v_distribution_result->>'reason', '') = 'already_assigned' then
    insert into public.round_robin_logs (
      organization_id,
      round_robin_id,
      lead_id,
      assigned_user_id,
      rule_matched,
      reason,
      metadata,
      created_at
    )
    values (
      p_organization_id,
      v_round_robin_id,
      p_lead_id,
      v_assigned_user_id,
      v_effective_rule_id,
      'managed_whatsapp_reentry_keep_assignee',
      jsonb_build_object(
        'source', 'whatsapp',
        'entry_event_id', v_entry_id,
        'provider_event_id', v_provider_event_id,
        'distribution_event_id', v_distribution_result->>'distribution_event_id'
      ),
      v_now
    );
  elsif lower(coalesce(v_distribution_result->>'success', 'false'))
          not in ('true', '1', 'yes')
        and v_had_previous_job then
    -- Restore the prior timer only when the canonical distributor did not
    -- create a replacement active job. Otherwise the unique active-job index
    -- would reject this restore; the pending block below will lock, accelerate
    -- and rebind that canonical job to this managed queue.
    update public.lead_redistribution_jobs as previous_job
       set status = v_previous_job.status,
           stopped_at = v_previous_job.stopped_at,
           stopped_reason = v_previous_job.stopped_reason,
           metadata = v_previous_job.metadata,
           updated_at = v_now
     where previous_job.organization_id = p_organization_id
       and previous_job.lead_id = p_lead_id
       and previous_job.id = v_previous_job.id
       and not exists (
         select 1
         from public.lead_redistribution_jobs as canonical_active_job
         where canonical_active_job.organization_id = p_organization_id
           and canonical_active_job.lead_id = p_lead_id
           and canonical_active_job.id <> v_previous_job.id
           and canonical_active_job.status in ('pending', 'warning_sent')
       );
    if found then
      v_pending_job_id := v_previous_job.id;
    end if;
  end if;

  -- A queue miss must remain retryable. An unassigned lead uses the initial
  -- distribution mode. A redistribute reentry that kept the same assignee is
  -- never reported as complete: accelerate an active timer or create the same
  -- durable job with the explicit assigned-retry mode.
  if v_assigned_user_id is null
     or v_same_assignee_redistribution then
    select job.id
      into v_pending_job_id
      from public.lead_redistribution_jobs as job
     where job.organization_id = p_organization_id
       and job.lead_id = p_lead_id
       and job.status in ('pending', 'warning_sent')
     order by job.created_at, job.id
       limit 1
       for update;

    if v_pending_job_id is not null then
      select coalesce(queue.settings, '{}'::jsonb)
        into v_pending_queue_settings
        from public.round_robins as queue
       where queue.organization_id = p_organization_id
         and queue.id = v_round_robin_id
         and coalesce(queue.is_active, true) = true;

      if not found then
        raise exception using
          errcode = '23514',
          message = 'managed_whatsapp_entry_context_invalid';
      end if;

      v_pending_timeout_minutes := least(10080, greatest(1, coalesce(
        case
          when coalesce(
            v_pending_queue_settings->>'redistribution_timeout_minutes',
            ''
          ) ~ '^[0-9]{1,9}$'
            then (v_pending_queue_settings->>'redistribution_timeout_minutes')::integer
        end,
        20
      )));
      v_pending_warning_minutes := greatest(0, coalesce(
        case
          when coalesce(
            v_pending_queue_settings->>'redistribution_warning_minutes',
            ''
          ) ~ '^[0-9]{1,9}$'
            then (v_pending_queue_settings->>'redistribution_warning_minutes')::integer
        end,
        5
      ));
      v_pending_warning_minutes := least(
        v_pending_warning_minutes,
        v_pending_timeout_minutes - 1
      );
      v_pending_max_attempts := least(1000, greatest(0, coalesce(
        case
          when coalesce(
            v_pending_queue_settings->>'redistribution_max_attempts',
            ''
          ) ~ '^[0-9]{1,9}$'
            then (v_pending_queue_settings->>'redistribution_max_attempts')::integer
        end,
        10
      )));

      update public.lead_redistribution_jobs as pending_job
         set round_robin_id = v_round_robin_id,
             original_assigned_user_id = v_assigned_user_id,
             current_assigned_user_id = v_assigned_user_id,
             attempt_count = 0,
             max_attempts = v_pending_max_attempts,
             timeout_minutes = v_pending_timeout_minutes,
             warning_minutes = v_pending_warning_minutes,
             enrolled_at = v_now,
             status = 'pending',
             due_at = v_now,
             warning_due_at = null,
             warning_sent_at = null,
             last_redistributed_at = null,
             stopped_at = null,
             stopped_reason = null,
             metadata = (
               coalesce(pending_job.metadata, '{}'::jsonb)
                 - 'waiting_for_available_member'
                 - 'next_candidate_check_at'
             )
               || jsonb_build_object(
                 'source', 'managed_whatsapp',
                 'initial_distribution_pending', true,
                 'allow_assigned_redistribution', v_assigned_user_id is not null,
                 'entry_event_id', v_entry_id
               ),
             updated_at = v_now
       where pending_job.organization_id = p_organization_id
         and pending_job.lead_id = p_lead_id
         and pending_job.id = v_pending_job_id;
      if not found then
        v_pending_job_id := null;
      end if;
    else
      v_pending_job_id := private.enqueue_managed_whatsapp_initial_distribution(
        p_organization_id,
        v_round_robin_id,
        p_lead_id,
        v_entry_id,
        v_now,
        v_assigned_user_id is not null
      );
    end if;

    if v_pending_job_id is null then
      raise exception using
        errcode = '55000',
        message = 'managed_whatsapp_pending_distribution_job_missing';
    end if;
  end if;

  v_tags_applied := private.apply_round_robin_auto_tags(
    p_organization_id,
    v_round_robin_id,
    p_lead_id
  );

  update public.whatsapp_conversations as conversation
     set assigned_user_id = v_assigned_user_id,
         updated_at = v_now
   where conversation.organization_id = p_organization_id
     and conversation.session_id = p_session_id
     and conversation.lead_id = p_lead_id;

  v_intake_result := jsonb_build_object(
    'handled', true,
    'entry_type', 'reentry',
    'lead_id', p_lead_id,
    'entry_event_id', v_entry_id,
    'round_robin_id', v_round_robin_id,
    'reentry_behavior', v_reentry_behavior,
    'tags_applied', v_tags_applied
  ) || coalesce(v_distribution_result, '{}'::jsonb);

  if v_pending_job_id is not null then
    v_intake_result := v_intake_result || jsonb_build_object(
      'distribution_pending', true,
      'pending_distribution_job_id', v_pending_job_id,
      'distribution_result', v_distribution_result
    );
  end if;

  update public.lead_entry_events
     set metadata = metadata || jsonb_build_object('intake_result', v_intake_result)
   where id = v_entry_id;

  update public.whatsapp_inbound_logs as inbound_log
     set lead_id = p_lead_id,
         matched_rule_id = v_effective_rule_id,
         assigned_user_id = v_assigned_user_id,
         match_details = coalesce(inbound_log.match_details, '{}'::jsonb)
           || jsonb_build_object(
             'entry_event_id', v_entry_id,
             'intake_outcome', v_intake_result->>'reason'
           )
   where inbound_log.organization_id = p_organization_id
     and inbound_log.session_id = p_session_id
     and inbound_log.match_details->>'message_id' = v_provider_message_id;

  return v_intake_result;
end;
$$;

revoke all on function public.process_managed_whatsapp_lead_entry(
  uuid, uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.process_managed_whatsapp_lead_entry(
  uuid, uuid, uuid, uuid, text, text, timestamptz
) to service_role;

comment on function public.process_managed_whatsapp_lead_entry(
  uuid, uuid, uuid, uuid, text, text, timestamptz
) is
'Records one managed WhatsApp intake per session/provider message id and applies reentry distribution atomically; exact provider retries are side-effect free.';
