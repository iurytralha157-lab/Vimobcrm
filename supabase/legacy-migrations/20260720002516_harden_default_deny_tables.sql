-- Tables with RLS enabled and no policy are intentionally backend-only: RLS
-- already denies every client row. Remove inherited Data API grants as a second
-- independent layer so a future policy cannot accidentally expose them.
do $revoke_client_access$
declare
  target record;
begin
  for target in
    select format('%I.%I', n.nspname, c.relname) as qualified_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (
        select 1
        from pg_policy p
        where p.polrelid = c.oid
      )
  loop
    execute format('revoke all privileges on table %s from anon, authenticated', target.qualified_name);
  end loop;
end;
$revoke_client_access$;

comment on table public.automation_event_outbox is
  'Backend-only table: RLS without policies and no client grants intentionally enforce default deny.';
