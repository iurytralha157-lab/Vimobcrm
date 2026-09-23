begin;

create extension if not exists pgtap with schema extensions;
select plan(53);

select has_table(
  'public',
  'whatsapp_attendance_entries',
  'the backend-only WhatsApp attendance ledger exists'
);

select has_trigger(
  'public',
  'whatsapp_messages',
  'zz_reject_new_whatsapp_legacy_capture',
  'new messages cannot explicitly select legacy-visible capture state'
);

select results_eq(
  $$
    select column_name::text
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whatsapp_attendance_entries'
    order by ordinal_position
  $$,
  $$
    values
      ('id'::text),
      ('organization_id'::text),
      ('conversation_id'::text),
      ('session_id'::text),
      ('lead_id'::text),
      ('binding_id'::text),
      ('user_id'::text),
      ('actor_name_snapshot'::text),
      ('joined_at'::text),
      ('ingress_sequence_cutoff'::text),
      ('entry_source'::text),
      ('bootstrap_provider_message_id'::text),
      ('bootstrap_ingress_sequence'::text),
      ('bootstrap_provider_occurred_at'::text),
      ('bootstrap_inbox_created_at'::text)
  $$,
  'the attendance ledger exposes manual and verified CTWA bootstrap fields'
);

select col_type_is(
  'public',
  'whatsapp_attendance_entries',
  'joined_at',
  'timestamp with time zone',
  'joined_at is a timezone-aware database timestamp'
);

select col_type_is(
  'public',
  'whatsapp_attendance_entries',
  'ingress_sequence_cutoff',
  'bigint',
  'the provider ingress fence uses bigint sequence semantics'
);

select ok(
  not exists (
    select 1
    from information_schema.columns as column_state
    where column_state.table_schema = 'public'
      and column_state.table_name = 'whatsapp_attendance_entries'
      and column_state.is_nullable = 'YES'
      and column_state.column_name not in (
        'bootstrap_provider_message_id',
        'bootstrap_ingress_sequence',
        'bootstrap_provider_occurred_at',
        'bootstrap_inbox_created_at'
      )
  ),
  'every attendance identity and audit field is required; only bootstrap fields are nullable'
);

select col_type_is(
  'public',
  'whatsapp_attendance_entries',
  'bootstrap_ingress_sequence',
  'bigint',
  'the CTWA first-event ingress sequence uses bigint semantics'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid =
      'public.whatsapp_attendance_entries'::regclass
      and constraint_state.conname =
        'whatsapp_attendance_entries_source_check'
      and constraint_state.contype = 'c'
  ),
  'manual entries cannot carry a CTWA bootstrap and automatic entries need a complete boundary'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid =
      'public.whatsapp_attendance_entries'::regclass
      and constraint_state.conname =
        'whatsapp_attendance_entries_binding_id_fkey'
      and constraint_state.contype = 'f'
      and constraint_state.confrelid =
        'public.whatsapp_conversation_lead_bindings'::regclass
      and constraint_state.confdeltype = 'a'
      and constraint_state.condeferrable
      and constraint_state.condeferred
  )
  and exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid =
      'public.whatsapp_attendance_entries'::regclass
      and constraint_state.conname =
        'whatsapp_attendance_entries_conversation_id_fkey'
      and constraint_state.contype = 'f'
      and constraint_state.confrelid =
        'public.whatsapp_conversations'::regclass
      and constraint_state.confdeltype = 'a'
      and constraint_state.condeferrable
      and constraint_state.condeferred
  ),
  'attendance keeps immutable binding/conversation history unless the tenant is removed'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid =
      'public.whatsapp_attendance_entries'::regclass
      and constraint_state.conname =
        'whatsapp_attendance_entries_identity_key'
      and constraint_state.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_state.oid, true) =
        'UNIQUE (organization_id, conversation_id, binding_id, session_id, user_id)'
  ),
  'one user/session/card binding confirmation is idempotent under concurrency'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.whatsapp_attendance_entries'::regclass
      and relation.relrowsecurity
  ),
  'the attendance ledger has RLS enabled'
);

select is(
  (
    select count(*)::bigint
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'whatsapp_attendance_entries'
      and policy.roles && array['public', 'anon', 'authenticated']::name[]
  ),
  0::bigint,
  'the attendance ledger has no browser-facing policy'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.whatsapp_attendance_entries',
    'select'
  )
  and has_table_privilege(
    'service_role',
    'public.whatsapp_attendance_entries',
    'insert'
  )
  and not has_table_privilege(
    'service_role',
    'public.whatsapp_attendance_entries',
    'update'
  )
  and not has_table_privilege(
    'service_role',
    'public.whatsapp_attendance_entries',
    'delete'
  ),
  'service_role can append and read attendance entries but cannot rewrite them'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.whatsapp_attendance_entries',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'public.whatsapp_attendance_entries',
    'insert'
  )
  and not has_table_privilege(
    'anon',
    'public.whatsapp_attendance_entries',
    'select'
  )
  and not has_table_privilege(
    'anon',
    'public.whatsapp_attendance_entries',
    'insert'
  ),
  'browser roles cannot read or append attendance entries directly'
);

select has_table(
  'private',
  'whatsapp_managed_message_proofs',
  'managed first-message proof is kept in a private ledger'
);

select has_table(
  'private',
  'whatsapp_ctwa_auto_origins',
  'new CTWA card origin is kept in a private INSERT-time ledger'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'private.whatsapp_ctwa_auto_origins',
    'select'
  )
  and not has_table_privilege(
    'anon',
    'private.whatsapp_ctwa_auto_origins',
    'select'
  )
  and not has_table_privilege(
    'service_role',
    'private.whatsapp_ctwa_auto_origins',
    'select'
  ),
  'the CTWA origin proof is not directly readable by browser or service roles'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid =
      'private.whatsapp_ctwa_auto_origins'::regclass
      and constraint_state.conname =
        'whatsapp_ctwa_auto_origins_lead_fkey'
      and constraint_state.contype = 'f'
      and constraint_state.condeferrable
      and constraint_state.condeferred
  ),
  'CTWA origin proof can be minted in BEFORE INSERT and is cleaned with its lead'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'private.whatsapp_managed_message_proofs',
    'select'
  )
  and not has_table_privilege(
    'anon',
    'private.whatsapp_managed_message_proofs',
    'select'
  )
  and not has_table_privilege(
    'service_role',
    'private.whatsapp_managed_message_proofs',
    'select'
  ),
  'the proof ledger is reachable only through trusted definer functions'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid =
      'private.whatsapp_managed_message_proofs'::regclass
      and constraint_state.conname =
        'whatsapp_managed_message_proofs_lead_fkey'
      and constraint_state.contype = 'f'
      and constraint_state.condeferrable
      and constraint_state.condeferred
  ),
  'the private proof can be written in BEFORE INSERT and is cascade-cleaned with its lead'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure_state
    where procedure_state.oid =
      'private.whatsapp_managed_initial_proof_matches(uuid,uuid,uuid,text,text,uuid,uuid)'::regprocedure
      and procedure_state.prosecdef
      and procedure_state.provolatile = 'v'
  ),
  'same-statement proof reads are SECURITY DEFINER and VOLATILE'
);

select has_function(
  'private',
  'sanitize_whatsapp_attendance_lead_insert',
  array[]::text[],
  'automatic WhatsApp lead inserts have a plaintext sanitizer'
);

select has_trigger(
  'public',
  'leads',
  'zz_whatsapp_attendance_sanitize_insert',
  'the late lead-insert plaintext sanitizer is installed'
);

select ok(
  position(
    'insert into private.whatsapp_ctwa_auto_origins'
    in pg_catalog.pg_get_functiondef(
      'private.sanitize_whatsapp_attendance_lead_insert()'::regprocedure
    )
  ) > 0
  and position(
    'public.whatsapp_webhook_routing_snapshots'
    in pg_catalog.pg_get_functiondef(
      'private.sanitize_whatsapp_attendance_lead_insert()'::regprocedure
    )
  ) > 0,
  'only an INSERT-time CTWA lead with immutable routing evidence mints automatic origin proof'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure_state
    where procedure_state.oid =
      'public.auto_enter_whatsapp_ctwa_attendance(uuid,uuid,uuid,uuid,uuid,text,bigint,timestamptz)'::regprocedure
      and procedure_state.prosecdef
      and procedure_state.provolatile = 'v'
  ),
  'automatic CTWA entry is an atomic SECURITY DEFINER operation'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.auto_enter_whatsapp_ctwa_attendance(uuid,uuid,uuid,uuid,uuid,text,bigint,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.auto_enter_whatsapp_ctwa_attendance(uuid,uuid,uuid,uuid,uuid,text,bigint,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.auto_enter_whatsapp_ctwa_attendance(uuid,uuid,uuid,uuid,uuid,text,bigint,timestamptz)',
    'execute'
  ),
  'only service_role can request automatic CTWA entry'
);

select is(
  public.auto_enter_whatsapp_ctwa_attendance(
    null::uuid, null::uuid, null::uuid, null::uuid,
    null::uuid, null::text, null::bigint, null::timestamptz
  ),
  null::uuid,
  'automatic entry fails closed without complete first-event evidence'
);

select ok(
  'validate_managed_whatsapp_lead_insert' <
    'zz_whatsapp_attendance_sanitize_insert'
  and position(
    $$new.initial_message := null$$
    in pg_catalog.pg_get_functiondef(
      'private.sanitize_whatsapp_attendance_lead_insert()'::regprocedure
    )
  ) > 0
  and position(
    $$new.message := null$$
    in pg_catalog.pg_get_functiondef(
      'private.sanitize_whatsapp_attendance_lead_insert()'::regprocedure
    )
  ) > 0
  and position(
    $$insert into private.whatsapp_managed_message_proofs$$
    in lower(pg_catalog.pg_get_functiondef(
      'private.sanitize_whatsapp_attendance_lead_insert()'::regprocedure
    ))
  ) > 0
  and not exists (
    select 1
    from pg_catalog.pg_proc as procedure_state
    where procedure_state.oid =
      'private.sanitize_whatsapp_attendance_lead_insert()'::regprocedure
      and not procedure_state.prosecdef
  ),
  'managed validation precedes a private proof write and both public plaintext fields are removed'
);

select has_function(
  'private',
  'suppress_whatsapp_attendance_lead_message',
  array[]::text[],
  'managed reentry has a transaction-local lead message guard'
);

select has_trigger(
  'public',
  'leads',
  'aa_whatsapp_attendance_suppress_lead_message',
  'the lead message guard is installed before downstream update effects'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.leads'::regclass
      and trigger_state.tgname =
        'aa_whatsapp_attendance_suppress_lead_message'
      and lower(pg_catalog.pg_get_triggerdef(trigger_state.oid, true)) like
        '%before update of message%'
  )
  and position(
      $$new.message := old.message$$
      in pg_catalog.pg_get_functiondef(
        'private.suppress_whatsapp_attendance_lead_message()'::regprocedure
      )
    ) > 0,
  'suppressed managed reentry restores OLD.message before lead projections run'
);

select has_function(
  'public',
  'process_managed_whatsapp_lead_entry_attendance',
  array[
    'uuid',
    'uuid',
    'uuid',
    'uuid',
    'text',
    'text',
    'timestamp with time zone',
    'boolean'
  ],
  'managed intake exposes an attendance-aware backend wrapper'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.process_managed_whatsapp_lead_entry_attendance(uuid,uuid,uuid,uuid,text,text,timestamp with time zone,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.process_managed_whatsapp_lead_entry_attendance(uuid,uuid,uuid,uuid,text,text,timestamp with time zone,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.process_managed_whatsapp_lead_entry_attendance(uuid,uuid,uuid,uuid,text,text,timestamp with time zone,boolean)',
    'execute'
  ),
  'only service_role can invoke the attendance-aware managed intake wrapper'
);

select ok(
  position(
    $$vimob.whatsapp_attendance_capture$$
    in pg_catalog.pg_get_functiondef(
      'public.process_managed_whatsapp_lead_entry_attendance(uuid,uuid,uuid,uuid,text,text,timestamp with time zone,boolean)'::regprocedure
    )
  ) > 0
  and position(
    $$public.process_managed_whatsapp_lead_entry($$
    in pg_catalog.pg_get_functiondef(
      'public.process_managed_whatsapp_lead_entry_attendance(uuid,uuid,uuid,uuid,text,text,timestamp with time zone,boolean)'::regprocedure
    )
  ) > 0,
  'the wrapper scopes suppression around the canonical managed intake RPC'
);

select ok(
  position(
    $$private.whatsapp_managed_initial_proof_matches$$
    in pg_catalog.pg_get_functiondef(
      'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
    )
  ) > 0,
  'post-insert managed distribution authenticates the private proof instead of public lead plaintext'
);

select ok(
  position(
    $$private.whatsapp_managed_initial_proof_matches$$
    in pg_catalog.pg_get_functiondef(
      'public.lookup_managed_whatsapp_lead_entry(uuid,uuid,text,text)'::regprocedure
    )
  ) > 0
  and position(
    $$private.whatsapp_attendance_message_evidence_matches$$
    in pg_catalog.pg_get_functiondef(
      'public.lookup_managed_whatsapp_lead_entry(uuid,uuid,text,text)'::regprocedure
    )
  ) > 0,
  'managed retry lookup accepts only private lead proof or backend-only message evidence'
);

select ok(
  position(
    $$private.whatsapp_attendance_message_evidence_matches$$
    in pg_catalog.pg_get_functiondef(
      'public.process_managed_whatsapp_lead_entry(uuid,uuid,uuid,uuid,text,text,timestamp with time zone)'::regprocedure
    )
  ) > 0
  and position(
    $$private.whatsapp_managed_initial_proof_matches$$
    in pg_catalog.pg_get_functiondef(
      'public.process_managed_whatsapp_lead_entry(uuid,uuid,uuid,uuid,text,text,timestamp with time zone)'::regprocedure
    )
  ) > 0,
  'managed intake verifies redacted canonical rows without weakening collision checks'
);

select ok(
  position(
    $$whatsapp_attendance_required$$
    in pg_catalog.pg_get_functiondef(
      'public.enqueue_managed_whatsapp_distribution_auto_reply(uuid,uuid,uuid,text)'::regprocedure
    )
  ) > 0
  and position(
    $$attended_message.capture_state = 'captured'$$
    in pg_catalog.pg_get_functiondef(
      'public.enqueue_managed_whatsapp_distribution_auto_reply(uuid,uuid,uuid,text)'::regprocedure
    )
  ) > 0
  and position(
    $$'captured',$$
    in pg_catalog.pg_get_functiondef(
      'public.enqueue_managed_whatsapp_distribution_auto_reply(uuid,uuid,uuid,text)'::regprocedure
    )
  ) > 0,
  'managed auto-reply cannot enqueue or expose a preview before exact attendance'
);

select ok(
  position(
    $$automation_whatsapp_attendance_required$$
    in pg_catalog.pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    )
  ) > 0
  and position(
    $$attendance.binding_id = locked_binding.id$$
    in pg_catalog.pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    )
  ) > 0
  and position(
    $$capture_state, provider_message_id$$
    in pg_catalog.pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    )
  ) > 0
  and position(
    $$'captured', provider_request_id$$
    in pg_catalog.pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    )
  ) > 0,
  'automation dispatch cannot queue, preview or timeline plaintext before exact attendance'
);

select ok(
  pg_catalog.to_regclass(
    'public.whatsapp_attendance_entries_lead_idx'
  ) is not null,
  'lead/session capture lookups have a dedicated index'
);

select ok(
  pg_catalog.to_regclass(
    'public.whatsapp_attendance_entries_conversation_idx'
  ) is not null,
  'conversation/binding capture lookups have a dedicated index'
);

select col_type_is(
  'public',
  'whatsapp_messages',
  'capture_state',
  'text',
  'canonical messages expose the capture state'
);

select ok(
  exists (
    select 1
    from information_schema.columns as column_state
    where column_state.table_schema = 'public'
      and column_state.table_name = 'whatsapp_messages'
      and column_state.column_name = 'capture_state'
      and column_state.is_nullable = 'YES'
      and column_state.column_default = '''suppressed''::text'
  ),
  'capture_state is nullable for legacy rows and defaults future writes to suppressed'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.whatsapp_messages'::regclass
      and constraint_state.conname = 'whatsapp_messages_capture_state_check'
      and constraint_state.contype = 'c'
      and not constraint_state.convalidated
      and lower(pg_catalog.pg_get_constraintdef(constraint_state.oid, true))
        like '%capture_state is null%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_state.oid, true))
        like '%legacy%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_state.oid, true))
        like '%captured%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_state.oid, true))
        like '%suppressed%'
  ),
  'the non-blocking NOT VALID constraint accepts only legacy, captured, suppressed or NULL'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'whatsapp_messages'
      and policy.policyname = 'whatsapp_messages_select_owner_only'
      and policy.cmd = 'SELECT'
      and policy.roles = array['authenticated']::name[]
      and lower(policy.qual) like
        '%capture_state is distinct from ''suppressed''::text%'
      and lower(policy.qual) like
        '%whatsapp_message_conversation_session_matches%'
      and lower(policy.qual) like '%can_view_whatsapp_conversation%'
  ),
  'the legacy authenticated SELECT policy hides suppressed rows and retains its access guards'
);

select is(
  has_table_privilege(
    'authenticated',
    'public.whatsapp_messages',
    'select'
  )
  or has_table_privilege(
    'authenticated',
    'public.whatsapp_messages',
    'insert'
  )
  or has_table_privilege(
    'authenticated',
    'public.whatsapp_messages',
    'update'
  )
  or has_table_privilege(
    'authenticated',
    'public.whatsapp_messages',
    'delete'
  )
  or has_table_privilege(
    'anon',
    'public.whatsapp_messages',
    'select'
  )
  or has_table_privilege(
    'anon',
    'public.whatsapp_messages',
    'insert'
  )
  or has_table_privilege(
    'anon',
    'public.whatsapp_messages',
    'update'
  )
  or has_table_privilege(
    'anon',
    'public.whatsapp_messages',
    'delete'
  ),
  false,
  'browser roles cannot read, forge or mutate canonical capture_state rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.lead_entry_events', 'select')
  and not has_table_privilege('anon', 'public.lead_entry_events', 'select')
  and not has_table_privilege('authenticated', 'public.lead_timeline_events', 'select')
  and not has_table_privilege('anon', 'public.lead_timeline_events', 'select')
  and has_table_privilege('service_role', 'public.lead_entry_events', 'select')
  and has_table_privilege('service_role', 'public.lead_timeline_events', 'select'),
  'browser roles cannot read low-entropy managed fingerprints from lifecycle ledgers'
);

select is(
  (
    select count(*)::bigint
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_messages'::regclass
      and not trigger_state.tgisinternal
      and trigger_state.tgname = any (array[
        'gamification_canonical_whatsapp_insert_enqueue',
        'gamification_canonical_whatsapp_status_enqueue',
        'trg_capture_whatsapp_attention_fact',
        'trg_touch_whatsapp_conversation_received_at',
        'whatsapp_message_private_broadcast',
        'zz_automation_human_outbound_handoff',
        'zz_automation_inbound_message',
        'enqueue_whatsapp_avatar_after_message'
      ]::name[])
  ),
  8::bigint,
  'all eight message side-effect triggers remain installed'
);

select is(
  (
    select count(*)::bigint
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_messages'::regclass
      and not trigger_state.tgisinternal
      and trigger_state.tgname = any (array[
        'gamification_canonical_whatsapp_insert_enqueue',
        'gamification_canonical_whatsapp_status_enqueue',
        'trg_capture_whatsapp_attention_fact',
        'trg_touch_whatsapp_conversation_received_at',
        'whatsapp_message_private_broadcast',
        'zz_automation_human_outbound_handoff',
        'zz_automation_inbound_message',
        'enqueue_whatsapp_avatar_after_message'
      ]::name[])
      and lower(pg_catalog.pg_get_triggerdef(trigger_state.oid, true)) like
        '%new.capture_state is distinct from ''suppressed''::text%'
  ),
  8::bigint,
  'every message side-effect trigger fails closed for suppressed rows'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_messages'::regclass
      and trigger_state.tgname = 'trg_touch_whatsapp_conversation_received_at'
      and lower(pg_catalog.pg_get_triggerdef(trigger_state.oid, true))
        like '%new.from_me%'
      and lower(pg_catalog.pg_get_triggerdef(trigger_state.oid, true))
        like '%new.direction%'
  ),
  'the conversation touch trigger retains its inbound-only predicate'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_messages'::regclass
      and trigger_state.tgname = 'whatsapp_message_private_broadcast'
      and lower(pg_catalog.pg_get_triggerdef(trigger_state.oid, true))
        like '%after insert or update of lead_id, status, delivered_at, read_at, media_status, media_url, content, message_type, reaction_emoji, reaction_to_message_id%'
  ),
  'the Realtime trigger retains its complete insert/update event contract'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_messages'::regclass
      and trigger_state.tgname = 'enqueue_whatsapp_avatar_after_message'
      and lower(pg_catalog.pg_get_triggerdef(trigger_state.oid, true))
        like '%after insert or update of status, direction, from_me, message_type, lead_id, session_id, conversation_id, remote_jid%'
  ),
  'the avatar trigger retains every original insert/update routing column'
);

select ok(
  obj_description(
    'public.whatsapp_attendance_entries'::regclass,
    'pg_class'
  ) like '%Append-only backend ledger%'
  and col_description(
    'public.whatsapp_messages'::regclass,
    (
      select attribute.attnum
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'public.whatsapp_messages'::regclass
        and attribute.attname = 'capture_state'
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
  ) like '%NULL means legacy-visible history%'
  ,
  'the ledger and NULL-as-legacy capture semantics are documented in schema comments'
);

select * from finish();
rollback;
