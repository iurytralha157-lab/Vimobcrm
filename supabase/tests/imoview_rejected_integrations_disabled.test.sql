begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

select is(
  (select count(*) from public.imoview_integrations where is_active and last_error like '%401%'),
  0::bigint,
  'Rejected Imoview credentials are never scheduled'
);

select is(
  (select count(*) from public.imoview_integrations where status = 'disabled' and is_active),
  0::bigint,
  'Disabled Imoview integrations cannot remain active'
);

select is(
  (select count(*) from public.imoview_integrations where api_key is not null),
  0::bigint,
  'Imoview API keys remain write-only in Vault'
);

select * from finish();
rollback;
