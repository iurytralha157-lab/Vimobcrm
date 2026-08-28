begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

select has_table(
  'public',
  'home_publications',
  'Home publications table exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.home_publications'::regclass),
  'Home publications retain RLS protection'
);

select results_eq(
  $$select count(*)::bigint from pg_policies where schemaname = 'public' and tablename = 'home_publications'$$,
  array[0::bigint],
  'Home publications are API-only and expose no direct client policies'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.home_publications',
    'select,insert,update,delete'
  ),
  'Anonymous users have no home publication CRUD privileges'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.home_publications',
    'select,insert,update,delete'
  ),
  'Authenticated users have no direct home publication CRUD privileges'
);

select ok(
  has_table_privilege('service_role', 'public.home_publications', 'select'),
  'Service role can read home publications'
);

select ok(
  has_table_privilege('service_role', 'public.home_publications', 'insert'),
  'Service role can create home publications'
);

select ok(
  has_table_privilege('service_role', 'public.home_publications', 'update'),
  'Service role can update home publications'
);

select ok(
  has_table_privilege('service_role', 'public.home_publications', 'delete'),
  'Service role can delete home publications'
);

select ok(
  not has_table_privilege('service_role', 'public.home_publications', 'truncate'),
  'Service role cannot truncate home publications'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'home_publications'
      and indexname in (
        'home_publications_active_schedule_order_idx',
        'home_publications_target_organization_ids_idx',
        'home_publications_target_user_ids_idx',
        'home_publications_target_roles_idx'
      )
  $$,
  array[4::bigint],
  'Schedule and target lookup indexes are installed'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.home_publications'::regclass
      and tgname = 'update_home_publications_updated_at'
      and not tgisinternal
      and tgenabled <> 'D'
  ),
  'Updated-at trigger is enabled'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_constraint
    where conrelid = 'public.home_publications'::regclass
      and conname in (
        'home_publications_title_length_check',
        'home_publications_body_length_check',
        'home_publications_cta_label_length_check',
        'home_publications_cta_href_internal_check',
        'home_publications_image_pair_check',
        'home_publications_card_size_check',
        'home_publications_accent_check',
        'home_publications_display_order_check',
        'home_publications_schedule_check',
        'home_publications_target_type_check',
        'home_publications_target_roles_check',
        'home_publications_target_shape_check'
      )
  $$,
  array[12::bigint],
  'All home publication data-integrity constraints are installed'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.home_publications
    where id in (
      '10000000-0000-4000-8000-000000000101'::uuid,
      '10000000-0000-4000-8000-000000000102'::uuid,
      '10000000-0000-4000-8000-000000000103'::uuid,
      '10000000-0000-4000-8000-000000000104'::uuid
    )
  $$,
  array[4::bigint],
  'The four initial home cards are seeded deterministically'
);

select results_eq(
  $$
    select id::text, cta_href, card_size, accent
    from public.home_publications
    where id in (
      '10000000-0000-4000-8000-000000000101'::uuid,
      '10000000-0000-4000-8000-000000000102'::uuid,
      '10000000-0000-4000-8000-000000000103'::uuid,
      '10000000-0000-4000-8000-000000000104'::uuid
    )
    order by id
  $$,
  $$
    values
      ('10000000-0000-4000-8000-000000000101', '/crm/pipelines', 'wide', 'orange'),
      ('10000000-0000-4000-8000-000000000102', '/crm/pipelines', 'half', 'violet'),
      ('10000000-0000-4000-8000-000000000103', '/agenda', 'compact', 'blue'),
      ('10000000-0000-4000-8000-000000000104', '/crm/conversas', 'half', 'emerald')
  $$,
  'Seeded cards use existing product routes and intended layouts'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.home_publications
    where id in (
      '10000000-0000-4000-8000-000000000101'::uuid,
      '10000000-0000-4000-8000-000000000102'::uuid,
      '10000000-0000-4000-8000-000000000103'::uuid,
      '10000000-0000-4000-8000-000000000104'::uuid
    )
      and is_active
      and target_type = 'all'
      and cardinality(target_organization_ids) = 0
      and cardinality(target_user_ids) = 0
      and cardinality(target_roles) = 0
  $$,
  array[4::bigint],
  'Seeded cards are active and globally targeted'
);

select is(
  (select public from storage.buckets where id = 'site-images'),
  true,
  'Home publication images use the established public site-images bucket'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'org admins manage site images'
      and 'authenticated' = any(roles)
      and coalesce(qual, '') ilike '%organizations%'
      and coalesce(with_check, '') ilike '%organizations%'
      and coalesce(qual, '') not ilike '%platform%'
      and coalesce(with_check, '') not ilike '%platform%'
  ),
  'Authenticated site-image mutations remain organization-scoped, excluding platform/home'
);

select results_eq(
  $$
    with expected(title) as (
      values
        ('Como começar a usar o Vimob?'),
        ('Como criar um lead no Pipeline?'),
        ('Como mover um lead entre etapas?'),
        ('Como acompanhar tarefas e cadências?'),
        ('Como criar e editar um agendamento?'),
        ('Como usar Conversas no Vimob?'),
        ('Como cadastrar e publicar imóveis?'),
        ('Como criar uma automação?'),
        ('Como funciona a distribuição de leads?'),
        ('Como usar os filtros do Dashboard?'),
        ('Como acompanhar notificações?'),
        ('Como gerenciar contatos?'),
        ('Como criar e gerenciar equipes?')
    )
    select count(*)::bigint
    from expected
    where exists (
      select 1
      from public.help_articles article
      where lower(regexp_replace(btrim(article.title), '\s+', ' ', 'g'))
        = lower(regexp_replace(btrim(expected.title), '\s+', ' ', 'g'))
    )
  $$,
  array[13::bigint],
  'Initial help coverage exists without depending on deterministic seed ids'
);

select results_eq(
  $$
    with expected(title) as (
      values
        ('Como começar a usar o Vimob?'),
        ('Como criar um lead no Pipeline?'),
        ('Como mover um lead entre etapas?'),
        ('Como acompanhar tarefas e cadências?'),
        ('Como criar e editar um agendamento?'),
        ('Como usar Conversas no Vimob?'),
        ('Como cadastrar e publicar imóveis?'),
        ('Como criar uma automação?'),
        ('Como funciona a distribuição de leads?'),
        ('Como usar os filtros do Dashboard?'),
        ('Como acompanhar notificações?'),
        ('Como gerenciar contatos?'),
        ('Como criar e gerenciar equipes?')
    )
    select count(*)::bigint
    from expected
    where exists (
      select 1
      from public.help_articles article
      where article.is_active = true
        and lower(regexp_replace(btrim(article.title), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(expected.title), '\s+', ' ', 'g'))
    )
  $$,
  array[13::bigint],
  'The initial help topics are active and searchable by the home assistant'
);

select throws_ok(
  $$
    insert into public.home_publications (
      id,
      title,
      body,
      cta_label,
      cta_href
    )
    values (
      '10000000-0000-4000-8000-000000000191',
      'Invalid external route',
      'This row must be rejected by the database allowlist.',
      'Open',
      '/\attacker.invalid'
    )
  $$,
  '23514',
  null,
  'Database CTA allowlist rejects browser-normalized external paths'
);

select throws_ok(
  $$
    insert into public.home_publications (
      id,
      title,
      body,
      cta_label,
      cta_href,
      target_type,
      target_roles
    )
    values (
      '10000000-0000-4000-8000-000000000192',
      'Invalid unreachable role',
      'This row must be rejected because manager is not a canonical membership role.',
      'Open',
      '/dashboard',
      'roles',
      array['manager']::text[]
    )
  $$,
  '23514',
  null,
  'Database targeting rejects unreachable membership roles'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000199', true);
set local role authenticated;

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner)
    values (
      'site-images',
      'platform/home/10000000-0000-4000-8000-000000000101/forged.webp',
      auth.uid()
    )
  $$,
  '42501',
  null,
  'Authenticated clients cannot mutate the backend-only platform/home prefix'
);

reset role;

select * from finish();
rollback;
