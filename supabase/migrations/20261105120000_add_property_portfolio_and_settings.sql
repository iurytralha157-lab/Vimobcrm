-- Property portfolio classification and organization-level portfolio settings.
--
-- Additive and safe for the previous API version: every new properties column
-- is nullable or has a constant default (no table rewrite), and the previous
-- API projects property responses through explicit allowlists, so it neither
-- reads nor returns these columns.
--
-- Contact privacy: partner_contact follows the owner contact rule. Only the Go
-- API serves it, through its allowlisted projection. The public-site, portal,
-- publication and AI catalog readers select explicit columns or explicit keys.
--
-- The backfill must not look like an edit. properties.updated_at is the
-- optimistic-concurrency token of open forms and the publication source
-- revision, so advancing it would raise false conflicts and mark published
-- launches as out of date. The only unconditional trigger that writes the row
-- is update_properties_updated_at, disabled for this one statement while the
-- transaction already holds ACCESS EXCLUSIVE from ADD COLUMN. No other trigger
-- reacts to portfolio_type, and the zz_tenant_ref_* triggers return early for
-- unchanged references.
--
-- Launch definition: finalidade = 'lancamento' is what /properties/launches
-- filters on, and property_development_unit_deal_type_sync guarantees every
-- property linked to a development unit has it. Rows linked to a unit are also
-- matched explicitly in case production holds a row that predates that guard.
--
-- Rollback while unused (destroys third-party data entered since the migration):
--   drop trigger ac_properties_portfolio_from_deal_type on public.properties;
--   drop function private.derive_property_portfolio_from_deal_type();
--   drop index public.properties_org_portfolio_catalog_idx;
--   alter table public.properties
--     drop constraint properties_third_party_consistency_check,
--     drop constraint properties_partner_fields_check,
--     drop column third_party_authorized_until,
--     drop column commission_split_percent,
--     drop column partner_contact,
--     drop column partner_name,
--     drop column third_party_kind,
--     drop column portfolio_type;
--   drop table public.property_settings;
-- The previous API version keeps working after that rollback. Roll back the API
-- first: the new API version requires these columns.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.properties
  add column portfolio_type text not null default 'ready',
  add column third_party_kind text,
  add column partner_name text,
  add column partner_contact text,
  add column commission_split_percent numeric(5,2),
  add column third_party_authorized_until date;

comment on column public.properties.portfolio_type is
  'Commercial portfolio: ready (default), launch or third_party. Launches follow the lancamento deal type.';
comment on column public.properties.third_party_kind is
  'Required only for third_party: partner (another agency or broker) or private_owner.';
comment on column public.properties.partner_contact is
  'Hidden under the same rule as owner contact fields. Served only by the Go API.';

alter table public.properties disable trigger update_properties_updated_at;

update public.properties as property
set portfolio_type = 'launch'
where property.portfolio_type = 'ready'
  and (
    lower(btrim(coalesce(property.finalidade, ''))) in ('lancamento', 'lançamento', 'launch', 'release')
    or exists (
      select 1
      from public.property_development_units as unit
      where unit.organization_id = property.organization_id
        and unit.property_id = property.id
    )
  );

alter table public.properties enable trigger update_properties_updated_at;

-- Every existing row has third_party_kind and the partner columns null, and is
-- now ready or launch, so all four constraints accept pre-existing data.
alter table public.properties
  add constraint properties_portfolio_type_check
    check (portfolio_type in ('ready', 'launch', 'third_party')) not valid,
  add constraint properties_third_party_kind_check
    check (third_party_kind is null or third_party_kind in ('partner', 'private_owner')) not valid,
  add constraint properties_commission_split_percent_check
    check (commission_split_percent is null or commission_split_percent between 0 and 100) not valid,
  add constraint properties_third_party_consistency_check
    check (
      case
        when portfolio_type = 'third_party' then third_party_kind is not null
        else third_party_kind is null
          and commission_split_percent is null
          and third_party_authorized_until is null
      end
    ) not valid,
  add constraint properties_partner_fields_check
    check (
      case
        when third_party_kind = 'partner' then
          length(btrim(coalesce(partner_name, ''))) between 1 and 160
          and (partner_contact is null or length(partner_contact) <= 200)
        else partner_name is null and partner_contact is null
      end
    ) not valid;

alter table public.properties validate constraint properties_portfolio_type_check;
alter table public.properties validate constraint properties_third_party_kind_check;
alter table public.properties validate constraint properties_commission_split_percent_check;
alter table public.properties validate constraint properties_third_party_consistency_check;
alter table public.properties validate constraint properties_partner_fields_check;

-- Writers that do not know this column (the previous API during the rollout,
-- provider imports and legacy clients) must still classify launches correctly.
-- Runs after aa_properties_normalize_deal_type, which canonicalizes finalidade.
-- An explicit portfolio change and third-party classification are never replaced.
create function private.derive_property_portfolio_from_deal_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.portfolio_type = 'third_party' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.portfolio_type is distinct from old.portfolio_type then
    return new;
  end if;
  if new.finalidade = 'lancamento' and new.portfolio_type = 'ready' then
    new.portfolio_type := 'launch';
  elsif tg_op = 'UPDATE' and new.finalidade <> 'lancamento' and new.portfolio_type = 'launch' then
    new.portfolio_type := 'ready';
  end if;
  return new;
end;
$$;

revoke all on function private.derive_property_portfolio_from_deal_type()
  from public, anon, authenticated, service_role;

create trigger ac_properties_portfolio_from_deal_type
before insert or update of finalidade, tipo_de_negocio
on public.properties
for each row execute function private.derive_property_portfolio_from_deal_type();

-- 'ready' is the large majority and keeps using the existing catalog index.
create index properties_org_portfolio_catalog_idx
  on public.properties (organization_id, portfolio_type, created_at desc, id desc)
  where portfolio_type <> 'ready';

-- Stored settings only: nothing reads them to change publication or edit
-- behaviour in this release. The Go API owns the key allowlist and defaults.
create table public.property_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint property_settings_object_check
    check (jsonb_typeof(settings) = 'object'),
  constraint property_settings_revision_check
    check (revision >= 1)
);

-- Served only by the permission-checked Go API: browser roles receive neither
-- Data API privileges nor RLS policies.
alter table public.property_settings enable row level security;
revoke all on table public.property_settings from public, anon, authenticated;

commit;
