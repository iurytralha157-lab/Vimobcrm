create extension if not exists pgcrypto with schema extensions;

create or replace function private.generate_organization_api_key_impl(p_name text, p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  raw_key text;
  prefix text;
begin
  if not (
    private.has_permission(p_organization_id, 'settings_manage')
    or private.has_org_role(p_organization_id, array['owner', 'admin'])
  ) then
    raise exception 'Sem permissao para gerar chave de API';
  end if;

  raw_key := 'vimob_' || encode(extensions.gen_random_bytes(32), 'hex');
  prefix := substring(raw_key from 1 for 14);

  insert into public.organization_api_keys (
    organization_id,
    name,
    key_prefix,
    key_hash,
    created_by
  )
  values (
    p_organization_id,
    coalesce(nullif(trim(p_name), ''), 'Chave Padrao'),
    prefix,
    encode(extensions.digest(raw_key, 'sha256'), 'hex'),
    auth.uid()
  );

  return raw_key;
end;
$$;

revoke execute on function private.generate_organization_api_key_impl(text, uuid) from public, anon, authenticated;
grant execute on function private.generate_organization_api_key_impl(text, uuid) to service_role;
