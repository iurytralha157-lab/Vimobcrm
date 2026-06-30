alter table public.users
  add column if not exists theme_mode text default 'system';

update public.users
   set theme_mode = coalesce(nullif(theme_mode, ''), 'system');
