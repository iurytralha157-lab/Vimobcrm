-- External notification delivery is a backend-owned outbox.
--
-- Allowing browser roles to insert arbitrary metadata here lets a tenant ask
-- the trusted Resend/WhatsApp workers to contact unrelated recipients. All UI
-- reads and mutations already go through the Vimob API, so direct PostgREST
-- access is both unnecessary and unsafe.

alter table public.notifications enable row level security;

do $policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
  loop
    execute format(
      'drop policy if exists %I on public.notifications',
      policy_row.policyname
    );
  end loop;
end
$policies$;

revoke all privileges on table public.notifications
  from PUBLIC, anon, authenticated;
grant select, insert, update, delete on table public.notifications
  to service_role;

-- Keep the helper callable only by trusted backend jobs. Its invoker-security
-- behavior is intentional: callers must also own table privileges.
revoke all privileges on function public.create_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid
) from PUBLIC, anon, authenticated;
grant execute on function public.create_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid
) to service_role;

comment on table public.notifications is
  'Backend-owned in-app notification and external delivery outbox; browser roles have no direct access.';
