begin;

-- Invitation acceptance is handled by the Go API, which atomically claims an
-- invitation through used_at and creates/updates organization membership in a
-- transaction. This legacy service-role RPC has no callers and still refers to
-- the removed accepted_at column, so keeping it exposes a permanently broken
-- privileged contract.
drop function if exists public.accept_invite(text);

-- The public and authenticated acceptance endpoints resolve an invitation by
-- its token. Tokens are credentials: the database must guarantee that one
-- token can never identify more than one invitation.
do $migration$
begin
  if exists (
    select 1
    from public.invitations
    group by token
    having count(*) > 1
  ) then
    raise exception
      'cannot enforce unique invitation tokens while duplicate tokens exist';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::regclass
      and conname = 'invitations_token_key'
      and contype = 'u'
  ) then
    alter table public.invitations
      add constraint invitations_token_key unique (token);
  end if;
end
$migration$;

commit;
