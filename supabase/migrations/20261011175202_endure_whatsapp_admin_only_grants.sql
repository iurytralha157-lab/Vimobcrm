-- Runtime grant eligibility is owner/admin only. A downgrade to manager must
-- permanently revoke grants from that administration term; promotion later
-- requires an explicit regrant with a new immutable grant ID.
-- Existing grant rows are not cleaned up by this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
declare
  v_definition text;
begin
  if pg_catalog.to_regprocedure('private.revoke_whatsapp_grants_on_org_member_change()') is null then
    raise exception 'WhatsApp organization grant revocation function is missing';
  end if;
  select pg_catalog.pg_get_functiondef(
    'private.revoke_whatsapp_grants_on_org_member_change()'::regprocedure::oid
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'access.grant_scope = ''organization''') = 0
     or pg_catalog.strpos(v_definition, 'old.deleted_at is null and new.deleted_at is not null') = 0
     or not (
       (pg_catalog.strpos(v_definition, 'lower(btrim(old.role)) in (''owner'', ''admin'', ''manager'')') > 0
        and pg_catalog.strpos(v_definition, 'lower(btrim(new.role)) not in (''owner'', ''admin'', ''manager'')') > 0)
       or (pg_catalog.strpos(v_definition, 'lower(btrim(old.role)) in (''owner'', ''admin'')') > 0
        and pg_catalog.strpos(v_definition, 'lower(btrim(new.role)) not in (''owner'', ''admin'')') > 0)
     ) then
    raise exception 'Unsupported WhatsApp organization grant revocation definition';
  end if;
end;
$guard$;

create or replace function private.revoke_whatsapp_grants_on_org_member_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.whatsapp_session_access access
    where access.organization_id = old.organization_id
      and (access.user_id = old.user_id or access.granted_by = old.user_id);
    return old;
  end if;

  if old.organization_id is distinct from new.organization_id
    or old.user_id is distinct from new.user_id
    or (coalesce(old.is_active, false) and not coalesce(new.is_active, false))
    or (old.deleted_at is null and new.deleted_at is not null)
  then
    delete from public.whatsapp_session_access access
    where access.organization_id = old.organization_id
      and (access.user_id = old.user_id or access.granted_by = old.user_id);
  elsif lower(btrim(old.role)) in ('owner', 'admin')
    and lower(btrim(new.role)) not in ('owner', 'admin')
  then
    delete from public.whatsapp_session_access access
    where access.organization_id = old.organization_id
      and access.grant_scope = 'organization'
      and access.granted_by = old.user_id;
  end if;
  return new;
end;
$function$;

revoke all on function private.revoke_whatsapp_grants_on_org_member_change()
  from public, anon, authenticated;

commit;
