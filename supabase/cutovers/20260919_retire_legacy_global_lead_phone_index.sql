-- Final queue-scoped lead identity cutover.
--
-- Run this file only after the compatible API/Edge/Web release and the strict
-- WhatsApp binding cutover. Use one dedicated psql invocation with autocommit
-- enabled; DROP INDEX CONCURRENTLY must never be wrapped in BEGIN/COMMIT.
\set ON_ERROR_STOP on

\if :{?app_ready_release}
\else
  \echo 'Missing -v app_ready_release=<40-character deployed Git SHA>'
  \set app_ready_release missing
\endif

\if :{?app_smoke_confirmed}
\else
  \echo 'Missing -v app_smoke_confirmed=true'
  \set app_smoke_confirmed false
\endif

\if :app_smoke_confirmed
\else
  \echo 'app_smoke_confirmed must be true after the compatible-deploy smoke checks'
\endif

\if :{?intake_quiesced}
\else
  \echo 'Missing -v intake_quiesced=true'
  \set intake_quiesced false
\endif

\if :intake_quiesced
\else
  \echo 'intake_quiesced must remain true from before A1 until after B2 smokes'
\endif

select pg_catalog.set_config(
  'vimob.queue_scoped_lead_app_ready_release',
  :'app_ready_release',
  false
);

select pg_catalog.set_config(
  'vimob.queue_scoped_lead_app_smoke_confirmed',
  :'app_smoke_confirmed',
  false
);

select pg_catalog.set_config(
  'vimob.queue_scoped_lead_intake_quiesced',
  :'intake_quiesced',
  false
);

set lock_timeout = '5s';
set statement_timeout = '0';

select pg_catalog.pg_advisory_lock(
  pg_catalog.hashtextextended('vimob.queue_scoped_lead_phone_index', 0)
);

do $preflight_retire_legacy_global_lead_phone_index$
declare
  v_app_ready_release text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_app_ready_release',
    true
  );
  v_app_smoke_confirmed text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_app_smoke_confirmed',
    true
  );
  v_intake_quiesced text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_intake_quiesced',
    true
  );
  v_scope_index_definition text;
  v_scope_index_predicate text;
  v_legacy_index_oid oid;
  v_legacy_index_definition text;
  v_legacy_index_predicate text;
  v_legacy_index_ready boolean;
  v_legacy_index_valid boolean;
  v_resume_marker_matches boolean := false;
begin
  if v_app_ready_release is null
     or v_app_ready_release !~ '^[0-9a-f]{40}$'
     or v_app_smoke_confirmed is distinct from 'true'
     or v_intake_quiesced is distinct from 'true' then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_compatible_app_not_attested';
  end if;

  select
    pg_catalog.pg_get_indexdef(index_state.indexrelid),
    pg_catalog.regexp_replace(
      pg_catalog.replace(
        pg_catalog.lower(
          pg_catalog.pg_get_expr(
            index_state.indpred,
            index_state.indrelid,
            true
          )
        ),
        'public.',
        ''
      ),
      '(::text|[[:space:]()])',
      '',
      'g'
    )
  into v_scope_index_definition, v_scope_index_predicate
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid =
      pg_catalog.to_regclass('public.leads_org_scope_phone_unique')
    and index_state.indrelid = 'public.leads'::regclass
    and index_state.indisunique
    and index_state.indisready
    and index_state.indisvalid
    and index_state.indnkeyatts = 3
    and index_state.indnatts = 3
    and pg_catalog.pg_get_indexdef(index_state.indexrelid, 1, true) =
      'organization_id'
    and pg_catalog.pg_get_indexdef(index_state.indexrelid, 2, true) =
      'intake_scope_key'
    and pg_catalog.replace(
      pg_catalog.lower(
        pg_catalog.pg_get_indexdef(index_state.indexrelid, 3, true)
      ),
      'public.',
      ''
    ) = 'normalize_phone(phone)';

  if v_scope_index_definition is null
     or v_scope_index_predicate is distinct from
       $canonical_scope_predicate$phoneisnotnullandbtrimphone<>''andnormalize_phonephoneisnotnullandnormalize_phonephone<>''$canonical_scope_predicate$ then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_phone_index_not_ready',
      detail = pg_catalog.concat(
        'definition=',
        pg_catalog.coalesce(v_scope_index_definition, '<missing>'),
        '; predicate=',
        pg_catalog.coalesce(v_scope_index_predicate, '<missing>')
      );
  end if;

  if pg_catalog.to_regprocedure('public.set_whatsapp_message_context()') is null
     or pg_catalog.to_regprocedure(
       'private.is_terminal_whatsapp_lead_resolution_quarantine(jsonb,boolean,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)'
     ) is null
     or pg_catalog.obj_description(
       pg_catalog.to_regprocedure('public.set_whatsapp_message_context()'),
       'pg_proc'
     ) not like 'vimob.queue_scoped_message_binding.v1:%'
     or not exists (
       select 1
       from pg_catalog.pg_trigger as trigger_state
       where trigger_state.tgrelid = 'public.whatsapp_messages'::regclass
         and trigger_state.tgname = 'zz_enforce_whatsapp_message_context_before_write'
         and not trigger_state.tgisinternal
         and trigger_state.tgenabled in ('O', 'A')
         and trigger_state.tgtype = 23
         and (
           select pg_catalog.count(*)
           from pg_catalog.pg_attribute as attribute
           where attribute.attrelid = trigger_state.tgrelid
             and attribute.attname = any (
               array[
                 'organization_id',
                 'session_id',
                 'conversation_id',
                 'lead_id',
                 'remote_jid'
               ]::name[]
             )
             and attribute.attnum = any (trigger_state.tgattr)
         ) = 5
     ) then
    raise exception using
      errcode = '55000',
      message = 'strict_whatsapp_message_binding_not_ready';
  end if;

  if pg_catalog.to_regprocedure(
       'private.enforce_canonical_whatsapp_outbox_lead_binding()'
     ) is null
     or pg_catalog.obj_description(
       pg_catalog.to_regprocedure(
         'private.enforce_canonical_whatsapp_outbox_lead_binding()'
       ),
       'pg_proc'
     ) not like 'vimob.queue_scoped_outbox_binding.v2:%'
     or not exists (
       select 1
       from pg_catalog.pg_trigger as trigger_state
       where trigger_state.tgrelid = 'public.whatsapp_outbox'::regclass
         and trigger_state.tgname =
           'enforce_canonical_whatsapp_outbox_lead_binding_before_write'
         and not trigger_state.tgisinternal
         and trigger_state.tgenabled in ('O', 'A')
         and trigger_state.tgtype = 23
         and (
           select pg_catalog.count(*)
           from pg_catalog.pg_attribute as attribute
           where attribute.attrelid = trigger_state.tgrelid
             and attribute.attname = any (
               array[
                 'organization_id',
                 'session_id',
                 'conversation_id',
                 'message_id',
                 'status'
               ]::name[]
             )
             and attribute.attnum = any (trigger_state.tgattr)
         ) = 5
     ) then
    raise exception using
      errcode = '55000',
      message = 'strict_canonical_whatsapp_outbox_binding_not_ready';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated']::text[]) as browser(role_name)
    cross join unnest(
      array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']::text[]
    ) as operation(privilege_name)
    where pg_catalog.has_table_privilege(
      browser.role_name,
      'public.whatsapp_messages',
      operation.privilege_name
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'whatsapp_message_browser_write_privilege_present';
  end if;

  if exists (
    select 1
    from public.whatsapp_conversations as conversation
    left join public.whatsapp_conversation_lead_bindings as binding
      on binding.organization_id = conversation.organization_id
     and binding.conversation_id = conversation.id
     and binding.active_to is null
    where (
      conversation.lead_id is null
      and binding.id is not null
    ) or (
      conversation.lead_id is not null
      and (
        binding.id is null
        or binding.lead_id is distinct from conversation.lead_id
        or binding.session_id is distinct from conversation.session_id
      )
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_conversation_binding_drift_present';
  end if;

  if exists (
    select 1
    from public.whatsapp_messages as message
    join public.whatsapp_conversations as conversation
      on conversation.id = message.conversation_id
     and conversation.organization_id = message.organization_id
    where conversation.lead_id is not null
      and message.lead_id is null
      and not private.is_terminal_whatsapp_lead_resolution_quarantine(
        message.metadata,
        message.from_me,
        message.provider_message_id,
        message.message_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'linked_whatsapp_message_without_lead_snapshot';
  end if;

  if pg_catalog.to_regclass(
       'private.queue_scoped_lead_cutover_markers'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_cutover_marker_contract_missing';
  end if;

  select
    index_state.indexrelid::oid,
    pg_catalog.pg_get_indexdef(index_state.indexrelid),
    pg_catalog.regexp_replace(
      pg_catalog.replace(
        pg_catalog.lower(
          pg_catalog.pg_get_expr(
            index_state.indpred,
            index_state.indrelid,
            true
          )
        ),
        'public.',
        ''
      ),
      '(::text|[[:space:]()])',
      '',
      'g'
    ),
    index_state.indisready,
    index_state.indisvalid
  into
    v_legacy_index_oid,
    v_legacy_index_definition,
    v_legacy_index_predicate,
    v_legacy_index_ready,
    v_legacy_index_valid
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid =
      pg_catalog.to_regclass('public.leads_org_phone_unique')
    and index_state.indrelid = 'public.leads'::regclass
    and index_state.indisunique
    and index_state.indnkeyatts = 2
    and index_state.indnatts = 2
    and pg_catalog.pg_get_indexdef(index_state.indexrelid, 1, true) =
      'organization_id'
    and pg_catalog.replace(
      pg_catalog.lower(
        pg_catalog.pg_get_indexdef(index_state.indexrelid, 2, true)
      ),
      'public.',
      ''
    ) = 'normalize_phone(phone)';

  if pg_catalog.to_regclass('public.leads_org_phone_unique') is not null
     and (
       v_legacy_index_definition is null
       or v_legacy_index_predicate is distinct from
         $canonical_global_predicate$phoneisnotnullandbtrimphone<>''andnormalize_phonephoneisnotnullandnormalize_phonephone<>''$canonical_global_predicate$
     ) then
    raise exception using
      errcode = '55000',
      message = 'legacy_global_lead_phone_index_shape_mismatch',
      hint = 'Do not drop a homonymous index whose exact table, keys and predicate were not proven.';
  end if;

  select exists (
    select 1
    from private.queue_scoped_lead_cutover_markers as marker
    where marker.cutover_key = 'retire_legacy_global_lead_phone_index_v1'
      and (
        marker.state = 'completed'
        or (
          marker.state = 'prepared'
          and marker.prepared_release_sha = v_app_ready_release
        )
      )
      and (
        v_legacy_index_oid is null
        or (
          marker.legacy_index_oid = v_legacy_index_oid
          and marker.legacy_index_definition = v_legacy_index_definition
        )
      )
  ) into v_resume_marker_matches;

  if v_legacy_index_oid is null and not v_resume_marker_matches then
    raise exception using
      errcode = '55000',
      message = 'legacy_global_lead_phone_index_missing_without_cutover_marker';
  end if;

  if v_legacy_index_oid is not null
     and (not v_legacy_index_ready or not v_legacy_index_valid)
     and not (
       v_resume_marker_matches
       and exists (
         select 1
         from private.queue_scoped_lead_cutover_markers as marker
         where marker.cutover_key = 'retire_legacy_global_lead_phone_index_v1'
           and marker.state = 'prepared'
           and marker.prepared_release_sha = v_app_ready_release
       )
     ) then
    raise exception using
      errcode = '55000',
      message = 'legacy_global_lead_phone_index_invalid_without_matching_prepared_marker',
      hint = 'Keep intake quiesced and inspect the index and durable cutover marker before resuming.';
  end if;
end;
$preflight_retire_legacy_global_lead_phone_index$;

insert into private.queue_scoped_lead_cutover_markers (
  cutover_key,
  state,
  prepared_release_sha,
  legacy_index_oid,
  legacy_index_definition,
  prepared_at,
  completed_at,
  updated_at
)
select
  'retire_legacy_global_lead_phone_index_v1',
  'prepared',
  pg_catalog.current_setting('vimob.queue_scoped_lead_app_ready_release'),
  index_state.indexrelid::oid,
  pg_catalog.pg_get_indexdef(index_state.indexrelid),
  now(),
  null,
  now()
from pg_catalog.pg_index as index_state
where index_state.indexrelid =
  pg_catalog.to_regclass('public.leads_org_phone_unique')
on conflict (cutover_key) do update
set state = excluded.state,
    prepared_release_sha = excluded.prepared_release_sha,
    legacy_index_oid = excluded.legacy_index_oid,
    legacy_index_definition = excluded.legacy_index_definition,
    prepared_at = excluded.prepared_at,
    completed_at = null,
    updated_at = excluded.updated_at;

drop index concurrently if exists public.leads_org_phone_unique;

do $verify_legacy_global_lead_phone_index_retired$
begin
  if pg_catalog.to_regclass('public.leads_org_phone_unique') is not null then
    raise exception using
      errcode = '55000',
      message = 'legacy_global_lead_phone_index_still_present';
  end if;
end;
$verify_legacy_global_lead_phone_index_retired$;

update private.queue_scoped_lead_cutover_markers
set state = 'completed',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
where cutover_key = 'retire_legacy_global_lead_phone_index_v1';

do $verify_legacy_global_lead_phone_index_marker_completed$
begin
  if not exists (
    select 1
    from private.queue_scoped_lead_cutover_markers as marker
    where marker.cutover_key = 'retire_legacy_global_lead_phone_index_v1'
      and marker.state = 'completed'
      and marker.completed_at is not null
  ) then
    raise exception using
      errcode = '55000',
      message = 'legacy_global_lead_phone_index_marker_not_completed';
  end if;
end;
$verify_legacy_global_lead_phone_index_marker_completed$;

select pg_catalog.pg_advisory_unlock(
  pg_catalog.hashtextextended('vimob.queue_scoped_lead_phone_index', 0)
);

reset statement_timeout;
reset lock_timeout;
