alter table public.properties
  alter column published_on_site set default true;

update public.properties
set published_on_site = true,
    updated_at = now()
where published_on_site is distinct from true;
