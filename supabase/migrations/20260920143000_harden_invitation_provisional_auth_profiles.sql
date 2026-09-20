-- Keep invitation-owned Auth identities out of the active CRM user population
-- until the invitation activation transaction creates/reactivates membership.
-- Public onboarding deliberately retains its existing lifecycle.

-- Do not silently replace a conflicting Auth trigger. Self-hosted restores can
-- omit triggers on auth.users even when the function survived the restore, so
-- an absent canonical trigger is repaired below after the function is replaced.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation
      on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc as procedure
      on procedure.oid = trigger.tgfoid
    join pg_catalog.pg_namespace as procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where trigger.tgname = 'on_auth_user_created'
      and trigger.tgisinternal = false
      and relation_namespace.nspname = 'auth'
      and relation.relname = 'users'
      and not (
        trigger.tgenabled in ('O', 'A')
        and trigger.tgqual is null
        -- PostgreSQL trigger type bits: ROW (1) + INSERT (4), with neither
        -- BEFORE (2) nor INSTEAD OF (64), means AFTER INSERT FOR EACH ROW.
        and trigger.tgtype = 5
        and procedure_namespace.nspname = 'public'
        and procedure.proname = 'handle_new_auth_user'
      )
  ) then
    raise exception 'conflicting auth.users.on_auth_user_created trigger must be reconciled before this migration';
  end if;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_provisioning_source text := btrim(coalesce(new.raw_app_meta_data ->> 'provisioning_source', ''));
  user_provisioning_source text := btrim(coalesce(new.raw_user_meta_data ->> 'provisioning_source', ''));
  app_invitation_id text := btrim(coalesce(new.raw_app_meta_data ->> 'invitation_id', ''));
  user_invitation_id text := btrim(coalesce(new.raw_user_meta_data ->> 'invitation_id', ''));
  provisional_invitation boolean;
begin
  provisional_invitation :=
    (
      app_provisioning_source = 'admin_invitation'
      and user_provisioning_source = ''
      and app_invitation_id
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    or (
      app_provisioning_source = ''
      and user_provisioning_source = ''
      and app_invitation_id = ''
      and user_invitation_id = ''
      and new.invited_at is not null
      and new.email_confirmed_at is null
      and new.last_sign_in_at is null
      and coalesce(new.encrypted_password, '') = ''
    );

  insert into public.users (
    id,
    email,
    name,
    role,
    is_active,
    organization_id,
    avatar_url,
    created_at
  )
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), new.email),
    'user',
    not provisional_invitation,
    null,
    null,
    now()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = excluded.name,
    is_active = case
      when provisional_invitation
        and public.users.organization_id is null
        and coalesce(lower(nullif(btrim(public.users.role), '')), 'user') = 'user'
        and not exists (
          select 1
          from public.organization_members as membership
          where membership.user_id = public.users.id
        )
        and not exists (
          select 1
          from public.organizations as organization
          where organization.created_by = public.users.id
        )
        and not exists (
          select 1
          from public.onboarding_requests as onboarding_request
          where onboarding_request.user_id = public.users.id
        )
        and not exists (
          select 1
          from public.legal_consents as consent
          where consent.user_id = public.users.id
        )
      then false
      else public.users.is_active
    end;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
grant execute on function public.handle_new_auth_user() to service_role;

-- Recreate the canonical trigger in the same migration. DROP/CREATE also
-- normalizes a valid restored trigger without widening its execution surface.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Repair only identities that still have no CRM/onboarding footprint. Accepted
-- invitations are excluded by membership/organization/consent evidence. An
-- admin_invitation marker remains authoritative even when its original pending
-- invitation expired or was deleted, so a replacement invitation can safely
-- resume that interrupted identity instead of sending it into an inactive-login
-- dead end. Unmarked identities that are confirmed or have a password are left
-- untouched because they cannot be safely attributed to an invitation.
update public.users as profile
set is_active = false,
    updated_at = now()
from auth.users as auth_user
where profile.id = auth_user.id
  and coalesce(profile.is_active, false) = true
  and profile.organization_id is null
  and coalesce(lower(nullif(btrim(profile.role), '')), 'user') = 'user'
  and auth_user.deleted_at is null
  and not exists (
    select 1
    from public.organization_members as membership
    where membership.user_id = auth_user.id
  )
  and not exists (
    select 1
    from public.organizations as organization
    where organization.created_by = auth_user.id
  )
  and not exists (
    select 1
    from public.onboarding_requests as onboarding_request
    where onboarding_request.user_id = auth_user.id
  )
  and not exists (
    select 1
    from public.legal_consents as consent
    where consent.user_id = auth_user.id
  )
  and (
    (
      btrim(coalesce(auth_user.raw_app_meta_data ->> 'provisioning_source', '')) = 'admin_invitation'
      and btrim(coalesce(auth_user.raw_user_meta_data ->> 'provisioning_source', '')) = ''
      and btrim(coalesce(auth_user.raw_app_meta_data ->> 'invitation_id', ''))
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    or (
      btrim(coalesce(auth_user.raw_app_meta_data ->> 'provisioning_source', '')) = ''
      and btrim(coalesce(auth_user.raw_user_meta_data ->> 'provisioning_source', '')) = ''
      and btrim(coalesce(auth_user.raw_app_meta_data ->> 'invitation_id', '')) = ''
      and btrim(coalesce(auth_user.raw_user_meta_data ->> 'invitation_id', '')) = ''
      and auth_user.invited_at is not null
      and auth_user.email_confirmed_at is null
      and auth_user.last_sign_in_at is null
      and coalesce(auth_user.encrypted_password, '') = ''
    )
  );
