begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

select is(
  (select count(*) from public.vista_integrations where is_active and strpos(api_url, '@') > 0),
  0::bigint,
  'Malformed Vista URLs are never scheduled'
);

select is(
  (select count(*) from public.vista_integrations where strpos(api_url, '@') > 0 and status <> 'disabled'),
  0::bigint,
  'Malformed Vista integrations are marked disabled'
);

select is(
  (select count(*) from public.vista_integrations where strpos(api_url, '@') = 0 and is_active),
  1::bigint,
  'The valid Vista integration remains active'
);

select * from finish();
rollback;
