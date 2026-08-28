-- Harden the legacy real-estate aggregate without validating historical rows.
--
-- The application reads and mutates properties through the Vimob API. Direct
-- Data API access to property rows (which contain owner PII) is therefore
-- closed at the privilege layer. RLS remains as defense in depth and models
-- the same own/team/all visibility contract enforced by the API.

insert into public.available_permissions (
  key,
  name,
  description,
  category,
  label,
  domain
)
values
  (
    'property_view',
    'Ver imoveis',
    'Visualizar o catalogo de imoveis dentro do escopo proprio ou da equipe.',
    'properties',
    'Ver imoveis',
    'properties'
  ),
  (
    'property_manage',
    'Gerenciar imoveis',
    'Criar, editar, atribuir e excluir imoveis da organizacao.',
    'properties',
    'Gerenciar imoveis',
    'properties'
  )
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    label = excluded.label,
    domain = excluded.domain;

alter table public.properties
  alter column published_on_site set default false;

create or replace function private.can_view_property_record(
  target_organization_id uuid,
  target_created_by uuid,
  target_responsible_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    target_organization_id is not null
    and (select auth.uid()) is not null
    and (
      private.has_permission(target_organization_id, 'property_manage')
      or (
        private.has_permission(target_organization_id, 'property_view')
        and (
          target_created_by = (select auth.uid())
          or target_responsible_user_id = (select auth.uid())
          or exists (
            select 1
            from public.team_members as leader_member
            join public.teams as team
              on team.id = leader_member.team_id
             and team.organization_id = target_organization_id
             and coalesce(team.is_active, true) = true
            join public.team_members as scoped_member
              on scoped_member.team_id = leader_member.team_id
             and coalesce(scoped_member.is_active, true) = true
            where leader_member.user_id = (select auth.uid())
              and coalesce(leader_member.is_leader, false) = true
              and coalesce(leader_member.is_active, true) = true
              and scoped_member.user_id in (
                target_created_by,
                target_responsible_user_id
              )
          )
        )
      )
    );
$function$;

comment on function private.can_view_property_record(uuid, uuid, uuid) is
  'RLS helper for property_view own/team scope and property_manage organization-wide scope.';

revoke all on function private.can_view_property_record(uuid, uuid, uuid)
  from public, anon;
grant execute on function private.can_view_property_record(uuid, uuid, uuid)
  to authenticated, service_role;

create or replace function private.can_view_property_owner_record(
  target_organization_id uuid,
  target_owner_id uuid,
  target_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    target_organization_id is not null
    and target_owner_id is not null
    and (select auth.uid()) is not null
    and (
      private.has_permission(target_organization_id, 'property_manage')
      or (
        private.has_permission(target_organization_id, 'property_view')
        and (
          target_created_by = (select auth.uid())
          or exists (
            select 1
            from public.properties as property
            where property.organization_id = target_organization_id
              and property.owner_id = target_owner_id
              and private.can_view_property_record(
                property.organization_id,
                property.created_by,
                property.responsible_user_id
              )
          )
        )
      )
    );
$function$;

comment on function private.can_view_property_owner_record(uuid, uuid, uuid) is
  'Restricts owner rows to managers or owners linked to properties visible in own/team scope.';

revoke all on function private.can_view_property_owner_record(uuid, uuid, uuid)
  from public, anon;
grant execute on function private.can_view_property_owner_record(uuid, uuid, uuid)
  to authenticated, service_role;

-- Trigger-only helper. User references are valid when the target is an active
-- member of the tenant, uses it as the legacy primary organization, or is a
-- global super administrator operating in support mode.
create or replace function private.property_user_belongs_to_organization(
  target_organization_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    target_user_id is null
    or exists (
      select 1
      from public.users as app_user
      where app_user.id = target_user_id
        and coalesce(app_user.is_active, true) = true
        and (
          app_user.organization_id = target_organization_id
          or app_user.role = 'super_admin'
          or exists (
            select 1
            from public.user_roles as global_role
            where global_role.user_id = app_user.id
              and global_role.role = 'super_admin'
          )
          or exists (
            select 1
            from public.organization_members as member
            where member.organization_id = target_organization_id
              and member.user_id = app_user.id
              and coalesce(member.is_active, false) = true
          )
        )
    );
$function$;

revoke all on function private.property_user_belongs_to_organization(uuid, uuid)
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

  if reference_id is null
     or not private.property_user_belongs_to_organization(
       new.organization_id,
       reference_id
     ) then
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

alter table public.properties enable row level security;
alter table public.property_owners enable row level security;
alter table public.property_cities enable row level security;
alter table public.property_neighborhoods enable row level security;
alter table public.property_condominiums enable row level security;
alter table public.property_types enable row level security;

-- Remove the permissive legacy policy set before installing one canonical
-- policy per operation. This also reconciles environments that accumulated
-- policies under different historical names.
do $drop_legacy_property_policies$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any (
        array[
          'properties',
          'property_owners',
          'property_cities',
          'property_neighborhoods',
          'property_condominiums',
          'property_types'
        ]::text[]
      )
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$drop_legacy_property_policies$;

create policy "property scoped select"
on public.properties
for select
to authenticated
using (
  (select private.can_view_property_record(
    properties.organization_id,
    properties.created_by,
    properties.responsible_user_id
  ))
);

create policy "property managers insert"
on public.properties
for insert
to authenticated
with check (
  (select private.has_permission(properties.organization_id, 'property_manage'))
);

create policy "property managers update"
on public.properties
for update
to authenticated
using (
  (select private.has_permission(properties.organization_id, 'property_manage'))
)
with check (
  (select private.has_permission(properties.organization_id, 'property_manage'))
);

create policy "property managers delete"
on public.properties
for delete
to authenticated
using (
  (select private.has_permission(properties.organization_id, 'property_manage'))
);

create policy "property owners scoped select"
on public.property_owners
for select
to authenticated
using (
  (select private.can_view_property_owner_record(
    property_owners.organization_id,
    property_owners.id,
    property_owners.created_by
  ))
);

create policy "property managers insert owners"
on public.property_owners
for insert
to authenticated
with check (
  (select private.has_permission(property_owners.organization_id, 'property_manage'))
);

create policy "property managers update owners"
on public.property_owners
for update
to authenticated
using (
  (select private.has_permission(property_owners.organization_id, 'property_manage'))
)
with check (
  (select private.has_permission(property_owners.organization_id, 'property_manage'))
);

create policy "property managers delete owners"
on public.property_owners
for delete
to authenticated
using (
  (select private.has_permission(property_owners.organization_id, 'property_manage'))
);

create policy "property viewers select cities"
on public.property_cities
for select
to authenticated
using (
  (select private.has_permission(property_cities.organization_id, 'property_view'))
  or (select private.has_permission(property_cities.organization_id, 'property_manage'))
);

create policy "property managers insert cities"
on public.property_cities
for insert
to authenticated
with check (
  (select private.has_permission(property_cities.organization_id, 'property_manage'))
);

create policy "property managers update cities"
on public.property_cities
for update
to authenticated
using (
  (select private.has_permission(property_cities.organization_id, 'property_manage'))
)
with check (
  (select private.has_permission(property_cities.organization_id, 'property_manage'))
);

create policy "property managers delete cities"
on public.property_cities
for delete
to authenticated
using (
  (select private.has_permission(property_cities.organization_id, 'property_manage'))
);

create policy "property viewers select neighborhoods"
on public.property_neighborhoods
for select
to authenticated
using (
  (select private.has_permission(property_neighborhoods.organization_id, 'property_view'))
  or (select private.has_permission(property_neighborhoods.organization_id, 'property_manage'))
);

create policy "property managers insert neighborhoods"
on public.property_neighborhoods
for insert
to authenticated
with check (
  (select private.has_permission(property_neighborhoods.organization_id, 'property_manage'))
);

create policy "property managers update neighborhoods"
on public.property_neighborhoods
for update
to authenticated
using (
  (select private.has_permission(property_neighborhoods.organization_id, 'property_manage'))
)
with check (
  (select private.has_permission(property_neighborhoods.organization_id, 'property_manage'))
);

create policy "property managers delete neighborhoods"
on public.property_neighborhoods
for delete
to authenticated
using (
  (select private.has_permission(property_neighborhoods.organization_id, 'property_manage'))
);

create policy "property viewers select condominiums"
on public.property_condominiums
for select
to authenticated
using (
  (select private.has_permission(property_condominiums.organization_id, 'property_view'))
  or (select private.has_permission(property_condominiums.organization_id, 'property_manage'))
);

create policy "property managers insert condominiums"
on public.property_condominiums
for insert
to authenticated
with check (
  (select private.has_permission(property_condominiums.organization_id, 'property_manage'))
);

create policy "property managers update condominiums"
on public.property_condominiums
for update
to authenticated
using (
  (select private.has_permission(property_condominiums.organization_id, 'property_manage'))
)
with check (
  (select private.has_permission(property_condominiums.organization_id, 'property_manage'))
);

create policy "property managers delete condominiums"
on public.property_condominiums
for delete
to authenticated
using (
  (select private.has_permission(property_condominiums.organization_id, 'property_manage'))
);

create policy "property viewers select types"
on public.property_types
for select
to authenticated
using (
  (select private.has_permission(property_types.organization_id, 'property_view'))
  or (select private.has_permission(property_types.organization_id, 'property_manage'))
);

create policy "property managers insert types"
on public.property_types
for insert
to authenticated
with check (
  (select private.has_permission(property_types.organization_id, 'property_manage'))
);

create policy "property managers update types"
on public.property_types
for update
to authenticated
using (
  (select private.has_permission(property_types.organization_id, 'property_manage'))
)
with check (
  (select private.has_permission(property_types.organization_id, 'property_manage'))
);

create policy "property managers delete types"
on public.property_types
for delete
to authenticated
using (
  (select private.has_permission(property_types.organization_id, 'property_manage'))
);

-- Property and owner rows contain PII. Keep them behind the backend even for
-- authenticated clients. Location catalogs remain readable through RLS, but
-- all browser-side writes are closed.
revoke all on table public.properties, public.property_owners
  from public, anon, authenticated, service_role;

revoke all on table
  public.property_cities,
  public.property_neighborhoods,
  public.property_condominiums,
  public.property_types
  from public, anon, authenticated, service_role;

grant select on table
  public.property_cities,
  public.property_neighborhoods,
  public.property_condominiums,
  public.property_types
  to authenticated;

grant select, insert, update, delete on table
  public.properties,
  public.property_owners,
  public.property_cities,
  public.property_neighborhoods,
  public.property_condominiums,
  public.property_types
  to service_role;

-- Existing rows are intentionally not scanned during this rollout. New and
-- changed references must point to a real type, and the tenant trigger below
-- additionally requires that type to belong to the property organization.
do $add_property_type_fk$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.properties'::regclass
      and conname = 'properties_property_type_id_fkey'
  ) then
    alter table public.properties
      add constraint properties_property_type_id_fkey
      foreign key (property_type_id)
      references public.property_types(id)
      on delete set null
      not valid;
  end if;
end
$add_property_type_fk$;

create index if not exists properties_property_type_id_idx
  on public.properties (property_type_id)
  where property_type_id is not null;

-- Canonical tenant-reference triggers only inspect inserts and changed
-- references. Existing legacy mismatches do not make this migration fail and
-- do not block unrelated updates, while every new association is protected.
drop trigger if exists zz_tenant_ref_properties_owner_id
  on public.properties;
create trigger zz_tenant_ref_properties_owner_id
before insert or update on public.properties
for each row execute function private.enforce_tenant_reference(
  'property_owners',
  'owner_id'
);

drop trigger if exists zz_tenant_ref_properties_city_id
  on public.properties;
create trigger zz_tenant_ref_properties_city_id
before insert or update on public.properties
for each row execute function private.enforce_tenant_reference(
  'property_cities',
  'city_id'
);

drop trigger if exists zz_tenant_ref_properties_neighborhood_id
  on public.properties;
create trigger zz_tenant_ref_properties_neighborhood_id
before insert or update on public.properties
for each row execute function private.enforce_tenant_reference(
  'property_neighborhoods',
  'neighborhood_id'
);

drop trigger if exists zz_tenant_ref_properties_condominium_id
  on public.properties;
create trigger zz_tenant_ref_properties_condominium_id
before insert or update on public.properties
for each row execute function private.enforce_tenant_reference(
  'property_condominiums',
  'condominium_id'
);

drop trigger if exists zz_tenant_ref_properties_property_type_id
  on public.properties;
create trigger zz_tenant_ref_properties_property_type_id
before insert or update on public.properties
for each row execute function private.enforce_tenant_reference(
  'property_types',
  'property_type_id'
);

drop trigger if exists zz_tenant_ref_properties_corretor_id
  on public.properties;
create trigger zz_tenant_ref_properties_corretor_id
before insert or update on public.properties
for each row execute function private.enforce_property_user_tenant_scope(
  'corretor_id'
);

drop trigger if exists zz_tenant_ref_properties_created_by
  on public.properties;
create trigger zz_tenant_ref_properties_created_by
before insert or update on public.properties
for each row execute function private.enforce_property_user_tenant_scope(
  'created_by'
);

drop trigger if exists zz_tenant_ref_properties_responsible_user_id
  on public.properties;
create trigger zz_tenant_ref_properties_responsible_user_id
before insert or update on public.properties
for each row execute function private.enforce_property_user_tenant_scope(
  'responsible_user_id'
);

drop trigger if exists zz_tenant_ref_properties_cadastrado_por
  on public.properties;
create trigger zz_tenant_ref_properties_cadastrado_por
before insert or update on public.properties
for each row execute function private.enforce_property_user_tenant_scope(
  'cadastrado_por',
  'allow_legacy_text'
);

drop trigger if exists zz_tenant_ref_property_owners_created_by
  on public.property_owners;
create trigger zz_tenant_ref_property_owners_created_by
before insert or update on public.property_owners
for each row execute function private.enforce_property_user_tenant_scope(
  'created_by'
);

drop trigger if exists zz_tenant_ref_property_neighborhoods_city_id
  on public.property_neighborhoods;
create trigger zz_tenant_ref_property_neighborhoods_city_id
before insert or update on public.property_neighborhoods
for each row execute function private.enforce_tenant_reference(
  'property_cities',
  'city_id'
);

drop trigger if exists zz_tenant_ref_property_condominiums_city_id
  on public.property_condominiums;
create trigger zz_tenant_ref_property_condominiums_city_id
before insert or update on public.property_condominiums
for each row execute function private.enforce_tenant_reference(
  'property_cities',
  'city_id'
);

drop trigger if exists zz_tenant_ref_property_condominiums_neighborhood_id
  on public.property_condominiums;
create trigger zz_tenant_ref_property_condominiums_neighborhood_id
before insert or update on public.property_condominiums
for each row execute function private.enforce_tenant_reference(
  'property_neighborhoods',
  'neighborhood_id'
);

-- DEPRECATION: the legacy `properties` bucket intentionally remains public
-- until the site and portal publishers promote assets instead of persisting
-- public URLs directly. New originals and confidential documents belong in
-- this private bucket and are served by the backend with signed URLs.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'property-private',
  'property-private',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ]::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    updated_at = now();

do $drop_property_private_storage_policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%property-private%'
        or coalesce(with_check, '') ilike '%property-private%'
      )
  loop
    execute format(
      'drop policy %I on storage.objects',
      policy_row.policyname
    );
  end loop;
end
$drop_property_private_storage_policies$;

create policy "property private managers read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'property-private'
  and split_part(name, '/', 1) = 'orgs'
  and (select private.has_permission(
    private.safe_uuid(split_part(name, '/', 2)),
    'property_manage'
  ))
);

create policy "property private managers insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'property-private'
  and split_part(name, '/', 1) = 'orgs'
  and (select private.has_permission(
    private.safe_uuid(split_part(name, '/', 2)),
    'property_manage'
  ))
);

create policy "property private managers update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'property-private'
  and split_part(name, '/', 1) = 'orgs'
  and (select private.has_permission(
    private.safe_uuid(split_part(name, '/', 2)),
    'property_manage'
  ))
)
with check (
  bucket_id = 'property-private'
  and split_part(name, '/', 1) = 'orgs'
  and (select private.has_permission(
    private.safe_uuid(split_part(name, '/', 2)),
    'property_manage'
  ))
);

create policy "property private managers delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'property-private'
  and split_part(name, '/', 1) = 'orgs'
  and (select private.has_permission(
    private.safe_uuid(split_part(name, '/', 2)),
    'property_manage'
  ))
);
