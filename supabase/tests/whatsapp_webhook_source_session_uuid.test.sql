begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'source_session_id'
  ),
  'uuid',
  'lead source_session_id remains a UUID foreign key'
);

select ok(
  position(
    'p_source_session_id::text'
    in pg_get_functiondef(
      'public.upsert_whatsapp_webhook_lead(uuid,text,text,text,text,timestamptz,text,uuid,text,text,text,uuid,uuid,uuid,timestamptz,uuid,uuid,uuid,timestamptz,text,timestamptz,jsonb)'::regprocedure
    )
  ) = 0,
  'the WhatsApp lead upsert never coerces the source session UUID to text'
);

select ok(
  position(
    'source_session_id = coalesce(l.source_session_id, p_source_session_id)'
    in pg_get_functiondef(
      'public.upsert_whatsapp_webhook_lead(uuid,text,text,text,text,timestamptz,text,uuid,text,text,text,uuid,uuid,uuid,timestamptz,uuid,uuid,uuid,timestamptz,text,timestamptz,jsonb)'::regprocedure
    )
  ) > 0,
  'existing leads retain or receive a UUID source session'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.upsert_whatsapp_webhook_lead(uuid,text,text,text,text,timestamptz,text,uuid,text,text,text,uuid,uuid,uuid,timestamptz,uuid,uuid,uuid,timestamptz,text,timestamptz,jsonb)',
    'execute'
  ),
  false,
  'authenticated users cannot invoke the privileged webhook lead upsert'
);

select is(
  has_function_privilege(
    'service_role',
    'public.upsert_whatsapp_webhook_lead(uuid,text,text,text,text,timestamptz,text,uuid,text,text,text,uuid,uuid,uuid,timestamptz,uuid,uuid,uuid,timestamptz,text,timestamptz,jsonb)',
    'execute'
  ),
  true,
  'only the trusted webhook processor can invoke the lead upsert'
);

select * from finish();
rollback;
