alter table public.invitations
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_updated_at_invitations on public.invitations;
create trigger set_updated_at_invitations
before update on public.invitations
for each row execute function private.set_updated_at();
