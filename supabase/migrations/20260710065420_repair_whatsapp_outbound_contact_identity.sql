-- Outbound Evolution Go events identify the account owner in Info.Sender and
-- the actual contact in Info.RecipientAlt/Info.Chat. Earlier processing treated
-- both sides as contact aliases, which mixed replies from different recipients.

begin;

create temp table tmp_whatsapp_outbound_identity on commit drop as
with raw_identity as (
  select
    wm.id as message_row_id,
    wm.organization_id,
    wm.session_id,
    wm.conversation_id as source_conversation_id,
    wm.sent_at,
    nullif(trim(coalesce(
      wm.metadata->'raw'->'Info'->>'RecipientPN',
      wm.metadata->'raw'->'Info'->>'RecipientAlt'
    )), '') as recipient_jid,
    nullif(trim(coalesce(
      wm.metadata->'raw'->'Info'->>'Chat',
      wm.metadata->'raw'->'Info'->'DeviceSentMeta'->>'DestinationJID'
    )), '') as contact_lid,
    nullif(trim(wm.metadata->'raw'->'Info'->>'Sender'), '') as owner_sender_jid
  from public.whatsapp_messages wm
  where wm.from_me = true
    and wm.metadata->>'source' = 'evolution_go_webhook'
    and wm.metadata->'raw'->'Info' is not null
), normalized as (
  select
    raw_identity.*,
    nullif(regexp_replace(split_part(recipient_jid, '@', 1), '\D', '', 'g'), '') as contact_phone
  from raw_identity
  where recipient_jid is not null
    and lower(recipient_jid) not like '%@lid'
    and lower(recipient_jid) not like '%@g.us'
    and lower(recipient_jid) not like '%@newsletter'
    and lower(recipient_jid) not like '%@broadcast'
    and lower(recipient_jid) not like '%@status'
)
select
  normalized.*,
  contact_phone || '@s.whatsapp.net' as canonical_jid
from normalized
where length(contact_phone) >= 8;

create index on tmp_whatsapp_outbound_identity (message_row_id);
create index on tmp_whatsapp_outbound_identity (organization_id, session_id, canonical_jid);
create index on tmp_whatsapp_outbound_identity (source_conversation_id);

create temp table tmp_whatsapp_session_owner_names on commit drop as
select distinct
  identity.organization_id,
  identity.session_id,
  lower(trim(coalesce(message.sender_name, message.metadata->'raw'->'Info'->>'PushName'))) as owner_name
from tmp_whatsapp_outbound_identity identity
join public.whatsapp_messages message on message.id = identity.message_row_id
where nullif(trim(coalesce(message.sender_name, message.metadata->'raw'->'Info'->>'PushName')), '') is not null;

create index on tmp_whatsapp_session_owner_names (organization_id, session_id, owner_name);

create temp table tmp_whatsapp_owner_sender_aliases on commit drop as
select
  organization_id,
  session_id,
  owner_sender_jid as alias_jid
from tmp_whatsapp_outbound_identity
where owner_sender_jid is not null
  and lower(owner_sender_jid) like '%@lid'
group by organization_id, session_id, owner_sender_jid
having count(distinct canonical_jid) > 1;

delete from public.whatsapp_contact_identity_aliases aliases
using tmp_whatsapp_owner_sender_aliases owner_alias
where aliases.organization_id = owner_alias.organization_id
  and aliases.session_id = owner_alias.session_id
  and aliases.alias_jid = owner_alias.alias_jid;

create temp table tmp_whatsapp_lead_phones on commit drop as
with normalized as (
  select
    lead.id,
    lead.organization_id,
    lead.name,
    lead.assigned_user_id,
    nullif(regexp_replace(coalesce(lead.phone, ''), '\D', '', 'g'), '') as phone
  from public.leads lead
  where lead.phone is not null
), variants as (
  select
    normalized.id,
    normalized.organization_id,
    normalized.name,
    normalized.assigned_user_id,
    phone_variant.contact_phone
  from normalized
  cross join lateral (
    values
      (normalized.phone),
      (case when normalized.phone like '55%' then substr(normalized.phone, 3) else null end),
      (case when normalized.phone not like '55%' and length(normalized.phone) in (10, 11) then '55' || normalized.phone else null end)
  ) phone_variant(contact_phone)
  where length(phone_variant.contact_phone) >= 8
)
select distinct on (organization_id, contact_phone)
  id,
  organization_id,
  name,
  assigned_user_id,
  contact_phone
from variants
order by organization_id, contact_phone, id;

create index on tmp_whatsapp_lead_phones (organization_id, contact_phone);

create temp table tmp_whatsapp_outbound_recipients on commit drop as
select distinct on (identity.organization_id, identity.session_id, identity.canonical_jid)
  identity.organization_id,
  identity.session_id,
  identity.canonical_jid,
  identity.contact_phone,
  identity.recipient_jid,
  identity.contact_lid,
  matched_lead.id as lead_id,
  matched_lead.name as lead_name,
  matched_lead.assigned_user_id as lead_assigned_user_id,
  identity.sent_at
from tmp_whatsapp_outbound_identity identity
left join lateral (
  select lead.id, lead.name, lead.assigned_user_id
  from tmp_whatsapp_lead_phones lead
  where lead.organization_id = identity.organization_id
    and lead.contact_phone = identity.contact_phone
  limit 1
) matched_lead on true
order by identity.organization_id, identity.session_id, identity.canonical_jid, identity.sent_at desc nulls last;

-- Reuse an exact canonical row if it had previously been soft-deleted. A lead
-- link is retained only when it does not conflict with another active row.
update public.whatsapp_conversations conversation
set
  deleted_at = null,
  lead_id = case
    when conversation.lead_id is not null and exists (
      select 1
      from public.whatsapp_conversations conflict
      where conflict.organization_id = conversation.organization_id
        and conflict.id <> conversation.id
        and conflict.lead_id = conversation.lead_id
        and conflict.deleted_at is null
        and conflict.is_group is not true
    ) then null
    else conversation.lead_id
  end,
  contact_phone = coalesce(conversation.contact_phone, recipient.contact_phone),
  assigned_user_id = coalesce(conversation.assigned_user_id, recipient.lead_assigned_user_id, session.owner_user_id),
  metadata = coalesce(conversation.metadata, '{}'::jsonb) || jsonb_build_object(
    'outbound_identity_repaired_at', now(),
    'outbound_identity_repair', 'recipient_alt'
  ),
  updated_at = now()
from tmp_whatsapp_outbound_recipients recipient
join public.whatsapp_sessions session on session.id = recipient.session_id
where conversation.organization_id = recipient.organization_id
  and conversation.session_id = recipient.session_id
  and conversation.remote_jid = recipient.canonical_jid
  and conversation.deleted_at is not null;

insert into public.whatsapp_conversations (
  organization_id,
  session_id,
  remote_jid,
  contact_name,
  contact_phone,
  is_group,
  unread_count,
  assigned_user_id,
  metadata
)
select
  recipient.organization_id,
  recipient.session_id,
  recipient.canonical_jid,
  coalesce(nullif(trim(recipient.lead_name), ''), recipient.contact_phone),
  recipient.contact_phone,
  false,
  0,
  coalesce(recipient.lead_assigned_user_id, session.owner_user_id),
  jsonb_build_object(
    'source', 'outbound_identity_repair',
    'created_from_recipient_alt', true,
    'whatsapp_identity', jsonb_build_object(
      'canonical_jid', recipient.canonical_jid,
      'contact_phone', recipient.contact_phone,
      'aliases', jsonb_build_array(recipient.canonical_jid, recipient.recipient_jid, recipient.contact_lid)
    )
  )
from tmp_whatsapp_outbound_recipients recipient
join public.whatsapp_sessions session on session.id = recipient.session_id
where not exists (
  select 1
  from public.whatsapp_conversations existing
  where existing.session_id = recipient.session_id
    and existing.remote_jid = recipient.canonical_jid
)
on conflict (session_id, remote_jid) do nothing;

create temp table tmp_whatsapp_outbound_targets on commit drop as
select
  recipient.organization_id,
  recipient.session_id,
  recipient.canonical_jid,
  recipient.contact_phone,
  recipient.recipient_jid,
  recipient.contact_lid,
  recipient.lead_id,
  recipient.lead_name,
  conversation.id as target_conversation_id
from tmp_whatsapp_outbound_recipients recipient
join public.whatsapp_conversations conversation
  on conversation.organization_id = recipient.organization_id
 and conversation.session_id = recipient.session_id
 and conversation.remote_jid = recipient.canonical_jid
 and conversation.deleted_at is null;

create temp table tmp_whatsapp_affected_conversations (
  conversation_id uuid primary key
) on commit drop;

insert into tmp_whatsapp_affected_conversations (conversation_id)
select distinct source_conversation_id
from tmp_whatsapp_outbound_identity
on conflict do nothing;

insert into tmp_whatsapp_affected_conversations (conversation_id)
select distinct target_conversation_id
from tmp_whatsapp_outbound_targets
on conflict do nothing;

update public.whatsapp_messages message
set
  conversation_id = target.target_conversation_id,
  remote_jid = identity.canonical_jid
from tmp_whatsapp_outbound_identity identity
join tmp_whatsapp_outbound_targets target
  on target.organization_id = identity.organization_id
 and target.session_id = identity.session_id
 and target.canonical_jid = identity.canonical_jid
where message.id = identity.message_row_id
  and (
    message.conversation_id is distinct from target.target_conversation_id
    or message.remote_jid is distinct from identity.canonical_jid
  );

-- Correct names that came from the account owner's PushName. Existing contact
-- names are otherwise preserved; a matched lead name is preferred.
update public.whatsapp_conversations conversation
set
  contact_phone = target.contact_phone,
  contact_name = case
    when nullif(trim(target.lead_name), '') is not null then trim(target.lead_name)
    when conversation.contact_name is null
      or trim(conversation.contact_name) = ''
      or regexp_replace(conversation.contact_name, '\D', '', 'g') = conversation.contact_name
      or exists (
        select 1
        from tmp_whatsapp_session_owner_names owner_name
        where owner_name.organization_id = target.organization_id
          and owner_name.session_id = target.session_id
          and owner_name.owner_name = lower(trim(conversation.contact_name))
      )
    then target.contact_phone
    else conversation.contact_name
  end,
  assigned_user_id = coalesce(conversation.assigned_user_id, session.owner_user_id),
  metadata = coalesce(conversation.metadata, '{}'::jsonb) || jsonb_build_object(
    'outbound_identity_repaired_at', now(),
    'outbound_identity_repair', 'recipient_alt',
    'whatsapp_identity', jsonb_build_object(
      'canonical_jid', target.canonical_jid,
      'contact_phone', target.contact_phone,
      'aliases', jsonb_build_array(target.canonical_jid, target.recipient_jid, target.contact_lid)
    )
  ),
  updated_at = now()
from tmp_whatsapp_outbound_targets target
join public.whatsapp_sessions session on session.id = target.session_id
where conversation.id = target.target_conversation_id;

create temp table tmp_whatsapp_desired_contact_aliases on commit drop as
with alias_source as (
  select
    identity.organization_id,
    identity.session_id,
    identity.canonical_jid,
    identity.contact_phone,
    target.lead_id,
    identity.sent_at,
    aliases.alias_jid
  from tmp_whatsapp_outbound_identity identity
  join tmp_whatsapp_outbound_targets target
    on target.organization_id = identity.organization_id
   and target.session_id = identity.session_id
   and target.canonical_jid = identity.canonical_jid
  cross join lateral (
    values
      (identity.canonical_jid),
      (identity.contact_phone || '@c.us'),
      (identity.recipient_jid),
      (case when lower(coalesce(identity.contact_lid, '')) like '%@lid' then identity.contact_lid else null end)
  ) aliases(alias_jid)
  where aliases.alias_jid is not null
    and not exists (
      select 1
      from tmp_whatsapp_owner_sender_aliases owner_alias
      where owner_alias.organization_id = identity.organization_id
        and owner_alias.session_id = identity.session_id
        and owner_alias.alias_jid = aliases.alias_jid
    )
)
select distinct on (organization_id, session_id, alias_jid)
  organization_id,
  session_id,
  alias_jid,
  canonical_jid,
  contact_phone,
  lead_id
from alias_source
order by organization_id, session_id, alias_jid, sent_at desc nulls last;

insert into public.whatsapp_contact_identity_aliases (
  organization_id,
  session_id,
  alias_jid,
  canonical_jid,
  contact_phone,
  lead_id,
  is_group,
  metadata,
  last_seen_at
)
select
  desired.organization_id,
  desired.session_id,
  desired.alias_jid,
  desired.canonical_jid,
  desired.contact_phone,
  desired.lead_id,
  false,
  jsonb_build_object('source', 'repair_whatsapp_outbound_contact_identity'),
  now()
from tmp_whatsapp_desired_contact_aliases desired
on conflict (organization_id, session_id, alias_jid) do update
set
  canonical_jid = excluded.canonical_jid,
  contact_phone = excluded.contact_phone,
  lead_id = coalesce(public.whatsapp_contact_identity_aliases.lead_id, excluded.lead_id),
  is_group = false,
  last_seen_at = now(),
  metadata = public.whatsapp_contact_identity_aliases.metadata || excluded.metadata;

-- Empty owner-named rows are obsolete after their outbound messages are moved.
update public.whatsapp_conversations conversation
set
  deleted_at = coalesce(conversation.deleted_at, now()),
  metadata = coalesce(conversation.metadata, '{}'::jsonb) || jsonb_build_object(
    'emptied_by_outbound_identity_repair_at', now()
  ),
  updated_at = now()
where conversation.id in (select conversation_id from tmp_whatsapp_affected_conversations)
  and not exists (
    select 1
    from public.whatsapp_messages message
    where message.conversation_id = conversation.id
  );

with latest_message as (
  select distinct on (message.conversation_id)
    message.conversation_id,
    coalesce(
      nullif(message.content, ''),
      case message.message_type
        when 'image' then 'Imagem'
        when 'video' then 'Video'
        when 'audio' then 'Audio'
        when 'document' then 'Documento'
        when 'sticker' then 'Figurinha'
        when 'reaction' then 'Reacao'
        when 'deleted' then 'Esta mensagem foi apagada'
        else 'Mensagem'
      end
    ) as preview,
    coalesce(message.sent_at, message.created_at) as message_at
  from public.whatsapp_messages message
  where message.conversation_id in (select conversation_id from tmp_whatsapp_affected_conversations)
  order by message.conversation_id, coalesce(message.sent_at, message.created_at) desc, message.created_at desc
), last_received as (
  select
    message.conversation_id,
    max(coalesce(message.received_at, message.sent_at, message.created_at)) as last_received_at
  from public.whatsapp_messages message
  where message.conversation_id in (select conversation_id from tmp_whatsapp_affected_conversations)
    and message.from_me = false
  group by message.conversation_id
)
update public.whatsapp_conversations conversation
set
  last_message = latest.preview,
  last_message_preview = latest.preview,
  last_message_at = latest.message_at,
  last_message_received_at = received.last_received_at,
  updated_at = now()
from latest_message latest
left join last_received received on received.conversation_id = latest.conversation_id
where conversation.id = latest.conversation_id
  and conversation.deleted_at is null;

commit;
