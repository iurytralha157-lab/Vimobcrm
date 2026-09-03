begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

select is(
  public.whatsapp_webhook_has_lead_creation_context('{}'::jsonb),
  false,
  'plain WhatsApp metadata cannot create a lead'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{"whatsapp_attribution":{"ctwa_clid":"click-only"}}'::jsonb
  ),
  false,
  'a click id alone is not proof of a Meta ad'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{"whatsapp_attribution":{"source_id":"1234567890"}}'::jsonb
  ),
  false,
  'a generic source id without an explicit ad source cannot create a lead'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{"whatsapp_attribution":{"source_id":"1234567890","source_referral":{"explicit_source_type":"ads"}}}'::jsonb
  ),
  false,
  'near-match source types fail closed'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{"whatsapp_attribution":{"source_id":"not-a-meta-id","source_referral":{"explicit_source_type":"ad"}}}'::jsonb
  ),
  false,
  'an explicit ad with a malformed id cannot create a lead'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{"whatsapp_attribution":{"source_id":"1234567890","source_referral":{"explicit_source_type":"ad"}}}'::jsonb
  ),
  true,
  'legacy webhook metadata without a version marker keeps the prior explicit Meta ad contract during rollout'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{"whatsapp_lead_creation_contract":"ctwa_ad_v1","whatsapp_attribution":{"source_id":"1234567890","source_referral":{"explicit_source_type":"ad"}}}'::jsonb
  ),
  false,
  'the versioned intake rejects a source id when Meta did not identify a ctwa_ad entry point'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{"whatsapp_lead_creation_contract":"ctwa_ad_v2","whatsapp_attribution":{"source_id":"1234567890","source_referral":{"explicit_source_type":"ad"}}}'::jsonb
  ),
  false,
  'an unknown non-empty intake contract fails closed instead of falling back to the legacy ad shape'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{"whatsapp_lead_creation_contract":"ctwa_ad_v1","whatsapp_attribution":{"entry_point_conversion_source":"ctwa_ad","source_referral":{"explicit_source_type":"ad"}}}'::jsonb
  ),
  true,
  'the versioned owner-fallback intake accepts an explicit Meta ctwa_ad entry point'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{"managed_whatsapp_message_distribution":true,"matched_rule_id":"44444444-4444-4444-4444-444444444444","whatsapp_session_id":"22222222-2222-2222-2222-222222222222","target_round_robin_id":"33333333-3333-3333-3333-333333333333"}'::jsonb
  ),
  false,
  'a managed marker without an exact persisted rule and session fails closed'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{"whatsapp_lead_creation_contract":"ctwa_ad_v1","managed_whatsapp_message_distribution":true,"matched_rule_id":"44444444-4444-4444-4444-444444444444","whatsapp_session_id":"22222222-2222-2222-2222-222222222222","target_round_robin_id":"33333333-3333-3333-3333-333333333333","whatsapp_attribution":{"entry_point_conversion_source":"ctwa_ad","source_referral":{"explicit_source_type":"ad"}}}'::jsonb
  ),
  false,
  'an explicit CTWA signal cannot bypass an invalid managed rule and session marker'
);

select ok(
  position(
    'whatsapp_session.id = managed_context.session_id'
    in pg_get_functiondef(
      'public.whatsapp_webhook_has_lead_creation_context(jsonb)'::regprocedure
    )
  ) > 0,
  'the managed creation guard binds metadata to the exact WhatsApp session'
);

select ok(
  position(
    'whatsapp_webhook_has_lead_creation_context'
    in pg_get_functiondef('public.handle_routed_lead_intake(uuid)'::regprocedure)
  ) > 0,
  'managed lead intake revalidates the exact session context before distribution'
);

select ok(
  position(
    'whatsapp_webhook_has_lead_creation_context'
    in pg_get_functiondef(
      'public.upsert_whatsapp_webhook_lead(uuid,text,text,text,text,timestamptz,text,uuid,text,text,text,uuid,uuid,uuid,timestamptz,uuid,uuid,uuid,timestamptz,text,timestamptz,jsonb)'::regprocedure
    )
  ) > 0,
  'the canonical lead upsert still invokes the strict guard'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.whatsapp_webhook_has_lead_creation_context(jsonb)',
    'execute'
  ),
  false,
  'authenticated users cannot invoke the guard RPC directly'
);

select is(
  has_function_privilege(
    'service_role',
    'public.whatsapp_webhook_has_lead_creation_context(jsonb)',
    'execute'
  ),
  true,
  'the trusted webhook processor can invoke the guard'
);

select ok(
  position(
    'from public.whatsapp_messages as message'
    in pg_get_functiondef(
      'public.enrich_whatsapp_lead_entry_attribution(uuid,uuid,uuid,text)'::regprocedure
    )
  ) > 0
  and position(
    'message.organization_id = p_organization_id'
    in pg_get_functiondef(
      'public.enrich_whatsapp_lead_entry_attribution(uuid,uuid,uuid,text)'::regprocedure
    )
  ) > 0
  and position(
    'message.session_id = p_session_id'
    in pg_get_functiondef(
      'public.enrich_whatsapp_lead_entry_attribution(uuid,uuid,uuid,text)'::regprocedure
    )
  ) > 0
  and position(
    'message.lead_id = p_lead_id'
    in pg_get_functiondef(
      'public.enrich_whatsapp_lead_entry_attribution(uuid,uuid,uuid,text)'::regprocedure
    )
  ) > 0,
  'attribution enrichment reads the persisted message under organization, session and lead scope'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.enrich_whatsapp_lead_entry_attribution(uuid,uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.enrich_whatsapp_lead_entry_attribution(uuid,uuid,uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.enrich_whatsapp_lead_entry_attribution(uuid,uuid,uuid,text)',
    'execute'
  ),
  'only the service role can invoke WhatsApp attribution enrichment'
);

select ok(
  position(
    'limit 2'
    in lower(pg_get_functiondef(
      'public.find_lead_by_normalized_phone(uuid,text)'::regprocedure
    ))
  ) > 0
  and position(
    'whatsapp_lead_phone_ambiguous'
    in lower(pg_get_functiondef(
      'public.find_lead_by_normalized_phone(uuid,text)'::regprocedure
    ))
  ) > 0,
  'WhatsApp phone lookup detects historical duplicate ownership instead of selecting one lead'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.find_lead_by_normalized_phone(uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.find_lead_by_normalized_phone(uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.find_lead_by_normalized_phone(uuid,text)',
    'execute'
  ),
  'only the trusted backend can resolve a WhatsApp lead by normalized phone'
);

select has_trigger(
  'public',
  'whatsapp_messages',
  'protect_whatsapp_provider_attribution',
  'browser writes cannot mutate trusted WhatsApp provider attribution'
);

select has_trigger(
  'public',
  'activities',
  'dedupe_whatsapp_meta_creative_activity',
  'Meta creative history has an atomic provider-event and trusted-writer boundary'
);

select ok(
  position(
    'trusted_whatsapp_lead_provenance_required'
    in pg_get_functiondef('private.validate_managed_whatsapp_ctwa_ad()'::regprocedure)
  ) > 0,
  'automatic CTWA lead provenance requires a trusted backend writer'
);

select ok(
  position(
    'trusted_whatsapp_provider_attribution_required'
    in pg_get_functiondef('private.protect_whatsapp_provider_attribution()'::regprocedure)
  ) > 0,
  'provider attribution is immutable to browser sessions'
);

select ok(
  position(
    'insert into private.whatsapp_meta_creative_event_ledger'
    in pg_get_functiondef('private.dedupe_whatsapp_meta_creative_activity()'::regprocedure)
  ) > 0
  and position(
    'trusted_whatsapp_meta_creative_activity_required'
    in pg_get_functiondef('private.dedupe_whatsapp_meta_creative_activity()'::regprocedure)
  ) > 0
  and position(
    'whatsapp_meta_creative_provider_event_lead_collision'
    in pg_get_functiondef('private.dedupe_whatsapp_meta_creative_activity()'::regprocedure)
  ) > 0,
  'creative history reserves exact provider events for trusted writers and rejects cross-lead collisions'
);

select ok(
  position(
    'from public.whatsapp_inbound_logs as inbound_log'
    in pg_get_functiondef(
      'public.enrich_whatsapp_lead_entry_attribution(uuid,uuid,uuid,text)'::regprocedure
    )
  ) > 0
  and position(
    'managed_whatsapp_message_distribution'
    in pg_get_functiondef(
      'public.enrich_whatsapp_lead_entry_attribution(uuid,uuid,uuid,text)'::regprocedure
    )
  ) > 0,
  'managed attribution enrichment reads trusted webhook-log provenance'
);

select ok(
  position(
    'to_jsonb(lead)'
    in lower(pg_get_functiondef(
      'public.find_lead_by_normalized_phone(uuid,text)'::regprocedure
    ))
  ) = 0,
  'normalized phone lookup stays on the indexed leads.phone identity'
);

select * from finish();
rollback;
