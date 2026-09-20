-- Online index preparation for queue-scoped lead identity and immutable
-- legacy-outbox attribution.
--
-- Run this file in one dedicated psql invocation with autocommit enabled.
-- Never wrap it in BEGIN/COMMIT: CREATE INDEX CONCURRENTLY must remain outside
-- a transaction and keeps lead writes available while the index is built.
\set ON_ERROR_STOP on

\if :{?intake_quiesced}
\else
  \set intake_quiesced false
\endif

\if :{?online_legacy_freeze}
\else
  \set online_legacy_freeze false
\endif

\if :intake_quiesced
\else
  \if :online_legacy_freeze
  \else
    \echo 'Use -v intake_quiesced=true or the proven online path -v online_legacy_freeze=true'
  \endif
\endif

select pg_catalog.set_config(
  'vimob.queue_scoped_lead_intake_quiesced',
  :'intake_quiesced',
  false
);

select pg_catalog.set_config(
  'vimob.queue_scoped_lead_online_legacy_freeze',
  :'online_legacy_freeze',
  false
);

set lock_timeout = '5s';
set statement_timeout = '0';

select pg_catalog.pg_advisory_lock(
  pg_catalog.hashtextextended('vimob.queue_scoped_lead_phone_index', 0)
);

do $preflight_queue_scoped_lead_phone_index$
declare
  v_intake_quiesced text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_intake_quiesced',
    true
  );
  v_online_legacy_freeze text := pg_catalog.current_setting(
    'vimob.queue_scoped_lead_online_legacy_freeze',
    true
  );
begin
  if v_intake_quiesced is distinct from 'true'
     and v_online_legacy_freeze is distinct from 'true' then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_online_safety_not_attested';
  end if;

  if v_online_legacy_freeze = 'true'
     and (
       pg_catalog.to_regclass(
         'private.whatsapp_webhook_legacy_routing_freeze'
       ) is null
       or not exists (
         select 1
         from pg_catalog.pg_trigger as trigger_state
         where trigger_state.tgrelid =
           'public.whatsapp_webhook_inbox'::regclass
           and trigger_state.tgname =
             'guard_whatsapp_webhook_legacy_routing_freeze'
           and not trigger_state.tgisinternal
           and trigger_state.tgenabled in ('O', 'A')
       )
       or exists (
         select 1
         from public.whatsapp_webhook_inbox as inbox
         where inbox.status in ('pending', 'retry', 'processing')
           and coalesce(
             inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}',
             ''
           ) <> '1'
           and not private.is_frozen_legacy_whatsapp_ingress(
             inbox.id,
             inbox.organization_id,
             inbox.session_id,
             inbox.event_key,
             inbox.processing_lane
           )
       )
     ) then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_online_legacy_freeze_not_ready';
  end if;

  if pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regprocedure('public.normalize_phone(text)') is null
     or not exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = 'public.leads'::regclass
         and attribute.attname = 'intake_scope_key'
         and not attribute.attisdropped
     )
     or not exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = 'public.leads'::regclass
         and attribute.attname = 'origin_round_robin_id'
         and not attribute.attisdropped
     )
     or not exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = 'public.outbox_messages'::regclass
         and attribute.attname = 'lead_id'
         and not attribute.attisdropped
     ) then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_additive_contract_not_ready';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_state
    where index_state.indexrelid =
      pg_catalog.to_regclass('public.leads_org_phone_unique')
      and index_state.indisunique
      and index_state.indisready
      and index_state.indisvalid
  ) then
    raise exception using
      errcode = '55000',
      message = 'legacy_global_lead_phone_index_not_ready';
  end if;

  if pg_catalog.to_regclass('public.leads_org_scope_phone_unique') is not null
     and not exists (
       select 1
       from pg_catalog.pg_index as index_state
       where index_state.indexrelid =
         pg_catalog.to_regclass('public.leads_org_scope_phone_unique')
         and index_state.indisunique
         and index_state.indisready
         and index_state.indisvalid
     ) then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_phone_index_invalid',
      hint = 'Inspect and DROP INDEX CONCURRENTLY before retrying this cutover.';
  end if;

  if pg_catalog.to_regclass('public.outbox_messages_active_lead_idx') is not null
     and not exists (
       select 1
       from pg_catalog.pg_index as index_state
       where index_state.indexrelid =
         pg_catalog.to_regclass('public.outbox_messages_active_lead_idx')
         and index_state.indisready
         and index_state.indisvalid
     ) then
    raise exception using
      errcode = '55000',
      message = 'outbox_messages_active_lead_index_invalid',
      hint = 'Inspect and DROP INDEX CONCURRENTLY before retrying this cutover.';
  end if;

  if exists (
    select 1
    from public.leads as lead
    where lead.phone is not null
      and pg_catalog.btrim(lead.phone) <> ''
      and public.normalize_phone(lead.phone) is not null
      and public.normalize_phone(lead.phone) <> ''
    group by
      lead.organization_id,
      lead.intake_scope_key,
      public.normalize_phone(lead.phone)
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'queue_scoped_lead_phone_duplicates_present',
      hint = 'Resolve duplicates without guessing provenance, then rerun the cutover.';
  end if;
end;
$preflight_queue_scoped_lead_phone_index$;

create unique index concurrently if not exists leads_org_scope_phone_unique
  on public.leads (
    organization_id,
    intake_scope_key,
    public.normalize_phone(phone)
  )
  where phone is not null
    and btrim(phone) <> ''
    and public.normalize_phone(phone) is not null
    and public.normalize_phone(phone) <> '';

create index concurrently if not exists outbox_messages_active_lead_idx
  on public.outbox_messages (
    organization_id,
    conversation_id,
    lead_id,
    created_at,
    id
  )
  where status in ('pending', 'processing');

do $verify_queue_scoped_lead_phone_index$
declare
  v_index_definition text;
  v_index_predicate text;
begin
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
  into v_index_definition, v_index_predicate
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

  if v_index_definition is null
     or v_index_predicate is distinct from
       $canonical_scope_predicate$phoneisnotnullandbtrimphone<>''andnormalize_phonephoneisnotnullandnormalize_phonephone<>''$canonical_scope_predicate$ then
    raise exception using
      errcode = '55000',
      message = 'queue_scoped_lead_phone_index_readback_failed',
      detail = pg_catalog.concat(
        'definition=',
        pg_catalog.coalesce(v_index_definition, '<missing>'),
        '; predicate=',
        pg_catalog.coalesce(v_index_predicate, '<missing>')
      );
  end if;

  select pg_catalog.pg_get_indexdef(index_state.indexrelid)
  into v_index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid =
    pg_catalog.to_regclass('public.outbox_messages_active_lead_idx')
    and index_state.indisready
    and index_state.indisvalid
    and index_state.indnkeyatts = 5;

  if v_index_definition is null
     or pg_catalog.strpos(
       v_index_definition,
       '(organization_id, conversation_id, lead_id, created_at, id)'
     ) = 0
     or pg_catalog.strpos(v_index_definition, 'WHERE (status = ANY') = 0 then
    raise exception using
      errcode = '55000',
      message = 'outbox_messages_active_lead_index_readback_failed';
  end if;
end;
$verify_queue_scoped_lead_phone_index$;

select pg_catalog.pg_advisory_unlock(
  pg_catalog.hashtextextended('vimob.queue_scoped_lead_phone_index', 0)
);

reset statement_timeout;
reset lock_timeout;
