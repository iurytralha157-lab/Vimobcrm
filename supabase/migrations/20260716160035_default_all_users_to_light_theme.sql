update public.users
set theme_mode = 'light',
    updated_at = now()
where theme_mode is distinct from 'light';

alter table public.users
  alter column theme_mode set default 'light';
