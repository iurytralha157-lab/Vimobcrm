begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'phone'
  ),
  'text',
  'the canonical lead phone remains text'
);

select ok(
  position(
    'l.whatsapp'
    in pg_get_functiondef(
      'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)'::regprocedure
    )
  ) = 0,
  'conversation resolution does not reference the removed leads.whatsapp column'
);

select ok(
  position(
    $$nullif(l.phone, '')$$
    in pg_get_functiondef(
      'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)'::regprocedure
    )
  ) > 0,
  'conversation resolution reads the canonical lead phone'
);

select ok(
  position(
    'is_archived'
    in pg_get_functiondef(
      'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)'::regprocedure
    )
  ) = 0,
  'conversation resolution uses archived_at as the canonical archive state'
);

select ok(
  position(
    'on conflict (session_id, remote_jid)'
    in pg_get_functiondef(
      'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)'::regprocedure
    )
  ) > 0,
  'conversation resolution uses the live unique session/JID identity'
);

select is(
  (
    select proconfig
    from pg_proc
    where oid = 'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)'::regprocedure
  ),
  array['search_path=""']::text[],
  'the privileged resolver has an empty search path'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)',
    'execute'
  ),
  false,
  'authenticated users cannot invoke the automation resolver'
);

select is(
  has_function_privilege(
    'service_role',
    'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)',
    'execute'
  ),
  true,
  'the trusted automation worker can invoke the resolver'
);

select * from finish();
rollback;
