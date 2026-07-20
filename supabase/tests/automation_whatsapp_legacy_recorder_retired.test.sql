begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(
  to_regprocedure(
    'public.record_automation_whatsapp_message(uuid,uuid,text,text,uuid,uuid,text,text,text,text,text,text,bigint,text,jsonb)'
  ) is null,
  'the provider-first legacy automation message recorder is retired'
);

select ok(
  to_regprocedure(
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'
  ) is not null,
  'the canonical DB-first automation WhatsApp outbox exists'
);

select is(
  (
    select p.prosecdef
    from pg_proc p
    where p.oid = 'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
  ),
  false,
  'the canonical outbox runs as SECURITY INVOKER'
);

select is(
  (
    select p.proconfig
    from pg_proc p
    where p.oid = 'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
  ),
  array['search_path=pg_catalog']::text[],
  'the canonical outbox has a fixed search path'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)',
    'execute'
  ),
  false,
  'authenticated users cannot invoke the automation outbox'
);

select is(
  has_function_privilege(
    'service_role',
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)',
    'execute'
  ),
  true,
  'the trusted automation worker can invoke the outbox'
);

select ok(
  position(
    'insert into public.whatsapp_messages'
    in pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    )
  ) > 0,
  'the canonical outbox persists outbound message history first'
);

select ok(
  position(
    'insert into public.whatsapp_outbox'
    in pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    )
  ) > 0,
  'the canonical outbox persists durable provider delivery work'
);

select ok(
  position(
    'insert into public.lead_timeline_events'
    in pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    )
  ) > 0
  and position(
    'update public.automation_effect_dispatches'
    in pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    )
  ) > 0,
  'the canonical path records timeline activity and closes the effect ledger'
);

select * from finish();
rollback;
