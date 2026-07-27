-- The hardened scheduler confirmed that these active credentials are rejected
-- by the official Imoview endpoint with HTTP 401. Keep the Vault secrets for an
-- administrator to replace, but stop retrying invalid credentials three times
-- per day until they are reconfigured.
update public.imoview_integrations
set is_active = false,
    status = 'disabled',
    last_error = 'imoview_api_key_rejected_401_requires_reconfiguration',
    updated_at = now()
where is_active = true
  and last_error like 'API error page 1: 401%';
