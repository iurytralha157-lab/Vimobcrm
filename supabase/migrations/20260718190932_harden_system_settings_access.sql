-- system_settings contains platform credentials and operational configuration.
-- Public branding is exposed only through GET /v1/public/system-settings, where
-- the API returns a strict allowlist from the row whose key is "global".
drop policy if exists "system settings consolidated select" on public.system_settings;
drop policy if exists "public can read system settings" on public.system_settings;
drop policy if exists "Public can view system settings" on public.system_settings;
drop policy if exists "Authenticated users can view system settings" on public.system_settings;
drop policy if exists "Super admins can view system settings" on public.system_settings;
drop policy if exists "Allow public read system_settings" on public.system_settings;

revoke all privileges on table public.system_settings from public, anon, authenticated;
revoke all privileges on table public.system_settings from service_role;
grant select on table public.system_settings to service_role;

comment on table public.system_settings is
  'Private platform configuration. Client roles must use the sanitized public API; service_role is read-only.';
