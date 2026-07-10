create table if not exists public.whatsapp_contact_identity_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  alias_jid text not null,
  canonical_jid text not null,
  contact_phone text,
  lead_id uuid references public.leads(id) on delete set null,
  is_group boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint whatsapp_contact_identity_aliases_alias_not_blank check (length(trim(alias_jid)) > 0),
  constraint whatsapp_contact_identity_aliases_canonical_not_blank check (length(trim(canonical_jid)) > 0)
);

create unique index if not exists whatsapp_contact_identity_aliases_org_session_alias_uidx
  on public.whatsapp_contact_identity_aliases (organization_id, session_id, alias_jid);

create index if not exists idx_whatsapp_contact_identity_aliases_canonical
  on public.whatsapp_contact_identity_aliases (organization_id, session_id, canonical_jid);

create index if not exists idx_whatsapp_contact_identity_aliases_phone
  on public.whatsapp_contact_identity_aliases (organization_id, session_id, contact_phone)
  where contact_phone is not null;

create index if not exists idx_whatsapp_contact_identity_aliases_lead
  on public.whatsapp_contact_identity_aliases (organization_id, lead_id)
  where lead_id is not null;

alter table public.whatsapp_contact_identity_aliases enable row level security;

revoke all on table public.whatsapp_contact_identity_aliases from anon;
revoke all on table public.whatsapp_contact_identity_aliases from authenticated;

with conversation_identity_source as (
  select
    wc.id as conversation_id,
    wc.organization_id,
    wc.session_id,
    wc.remote_jid,
    wc.contact_phone,
    wc.lead_id,
    wc.is_group,
    nullif(regexp_replace(coalesce(wc.contact_phone, ''), '\D', '', 'g'), '') as conversation_phone,
    nullif(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), '') as lead_phone,
    nullif(regexp_replace(split_part(coalesce(wc.remote_jid, ''), '@', 1), '\D', '', 'g'), '') as remote_phone
  from public.whatsapp_conversations wc
  left join public.leads l on l.id = wc.lead_id
  where wc.session_id is not null
    and wc.remote_jid is not null
    and wc.deleted_at is null
),
message_phone_source as (
  select distinct on (wm.conversation_id)
    wm.conversation_id,
    nullif(regexp_replace(split_part(value.jid, '@', 1), '\D', '', 'g'), '') as message_phone
  from public.whatsapp_messages wm
  cross join lateral (
    values (wm.remote_jid), (wm.sender_jid)
  ) as value(jid)
  where value.jid is not null
    and lower(value.jid) not like '%@g.us'
    and lower(value.jid) not like '%@lid'
    and lower(value.jid) not like '%@newsletter'
    and lower(value.jid) not like '%@broadcast'
    and lower(value.jid) not like '%@status'
    and length(regexp_replace(split_part(value.jid, '@', 1), '\D', '', 'g')) >= 8
  order by wm.conversation_id, wm.sent_at desc nulls last, wm.created_at desc
),
conversation_identities as (
  select
    cis.*,
    case
      when cis.is_group or lower(cis.remote_jid) like '%@g.us' then null
      when length(cis.conversation_phone) >= 8 then cis.conversation_phone
      when length(cis.lead_phone) >= 8 then cis.lead_phone
      when (
        lower(cis.remote_jid) like '%@s.whatsapp.net'
        or lower(cis.remote_jid) like '%@c.us'
      ) and length(cis.remote_phone) >= 8 then cis.remote_phone
      when length(mps.message_phone) >= 8 then mps.message_phone
      else null
    end as resolved_phone
  from conversation_identity_source cis
  left join message_phone_source mps on mps.conversation_id = cis.conversation_id
),
canonical_conversations as (
  select
    conversation_id,
    organization_id,
    session_id,
    remote_jid,
    contact_phone,
    lead_id,
    is_group,
    resolved_phone,
    case
      when is_group or lower(remote_jid) like '%@g.us' then remote_jid
      when resolved_phone is not null then resolved_phone || '@s.whatsapp.net'
      when lower(remote_jid) like '%@lid'
        or lower(remote_jid) like '%@newsletter'
        or lower(remote_jid) like '%@broadcast'
        or lower(remote_jid) like '%@status' then null
      else remote_jid
    end as canonical_jid
  from conversation_identities
),
base_aliases as (
  select
    organization_id,
    session_id,
    remote_jid as alias_jid,
    canonical_jid,
    resolved_phone as contact_phone,
    lead_id,
    is_group,
    conversation_id
  from canonical_conversations
  where canonical_jid is not null
    and remote_jid is not null

  union all

  select
    organization_id,
    session_id,
    resolved_phone || '@s.whatsapp.net',
    canonical_jid,
    resolved_phone,
    lead_id,
    is_group,
    conversation_id
  from canonical_conversations
  where canonical_jid is not null
    and resolved_phone is not null

  union all

  select
    organization_id,
    session_id,
    resolved_phone || '@c.us',
    canonical_jid,
    resolved_phone,
    lead_id,
    is_group,
    conversation_id
  from canonical_conversations
  where canonical_jid is not null
    and resolved_phone is not null
),
message_lid_aliases as (
  select distinct
    cc.organization_id,
    cc.session_id,
    value.jid as alias_jid,
    cc.canonical_jid,
    cc.resolved_phone as contact_phone,
    cc.lead_id,
    cc.is_group,
    cc.conversation_id
  from canonical_conversations cc
  join public.whatsapp_messages wm on wm.conversation_id = cc.conversation_id
  cross join lateral (
    values (wm.remote_jid), (wm.sender_jid)
  ) as value(jid)
  where cc.canonical_jid is not null
    and value.jid is not null
    and lower(value.jid) like '%@lid'
),
all_aliases as (
  select * from base_aliases
  union all
  select * from message_lid_aliases
),
deduplicated_aliases as (
  select distinct on (organization_id, session_id, alias_jid)
    organization_id,
    session_id,
    alias_jid,
    canonical_jid,
    contact_phone,
    lead_id,
    is_group,
    conversation_id
  from all_aliases
  where alias_jid is not null
    and canonical_jid is not null
  order by organization_id, session_id, alias_jid, lead_id nulls last
)
insert into public.whatsapp_contact_identity_aliases (
  organization_id,
  session_id,
  alias_jid,
  canonical_jid,
  contact_phone,
  lead_id,
  is_group,
  metadata
)
select
  organization_id,
  session_id,
  alias_jid,
  canonical_jid,
  contact_phone,
  lead_id,
  is_group,
  jsonb_build_object(
    'source', 'migration_20260710000912',
    'conversation_id', conversation_id
  )
from deduplicated_aliases
on conflict (organization_id, session_id, alias_jid) do update
set
  canonical_jid = excluded.canonical_jid,
  contact_phone = coalesce(public.whatsapp_contact_identity_aliases.contact_phone, excluded.contact_phone),
  lead_id = coalesce(public.whatsapp_contact_identity_aliases.lead_id, excluded.lead_id),
  is_group = excluded.is_group,
  last_seen_at = now(),
  metadata = public.whatsapp_contact_identity_aliases.metadata || excluded.metadata;

update public.whatsapp_conversations wc
set
  contact_phone = null,
  metadata = coalesce(wc.metadata, '{}'::jsonb) || jsonb_build_object(
    'invalid_contact_phone_cleared_at', now(),
    'invalid_contact_phone_reason', 'opaque_jid_digits'
  ),
  updated_at = now()
where coalesce(wc.is_group, false) = false
  and (
    lower(wc.remote_jid) like '%@lid'
    or lower(wc.remote_jid) like '%@newsletter'
    or lower(wc.remote_jid) like '%@broadcast'
    or lower(wc.remote_jid) like '%@status'
  )
  and wc.contact_phone is not null
  and wc.contact_phone = regexp_replace(split_part(wc.remote_jid, '@', 1), '\D', '', 'g');
