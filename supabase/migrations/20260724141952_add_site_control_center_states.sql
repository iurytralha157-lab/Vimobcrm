alter table public.organization_sites
  add column if not exists maintenance_mode boolean not null default false,
  add column if not exists maintenance_message text,
  add column if not exists domain_verification_token uuid not null default gen_random_uuid();

alter table public.organization_sites
  drop constraint if exists organization_sites_maintenance_message_length;

alter table public.organization_sites
  add constraint organization_sites_maintenance_message_length
  check (maintenance_message is null or char_length(maintenance_message) <= 500);

alter table public.organization_sites
  drop constraint if exists organization_sites_subdomain_format,
  drop constraint if exists organization_sites_custom_domain_format;

alter table public.organization_sites
  add constraint organization_sites_subdomain_format
  check (
    subdomain is null
    or (
      char_length(subdomain) between 3 and 63
      and subdomain = lower(subdomain)
      and subdomain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    )
  ),
  add constraint organization_sites_custom_domain_format
  check (
    custom_domain is null
    or (
      char_length(custom_domain) between 3 and 253
      and custom_domain = lower(custom_domain)
      and custom_domain like '%.%'
      and position('..' in custom_domain) = 0
      and custom_domain !~ '[:/]'
      and custom_domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    )
  );

comment on column public.organization_sites.maintenance_mode is
  'Keeps the public address resolvable while rendering the tenant maintenance screen.';

comment on column public.organization_sites.maintenance_message is
  'Optional tenant-facing maintenance message. Limited to 500 characters.';

comment on column public.organization_sites.domain_verification_token is
  'Public ownership challenge rendered by the tenant Cloudflare Worker.';
