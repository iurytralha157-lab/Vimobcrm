begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.google_calendar_tokens'::regclass,
      'public.google_calendar_event_links'::regclass,
      'public.google_calendar_channels'::regclass,
      'public.google_calendar_sync_jobs'::regclass,
      'public.google_calendar_oauth_states'::regclass
    )
  ),
  'RLS remains enabled on every Google Calendar table'
);

select ok(
  (
    select bool_and(not has_table_privilege('anon', relation_name, privilege_name))
    from (
      values
        ('public.google_calendar_tokens'),
        ('public.google_calendar_event_links'),
        ('public.google_calendar_channels'),
        ('public.google_calendar_sync_jobs'),
        ('public.google_calendar_oauth_states')
    ) as relation(relation_name)
    cross join (
      values ('select'), ('insert'), ('update'), ('delete')
    ) as privilege(privilege_name)
  ),
  'anonymous clients cannot access Google Calendar state'
);

select ok(
  (
    select bool_and(not has_table_privilege('authenticated', relation_name, privilege_name))
    from (
      values
        ('public.google_calendar_tokens'),
        ('public.google_calendar_event_links'),
        ('public.google_calendar_channels'),
        ('public.google_calendar_sync_jobs'),
        ('public.google_calendar_oauth_states')
    ) as relation(relation_name)
    cross join (
      values ('select'), ('insert'), ('update'), ('delete')
    ) as privilege(privilege_name)
  ),
  'authenticated clients must use the backend instead of direct table access'
);

select ok(
  (
    select bool_and(has_table_privilege('service_role', relation_name, privilege_name))
    from (
      values
        ('public.google_calendar_tokens'),
        ('public.google_calendar_event_links'),
        ('public.google_calendar_channels'),
        ('public.google_calendar_sync_jobs'),
        ('public.google_calendar_oauth_states')
    ) as relation(relation_name)
    cross join (
      values ('select'), ('insert'), ('update'), ('delete')
    ) as privilege(privilege_name)
  ),
  'service role retains the Google Calendar worker privileges'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.google_calendar_get_token_secret(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.google_calendar_get_token_secret(uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.google_calendar_get_token_secret(uuid)',
    'execute'
  ),
  'only the backend service role can read OAuth tokens from Vault'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.reconcile_google_calendar_cron_jobs()',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.reconcile_google_calendar_cron_jobs()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.reconcile_google_calendar_cron_jobs()',
    'execute'
  ),
  'only the database owner can reconcile private Google Calendar cron jobs'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'google_calendar_tokens'
      and column_name in ('access_token', 'refresh_token')
  ),
  0::bigint,
  'plaintext OAuth token columns remain removed'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'google_calendar_event_links_schedule_event_id_fkey'
      and conrelid = 'public.google_calendar_event_links'::regclass
      and confdeltype = 'n'
  ),
  'deleting a Vimob event preserves its Google link for durable remote deletion'
);

do $setup$
declare
  secret_id uuid;
begin
  select id into secret_id
  from vault.secrets
  where name = 'google_calendar_sync_base_url'
  limit 1;

  if secret_id is null then
    perform vault.create_secret(
      'https://calendar-worker.example.test',
      'google_calendar_sync_base_url',
      'pgTAP Google Agenda worker URL'
    );
  else
    perform vault.update_secret(
      secret_id,
      'https://calendar-worker.example.test',
      'google_calendar_sync_base_url',
      'pgTAP Google Agenda worker URL'
    );
  end if;
end
$setup$;

select private.reconcile_google_calendar_cron_jobs();

select is(
  (
    select count(*)
    from cron.job
    where jobname in (
      'google-calendar-enqueue-due-pulls',
      'google-calendar-sync-jobs',
      'google-calendar-renew-watches'
    )
  ),
  3::bigint,
  'Google Calendar installs exactly three private cron jobs once configured'
);

select ok(
  exists (
    select 1 from cron.job
    where jobname = 'google-calendar-enqueue-due-pulls'
      and schedule = '* * * * *'
      and command ilike '%enqueue_due_pulls%'
  )
  and exists (
    select 1 from cron.job
    where jobname = 'google-calendar-sync-jobs'
      and schedule = '* * * * *'
      and command ilike '%run_due_jobs%'
  )
  and exists (
    select 1 from cron.job
    where jobname = 'google-calendar-renew-watches'
      and schedule = '17 3 * * *'
      and command ilike '%renew_watches%'
  ),
  'Google Calendar cron jobs keep their intended actions and cadences'
);

select ok(
  (
    select bool_and(
      command not ilike '%authorization%'
      and command not ilike '%service_role%'
      and command not ilike '%eyJ%'
    )
    from cron.job
    where jobname like 'google-calendar-%'
  ),
  'Google Calendar cron commands contain no JWT or service-role credential'
);

select * from finish();
rollback;
