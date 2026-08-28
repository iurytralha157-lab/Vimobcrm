begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select has_table(
  'public',
  'help_articles',
  'Help article catalog exists'
);

select columns_are(
  'public',
  'help_articles',
  array[
    'id',
    'category',
    'title',
    'content',
    'video_url',
    'image_url',
    'display_order',
    'is_active',
    'created_at',
    'updated_at',
    'slug',
    'summary',
    'module_key',
    'search_keywords',
    'visibility',
    'route_href',
    'action_label',
    'steps',
    'related_slugs',
    'estimated_minutes',
    'last_reviewed_at',
    'search_vector'
  ],
  'Help articles expose the complete editorial contract'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.help_articles'::regclass),
  'Help articles retain RLS protection'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'help_articles'
      and cmd = 'SELECT'
      and qual like '%is_active%'
  ),
  'Direct authenticated reads retain the active-article policy'
);

select ok(
  not has_table_privilege('anon', 'public.help_articles', 'select'),
  'Anonymous users cannot enumerate the editorial table'
);

select ok(
  has_table_privilege('authenticated', 'public.help_articles', 'select'),
  'Authenticated users retain active-article reads through RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.help_articles', 'insert')
  and not has_table_privilege('authenticated', 'public.help_articles', 'update')
  and not has_table_privilege('authenticated', 'public.help_articles', 'delete')
  and not has_table_privilege('authenticated', 'public.help_articles', 'truncate'),
  'Authenticated users cannot mutate or truncate help content directly'
);

select ok(
  has_table_privilege('service_role', 'public.help_articles', 'select')
  and has_table_privilege('service_role', 'public.help_articles', 'insert')
  and has_table_privilege('service_role', 'public.help_articles', 'update')
  and has_table_privilege('service_role', 'public.help_articles', 'delete'),
  'Backend service role can manage the catalog'
);

select ok(
  not has_table_privilege('service_role', 'public.help_articles', 'truncate'),
  'Backend service role cannot truncate the catalog'
);

select ok(
  (
    select column_default like '%authenticated%'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'help_articles'
      and column_name = 'visibility'
  ),
  'New editorial content defaults to authenticated visibility'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'help_articles'
      and indexname in (
        'help_articles_slug_unique_idx',
        'help_articles_active_catalog_idx',
        'help_articles_search_vector_idx'
      )
  $$,
  array[3::bigint],
  'Slug, catalog and full-text indexes are installed'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.help_articles'::regclass
      and tgname = 'refresh_help_article_search_vector'
      and not tgisinternal
      and tgenabled <> 'D'
  ),
  'Search-vector trigger is enabled'
);

select results_eq(
  $$select count(*)::bigint from public.help_articles where search_vector is null$$,
  array[0::bigint],
  'Every help article has an indexed search document'
);

select ok(
  (select count(*) >= 30 from public.help_articles),
  'The initial verified catalog contains at least thirty articles'
);

select ok(
  exists (
    select 1
    from public.help_articles
    where slug = 'como-criar-uma-automacao'
      and search_vector @@ websearch_to_tsquery('portuguese', 'criar automacao')
  ),
  'Automation guidance is discoverable without AI'
);

select ok(
  exists (
    select 1
    from public.help_articles
    where slug = 'como-convidar-um-usuario'
      and search_vector @@ websearch_to_tsquery('portuguese', 'sete dias')
  ),
  'Detailed instructions inside article steps are searchable'
);

select ok(
  exists (
    select 1
    from public.help_articles
    where slug = 'como-conectar-o-whatsapp'
      and search_vector @@ websearch_to_tsquery('portuguese', 'qr code whatsapp')
  ),
  'WhatsApp connection guidance is discoverable by operational terms'
);

select ok(
  exists (
    select 1
    from public.help_articles
    where slug = 'como-convidar-um-usuario'
      and jsonb_array_length(steps) >= 3
  ),
  'User invitation guidance contains structured steps'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.help_articles
    where visibility not in ('public', 'authenticated', 'all')
  $$,
  array[0::bigint],
  'Every article has a supported visibility'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.help_articles
    where route_href is not null
      and (route_href !~ '^/' or route_href ~ '^//')
  $$,
  array[0::bigint],
  'Article actions use internal Vimob paths'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.refresh_help_article_search_vector()',
    'execute'
  ),
  'Search trigger helper is not callable by authenticated clients'
);

select * from finish();
rollback;
