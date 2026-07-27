alter table public.organizations
  add column if not exists property_edit_policy text not null default 'responsible_or_admin',
  add column if not exists property_owner_contact_visibility text not null default 'visible';

update public.organizations
set
  property_edit_policy = coalesce(nullif(property_edit_policy, ''), 'responsible_or_admin'),
  property_owner_contact_visibility = coalesce(nullif(property_owner_contact_visibility, ''), 'visible');

alter table public.organizations
  drop constraint if exists organizations_property_edit_policy_check;

alter table public.organizations
  add constraint organizations_property_edit_policy_check
  check (property_edit_policy in ('everyone', 'responsible_or_admin'));

alter table public.organizations
  drop constraint if exists organizations_property_owner_contact_visibility_check;

alter table public.organizations
  add constraint organizations_property_owner_contact_visibility_check
  check (property_owner_contact_visibility in ('visible', 'hidden'));
