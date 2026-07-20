begin;

do $contract$
declare
  v_has_rows boolean := false;
begin
  if to_regclass('public.telephony_calls') is not null then
    execute 'select exists (select 1 from public.telephony_calls)'
      into v_has_rows;
  end if;

  if v_has_rows then
    raise exception using
      errcode = '55000',
      message = 'get_telephony_metrics retirement requires manual review because telephony_calls contains data';
  end if;
end
$contract$;

drop function if exists public.get_telephony_metrics(
  uuid, timestamptz, timestamptz, uuid
);

commit;
