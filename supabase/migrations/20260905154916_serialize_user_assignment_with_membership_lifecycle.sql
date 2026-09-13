-- Serialize mutable user references with membership suspension/removal.
--
-- The lifecycle repository locks public.users before changing a membership.
-- Taking a KEY SHARE lock here makes a concurrent assignment wait for that
-- lifecycle transaction and then re-evaluate the active user/membership row.
-- Without the lock, a BEFORE trigger can validate the old snapshot, wait on
-- the foreign key, and commit a reference to a user immediately after removal.

create or replace function private.enforce_active_org_member_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  referenced_user_id uuid;
  locked_user_id uuid;
  locked_membership_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.organization_id is not distinct from old.organization_id
     and (to_jsonb(new) ->> tg_argv[0]) is not distinct from (to_jsonb(old) ->> tg_argv[0]) then
    return new;
  end if;

  referenced_user_id := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid;
  if referenced_user_id is null then
    return new;
  end if;

  select app_user.id
  into locked_user_id
  from public.users as app_user
  where app_user.id = referenced_user_id
    and coalesce(app_user.is_active, false) = true
  for key share;

  if locked_user_id is null then
    raise exception using
      errcode = '23514',
      message = format(
        'Usuario de %s nao e membro ativo da organizacao.',
        tg_argv[0]
      );
  end if;

  select membership.id
  into locked_membership_id
  from public.organization_members as membership
  where membership.organization_id = new.organization_id
    and membership.user_id = referenced_user_id
    and coalesce(membership.is_active, false) = true
    and membership.deleted_at is null
  for key share;

  if locked_membership_id is null then
    raise exception using
      errcode = '23514',
      message = format(
        'Usuario de %s nao e membro ativo da organizacao.',
        tg_argv[0]
      );
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_active_org_member_reference()
  from public, anon, authenticated, service_role;

create or replace function private.enforce_property_user_tenant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  reference_text text;
  reference_id uuid;
  locked_user_organization_id uuid;
  locked_user_role text;
  locked_membership_id uuid;
  allow_legacy_text boolean := tg_nargs > 1 and tg_argv[1] = 'allow_legacy_text';
begin
  if tg_op = 'UPDATE'
     and new.organization_id is not distinct from old.organization_id
     and (to_jsonb(new) ->> tg_argv[0]) is not distinct from (to_jsonb(old) ->> tg_argv[0]) then
    return new;
  end if;

  reference_text := nullif(btrim(to_jsonb(new) ->> tg_argv[0]), '');
  if reference_text is null then
    return new;
  end if;

  reference_id := private.safe_uuid(reference_text);
  if reference_id is null and allow_legacy_text then
    return new;
  end if;

  if reference_id is null then
    raise exception using
      errcode = '23514',
      message = format(
        'Referencia de usuario %s pertence a outra organizacao ou nao existe.',
        tg_argv[0]
      );
  end if;

  select app_user.organization_id, coalesce(app_user.role, '')
  into locked_user_organization_id, locked_user_role
  from public.users as app_user
  where app_user.id = reference_id
    and coalesce(app_user.is_active, true) = true
  for key share;

  if not found then
    raise exception using
      errcode = '23514',
      message = format(
        'Referencia de usuario %s pertence a outra organizacao ou nao existe.',
        tg_argv[0]
      );
  end if;

  if locked_user_organization_id = new.organization_id
     or locked_user_role = 'super_admin'
     or exists (
       select 1
       from public.user_roles as global_role
       where global_role.user_id = reference_id
         and global_role.role = 'super_admin'
     ) then
    return new;
  end if;

  select membership.id
  into locked_membership_id
  from public.organization_members as membership
  where membership.organization_id = new.organization_id
    and membership.user_id = reference_id
    and coalesce(membership.is_active, false) = true
    and membership.deleted_at is null
  for key share;

  if locked_membership_id is null then
    raise exception using
      errcode = '23514',
      message = format(
        'Referencia de usuario %s pertence a outra organizacao ou nao existe.',
        tg_argv[0]
      );
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_property_user_tenant_scope()
  from public, anon, authenticated, service_role;
