-- These SECURITY DEFINER functions are trigger-only credential shims. They
-- must not remain directly executable through PUBLIC or Data API roles.

revoke execute on function private.meta_store_access_token()
  from public, anon, authenticated, service_role;

revoke execute on function private.meta_store_user_access_token()
  from public, anon, authenticated, service_role;

comment on function private.meta_store_access_token() is
  'Trigger-only: stores the Meta Page token in Vault and clears plaintext before persistence.';

comment on function private.meta_store_user_access_token() is
  'Trigger-only: stores the Meta user token in Vault and clears plaintext before persistence.';
