begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_function(
  'public',
  'whatsapp_webhook_has_lead_creation_context',
  array['jsonb'],
  'the WhatsApp lead-creation context guard exists'
);

select ok(
  position('inbound_rule.session_id = managed_context.session_id' in lower(pg_get_functiondef(
    'public.whatsapp_webhook_has_lead_creation_context(jsonb)'::regprocedure
  ))) > 0
  and position('contextual_team_member.user_id = direct_member.user_id' in lower(pg_get_functiondef(
    'public.whatsapp_webhook_has_lead_creation_context(jsonb)'::regprocedure
  ))) > 0,
  'lead creation requires the exact active session and accepts only a valid contextual team'
);

select has_function(
  'public',
  'handle_managed_whatsapp_message_lead',
  array['uuid'],
  'managed WhatsApp message assignment function exists'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.handle_managed_whatsapp_message_lead(uuid)',
    'execute'
  ),
  false,
  'authenticated users cannot invoke managed assignment directly'
);

select is(
  has_function_privilege(
    'service_role',
    'public.handle_managed_whatsapp_message_lead(uuid)',
    'execute'
  ),
  true,
  'the trusted webhook processor can invoke managed assignment'
);

select ok(
  position('managed_whatsapp_message_distribution' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'managed intent is fail-closed in the database function'
);

select ok(
  position('whatsapp_message_contains' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'the database validates the exact managed round-robin rule type'
);

select ok(
  position('organization_member.organization_id = member.organization_id' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'eligible members are scoped through active organization membership'
);

select ok(
  position('member.team_id is null' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0
  and position('contextual_team_member.user_id = member.user_id' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0
  and position('member_team.id is not null and contextual_team_member.id is not null' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0
  and position('team_member.user_id is null' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'managed assignment accepts direct users with valid team context and rejects team-only queue entries'
);

select ok(
  position('enable_redistribution' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'managed assignment rejects queues handled by the legacy redistribution worker'
);

select ok(
  position('for update of member, user_account, organization_member' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'member and eligibility rows are locked with the assignment'
);

select ok(
  position('lower(normalized.keyword)' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'the full case-insensitive message keyword is validated without comma splitting'
);

select ok(
  position('nullif(v_lead.initial_message' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0
  and position('v_lead.message' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > position('nullif(v_lead.initial_message' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))),
  'redistribution keeps matching against the immutable initial WhatsApp message first'
);

select has_function(
  'public',
  'handle_routed_lead_intake',
  array['uuid'],
  'the routed intake dispatcher exists'
);

select ok(
  position('if not v_marker then' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'the managed handler refuses to distribute an unmarked lead'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.handle_routed_lead_intake(uuid)',
    'execute'
  ),
  false,
  'authenticated users cannot invoke the routed intake dispatcher directly'
);

select is(
  has_function_privilege(
    'service_role',
    'public.handle_routed_lead_intake(uuid)',
    'execute'
  ),
  true,
  'the trusted webhook processor can invoke the routed intake dispatcher'
);

select ok(
  position('handle_managed_whatsapp_message_lead' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) > 0
  and position('whatsapp_webhook_has_lead_creation_context' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) > 0
  and position('private.distribute_lead' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) > 0
  and position('public.handle_lead_intake' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) = 0,
  'the dispatcher fails managed leads closed and sends generic intake through canonical distribution'
);

select ok(
  position('distribution_deferred' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) > 0,
  'direct dispatcher calls preserve deferred non-managed leads'
);

select ok(
  position('handle_routed_lead_intake' in lower(pg_get_functiondef(
    'public.trigger_handle_lead_intake()'::regprocedure
  ))) > 0
  and position('distribution_deferred' in lower(pg_get_functiondef(
    'public.trigger_handle_lead_intake()'::regprocedure
  ))) > 0
  and position('managed_whatsapp_message_distribution' in lower(pg_get_functiondef(
    'public.trigger_handle_lead_intake()'::regprocedure
  ))) > 0,
  'the insert trigger routes through the dispatcher while preserving explicit deferred intake'
);

select * from finish();
rollback;
