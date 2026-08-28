begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

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
  'an explicit Meta ad with a numeric id passes the database shape guard'
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
    '{"managed_whatsapp_message_distribution":true,"matched_rule_id":"44444444-4444-4444-4444-444444444444","whatsapp_session_id":"22222222-2222-2222-2222-222222222222","target_round_robin_id":"33333333-3333-3333-3333-333333333333","whatsapp_attribution":{"ad_id":"123456789012345","source_referral":{"explicit_source_type":"ad","source_id":"123456789012345"}}}'::jsonb
  ),
  false,
  'a Meta ad shape cannot bypass an invalid managed rule and session marker'
);

select ok(
  position(
    'whatsapp_session.id = inbound_rule.session_id'
    in pg_get_functiondef(
      'public.whatsapp_webhook_has_lead_creation_context(jsonb)'::regprocedure
    )
  ) > 0
  and position(
    'inbound_rule.session_id = managed_context.session_id'
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

select * from finish();
rollback;
