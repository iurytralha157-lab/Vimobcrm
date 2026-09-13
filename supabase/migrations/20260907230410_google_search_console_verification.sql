alter table public.organization_sites
  add column if not exists google_search_console_verification text;

comment on column public.organization_sites.google_search_console_verification is
  'Public Google Search Console HTML-tag verification token. Credentials and OAuth tokens must never be stored here.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organization_sites_google_search_console_verification_check'
      and conrelid = 'public.organization_sites'::regclass
  ) then
    alter table public.organization_sites
      add constraint organization_sites_google_search_console_verification_check
      check (
        google_search_console_verification is null
        or google_search_console_verification ~ '^[A-Za-z0-9_-]{10,255}$'
      ) not valid;
  end if;
end
$$;

alter table public.organization_sites
  validate constraint organization_sites_google_search_console_verification_check;
