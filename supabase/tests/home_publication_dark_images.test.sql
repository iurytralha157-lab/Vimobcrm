begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'home_publications'
     and column_name in ('dark_image_url', 'dark_image_storage_path',
                         'dark_mobile_image_url', 'dark_mobile_image_storage_path')
     and is_nullable = 'YES'),
  4::bigint,
  'Dark variants add four nullable columns without changing existing rows'
);

select is(
  (select count(*) from pg_constraint
   where conrelid = 'public.home_publications'::regclass
     and conname in ('home_publications_dark_image_pair_check',
                     'home_publications_dark_mobile_image_pair_check')),
  2::bigint,
  'Both dark variants require matching URL and owned storage path'
);

select lives_ok($$
  insert into public.home_publications (
    id, title, body, cta_label, cta_href, image_url, image_storage_path, is_active
  ) values (
    '10000000-0000-4000-8000-000000000191', 'Synthetic banner', 'Synthetic banner body',
    'Open settings', '/settings', 'https://images.example.invalid/desktop.png',
    'platform/home/synthetic/desktop.png', false
  )
$$, 'Previous API can create a desktop publication without dark variants');

select lives_ok($$
  update public.home_publications
  set dark_image_url = 'https://images.example.invalid/dark.png',
      dark_image_storage_path = 'platform/home/synthetic/dark/desktop.png',
      dark_mobile_image_url = 'https://images.example.invalid/dark-mobile.png',
      dark_mobile_image_storage_path = 'platform/home/synthetic/dark/mobile/mobile.png'
  where id = '10000000-0000-4000-8000-000000000191'
$$, 'Dark desktop and mobile pairs can coexist with the previous desktop image');

select throws_ok($$
  update public.home_publications set dark_image_url = null
  where id = '10000000-0000-4000-8000-000000000191'
$$, '23514', null, 'Dark desktop path cannot remain without its URL');

select throws_ok($$
  update public.home_publications set dark_image_storage_path = null
  where id = '10000000-0000-4000-8000-000000000191'
$$, '23514', null, 'Dark desktop URL cannot remain without its path');

select throws_ok($$
  update public.home_publications set dark_mobile_image_url = null
  where id = '10000000-0000-4000-8000-000000000191'
$$, '23514', null, 'Dark mobile path cannot remain without its URL');

select throws_ok($$
  update public.home_publications set dark_mobile_image_storage_path = null
  where id = '10000000-0000-4000-8000-000000000191'
$$, '23514', null, 'Dark mobile URL cannot remain without its path');

select lives_ok($$
  update public.home_publications
  set dark_image_url = null, dark_image_storage_path = null,
      dark_mobile_image_url = null, dark_mobile_image_storage_path = null
  where id = '10000000-0000-4000-8000-000000000191'
$$, 'Dark variants can be detached together without deleting the publication');

select is(
  (select image_url from public.home_publications
   where id = '10000000-0000-4000-8000-000000000191'),
  'https://images.example.invalid/desktop.png',
  'Attaching and clearing dark variants preserves the previous desktop image'
);

select * from finish();
rollback;
