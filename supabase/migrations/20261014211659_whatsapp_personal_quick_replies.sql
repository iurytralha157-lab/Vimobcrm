-- Additive, backend-only personal saved messages. No organization template,
-- provider, queue, Storage, or existing message is changed.
set lock_timeout = '5s';

create table private.whatsapp_quick_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  shortcut text not null,
  content text not null,
  -- A finite unique slot is a hard bound even under a stale transaction snapshot.
  owner_slot smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_quick_replies_membership_fk foreign key(user_id, organization_id)
    references public.organization_members(user_id, organization_id) on delete cascade,
  constraint whatsapp_quick_replies_shortcut_check check (
    shortcut collate "C" ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
  ),
  constraint whatsapp_quick_replies_content_check check (
    char_length(content) between 1 and 4000
    and content ~ '[^[:space:]]'
  ),
  constraint whatsapp_quick_replies_slot_check check(owner_slot between 1 and 200),
  constraint whatsapp_quick_replies_owner_shortcut_key unique(organization_id,user_id,shortcut),
  constraint whatsapp_quick_replies_owner_slot_key unique(organization_id,user_id,owner_slot)
);

create index whatsapp_quick_replies_user_organization_idx
  on private.whatsapp_quick_replies(user_id,organization_id);

alter table private.whatsapp_quick_replies owner to postgres;
alter table private.whatsapp_quick_replies enable row level security;
alter table private.whatsapp_quick_replies force row level security;
-- Deliberately no browser policy: even an accidental future table grant must
-- not turn personal messages into a Data API resource.
revoke all on table private.whatsapp_quick_replies from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on table private.whatsapp_quick_replies to service_role;

create function private.enforce_whatsapp_quick_reply_owner_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.user_id is distinct from old.user_id
       or new.owner_slot is distinct from old.owner_slot
       or new.id is distinct from old.id then
      raise exception 'personal quick reply identity is immutable'
        using errcode='23514', constraint='whatsapp_quick_replies_identity_check';
    end if;
    new.created_at := old.created_at;
    new.updated_at := pg_catalog.clock_timestamp();
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'whatsapp-quick-replies:' || new.organization_id::text || ':' || new.user_id::text, 0));
  select candidate.slot into new.owner_slot
  from pg_catalog.generate_series(1,200) as candidate(slot)
  where not exists (
    select 1 from private.whatsapp_quick_replies as saved
    where saved.organization_id=new.organization_id
      and saved.user_id=new.user_id and saved.owner_slot=candidate.slot
  ) order by candidate.slot limit 1;
  if new.owner_slot is null then
    raise exception 'personal quick reply limit reached'
      using errcode='23514', constraint='whatsapp_quick_replies_owner_limit';
  end if;
  return new;
end;
$$;
alter function private.enforce_whatsapp_quick_reply_owner_limit() owner to postgres;
revoke all on function private.enforce_whatsapp_quick_reply_owner_limit() from public, anon, authenticated;
create trigger whatsapp_quick_replies_owner_limit
before insert or update on private.whatsapp_quick_replies
for each row execute function private.enforce_whatsapp_quick_reply_owner_limit();

comment on table private.whatsapp_quick_replies is
  'Personal WhatsApp saved messages. API derives organization and owner from authenticated tenant context; never shared with teammates or exposed to the browser Data API.';
-- Rollback: stop using the new API routes first; keep this additive table to
-- preserve personal saved messages. A later explicit data-retention decision
-- may remove the table and trigger function. No automatic destructive rollback.
reset lock_timeout;
