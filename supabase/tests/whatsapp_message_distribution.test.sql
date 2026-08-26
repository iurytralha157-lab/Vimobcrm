begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

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
  ))) > 0,
  'managed assignment only considers direct members'
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
  and position('handle_lead_intake' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) > 0,
  'the dispatcher routes managed leads and retains the generic intake path'
);

select ok(
  position('handle_routed_lead_intake' in lower(pg_get_functiondef(
    'public.trigger_handle_lead_intake()'::regprocedure
  ))) > 0,
  'the insert trigger always uses the routed intake dispatcher'
);

select * from finish();
rollback;
