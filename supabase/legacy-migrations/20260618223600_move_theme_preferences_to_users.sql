alter table public.users
  add column if not exists theme_mode text not null default 'system';

do $$
begin
  alter table public.users
    add constraint users_theme_mode_check
    check (theme_mode in ('light', 'dark', 'system'));
exception
  when duplicate_object then null;
end $$;

update public.users u
set theme_mode = o.theme_mode
from public.organizations o
where u.organization_id = o.id
  and o.theme_mode in ('light', 'dark', 'system')
  and u.theme_mode = 'system';

revoke update (
  organization_id,
  name,
  avatar_url,
  language,
  whatsapp,
  cpf,
  updated_at
) on public.users from authenticated;

grant update (
  organization_id,
  name,
  avatar_url,
  language,
  theme_mode,
  whatsapp,
  cpf,
  updated_at
) on public.users to authenticated;

alter table public.organizations
  drop column if exists theme_mode,
  drop column if exists accent_color;
