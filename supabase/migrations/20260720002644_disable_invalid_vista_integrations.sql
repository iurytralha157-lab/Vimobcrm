-- Three legacy records stored an email address in api_url. They can never pass
-- the HTTPS/SSRF validation and were making every scheduled run fail. Preserve
-- the credentials and configuration for repair, but stop scheduling them until
-- an administrator supplies a valid Vista endpoint.
update public.vista_integrations
set is_active = false,
    status = 'disabled',
    last_error = 'invalid_vista_configuration_requires_api_url',
    updated_at = now()
where is_active = true
  and strpos(api_url, '@') > 0;
