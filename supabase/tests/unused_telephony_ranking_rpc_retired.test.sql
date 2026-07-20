begin;

create extension if not exists pgtap with schema extensions;
select plan(2);

select ok(
  to_regprocedure(
    'public.get_telephony_ranking(uuid,timestamptz,timestamptz,integer)'
  ) is null,
  'the unused legacy telephony ranking RPC is retired'
);

select ok(
  to_regclass('public.telephony_calls') is null
  or exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'telephony_calls'
      and column_name = 'duration_seconds'
      and data_type = 'integer'
  ),
  'the optional telephony table contract is preserved when present'
);

select * from finish();
rollback;
