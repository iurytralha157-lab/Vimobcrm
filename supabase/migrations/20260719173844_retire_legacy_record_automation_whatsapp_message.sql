begin;

do $contract$
declare
  v_canonical_oid regprocedure := to_regprocedure(
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'
  );
begin
  if v_canonical_oid is null then
    raise exception using
      errcode = '55000',
      message = 'cannot retire legacy automation message recording without the canonical WhatsApp outbox';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid = v_canonical_oid
      and p.prosecdef
  ) then
    raise exception using
      errcode = '55000',
      message = 'canonical automation WhatsApp outbox must remain SECURITY INVOKER';
  end if;

  if not has_function_privilege('service_role', v_canonical_oid::oid, 'execute')
     or has_function_privilege('anon', v_canonical_oid::oid, 'execute')
     or has_function_privilege('authenticated', v_canonical_oid::oid, 'execute') then
    raise exception using
      errcode = '55000',
      message = 'canonical automation WhatsApp outbox privileges do not match the backend-only contract';
  end if;
end
$contract$;

drop function if exists public.record_automation_whatsapp_message(
  uuid, uuid, text, text, uuid, uuid, text, text, text, text, text, text,
  bigint, text, jsonb
);

commit;
